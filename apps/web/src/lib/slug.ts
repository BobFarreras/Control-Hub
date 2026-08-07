/**
 * The combining marks `NFD` leaves behind, as a pattern built from escapes.
 *
 * Written with `new RegExp` and not as a literal on purpose: inside a regex literal the range
 * ends up as two invisible characters in the source, which is an edit nobody can review and
 * which `no-irregular-whitespace` has already caught once in this repository.
 */
const COMBINING_MARKS = new RegExp("[\u0300-\u036f]", "g");

/**
 * The code of a service type, derived from its name while somebody types.
 *
 * This mirrors `toServiceCode` in `@control-hub/domain`, which is the authority: whatever this
 * produces travels to the API and comes back through that function before anything is stored, so
 * the worst a mismatch here could do is show a preview that differs from the stored code. The two
 * are kept identical on purpose, and this file exists only because the web app does not depend on
 * the domain package.
 *
 * Accents are stripped by splitting each letter from its diacritic (`NFD`) and dropping the mark,
 * so "Pagina web" and "Pagina  Web" both become `pagina-web`. The mark range is written with `\u`
 * escapes: as literal characters it would be an invisible edit nobody can review.
 */
export function toServiceCode(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}
