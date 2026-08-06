"use client";

import { CircleHelp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * The two ways this product explains something without spending a line of layout on it.
 *
 * `HelpTip` is the short one: a `?` that shows a sentence on hover and on focus, for a field or a
 * section heading. `HelpDialog` is for an explanation too long to hover over — a paragraph about
 * how a whole screen behaves — which opens on click and can be read at leisure.
 *
 * Both are reachable with the keyboard and both carry the text in an accessible name, so nothing
 * here is available only to somebody using a mouse.
 */

export function HelpTip({ label, description }: { label: string; description: string }) {
  return (
    <span className="field-help" tabIndex={0} aria-label={`${label}: ${description}`}>
      <CircleHelp size={14} aria-hidden="true" />
      <span role="tooltip">
        <strong>{label}</strong>
        {description}
      </span>
    </span>
  );
}

export function HelpDialog({
  label,
  title,
  body,
  closeLabel
}: {
  /** The accessible name of the button, since the button itself is only an icon. */
  label: string;
  title: string;
  body: string;
  closeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Escape closes it, which is the first thing anybody tries and the last thing that gets built.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className="heading-help" onClick={() => setOpen(true)} aria-label={label} title={label}>
        <CircleHelp size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-dialog-title">
            <header>
              <h2 id="help-dialog-title">{title}</h2>
              <button className="icon-button" onClick={() => setOpen(false)} aria-label={closeLabel} ref={closeRef}>
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <p>{body}</p>
          </section>
        </div>
      )}
    </>
  );
}
