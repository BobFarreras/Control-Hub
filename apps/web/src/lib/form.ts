/**
 * Form reading helpers, kept apart from `./api` because that module pulls in `next/headers`
 * and may only run on the server. These run in client components.
 *
 * `FormData.get` returns `string | File | null`. Interpolating that straight into a request
 * body turns an unexpected entry into the literal text "[object File]" and posts it to the API
 * as if it were a real value. Reading through here yields a string or nothing.
 */

export function formValue(data: FormData, field: string): string {
  const value = data.get(field);
  return typeof value === "string" ? value : "";
}

/** Trimmed, or `undefined` when the field was left empty, for optional request properties. */
export function optionalFormValue(data: FormData, field: string): string | undefined {
  const value = formValue(data, field).trim();
  return value.length > 0 ? value : undefined;
}

/**
 * The filled-in text fields of a form, for request bodies built by spreading the whole form.
 * File entries are dropped rather than coerced, which is what `String(value)` used to do.
 */
export function textEntries(data: FormData): [string, string][] {
  return [...data.entries()].flatMap(([field, value]) =>
    typeof value === "string" && value.trim().length > 0 ? [[field, value] as [string, string]] : []
  );
}
