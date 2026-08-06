/**
 * Turning what somebody types into the minor units the API stores, and back.
 *
 * Never through a float. `parseFloat("45.50") * 100` is 4550.000000000001 on some inputs and 4549
 * after truncation on others, and an hourly rate that is one cent off multiplies into every margin
 * the report shows. The digits are handled as digits.
 */

/** The result of reading an amount: either the value in minor units, or why it was refused. */
export type ParsedAmount = { minor: number } | { error: "empty" | "not-a-number" | "too-precise" | "negative" };

const separators = /[.,]/;

/**
 * Reads an amount written the way people write it: `45`, `45,5`, `45.50`, `1 234,56`.
 *
 * Refuses more than two decimals rather than rounding them away: somebody who typed three digits
 * meant something, and silently dropping one is how a rate ends up wrong without anybody noticing.
 */
export function parseAmountToMinor(input: string): ParsedAmount {
  // Ordinary, non-breaking, thin and narrow spaces: all four are how thousands end up grouped,
  // whether typed by hand or pasted out of a spreadsheet. Written as escapes because an invisible
  // character in a character class is unreviewable, and lint is right to refuse it.
  const text = input.replace(/[\s\u00a0\u2009\u202f]/g, "");
  if (text.length === 0) return { error: "empty" };
  if (text.startsWith("-")) return { error: "negative" };

  const parts = text.split(separators);
  if (parts.length > 2) return { error: "not-a-number" };

  const [whole = "", fraction = ""] = parts;
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return { error: "not-a-number" };
  if (whole.length === 0 && fraction.length === 0) return { error: "not-a-number" };
  if (fraction.length > 2) return { error: "too-precise" };

  const minor = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(minor)) return { error: "not-a-number" };
  return { minor };
}

/**
 * Minor units back into an editable field, always with both decimals.
 *
 * Not `Intl.NumberFormat`: this fills an input that has to be read back by `parseAmountToMinor`,
 * so it must not carry a currency symbol or group separators. The formatted-for-reading version
 * lives in `./format`.
 */
export function minorToAmountInput(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
