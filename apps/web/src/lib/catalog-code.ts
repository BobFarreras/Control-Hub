export function toCatalogCode(value: string, fallback: "product" | "plan"): string {
  const code = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (code.length >= 3) return code;
  return code ? `${code}-${fallback}` : "";
}
