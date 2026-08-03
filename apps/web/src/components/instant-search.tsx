"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

export function InstantSearch({ placeholder, resetParams = [] }: { placeholder: string; resetParams?: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.get("search") ?? "";
  const [value, setValue] = useState(currentSearch);
  const [syncedSearch, setSyncedSearch] = useState(currentSearch);
  const [pending, startTransition] = useTransition();

  // Adjusting state while rendering is the documented way to follow a changing prop. Doing it
  // in an effect instead renders the stale value first and then immediately renders again.
  if (syncedSearch !== currentSearch) {
    setSyncedSearch(currentSearch);
    setValue(currentSearch);
  }

  useEffect(() => {
    if (value.trim() === currentSearch) return;
    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      const search = value.trim().slice(0, 160);
      if (search) next.set("search", search);
      else next.delete("search");
      for (const parameter of resetParams) next.set(parameter, "1");
      startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [currentSearch, resetParams, router, searchParams, value]);

  return (
    <label className={`crm-search${pending ? " searching" : ""}`}>
      <Search size={17} />
      <span className="sr-only">{placeholder}</span>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        type="search"
        autoComplete="off"
      />
      {pending ? (
        <LoaderCircle className="spin" size={16} />
      ) : value ? (
        <button type="button" onClick={() => setValue("")} aria-label={placeholder}>
          <X size={15} />
        </button>
      ) : null}
    </label>
  );
}
