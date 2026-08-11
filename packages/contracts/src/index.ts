export type DependencyHealth = { status: "up" | "down"; latencyMs: number };
export type LiveHealth = { status: "ok"; service: string; version: string };
export type ReadyHealth = {
  status: "ready" | "not_ready";
  service: string;
  dependencies: Record<string, DependencyHealth>;
};

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("CSV_UNCLOSED_QUOTE");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function stringifyCsv(rows: readonly (readonly (string | null | undefined)[])[]): string {
  const escape = (value: string | null | undefined) => {
    const raw = value ?? "";
    const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(escape).join(",")).join("\r\n") + "\r\n";
}

/** Prevents spreadsheet applications from interpreting imported business text as a formula. */
export function sanitizeSpreadsheetText(value: string | null | undefined): string {
  const text = value ?? "";
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
