import { defaultLocale, isLocale, type Locale } from "@control-hub/i18n";

/**
 * Which language to answer an address that carries none.
 *
 * Every screen in this product lives under `/{locale}`, and the locale is chosen by whoever links
 * to it. The consent screen is the one address that arrives from outside: the API redirects an
 * agent's browser here, and the API deliberately does not know the list of languages this panel
 * speaks -- a copy of that list on the other side of the wire is a second place for it to be
 * wrong. So the address it sends people to has no locale in it, and this is where one is picked.
 *
 * `Accept-Language` is what the browser already says on every request, and it is the only signal
 * available before anybody has been identified. Region is dropped: `ca-AD` and `ca-ES` are both
 * Catalan here, and matching the whole tag would fall back to Catalan-by-default for a Spanish
 * speaker whose browser happens to say `es-MX`.
 *
 * RFC 9110 section 12.5.4 orders the entries by `q`, and the header can be nonsense -- it comes
 * from the client. Anything unparseable is skipped rather than throwing: a malformed header is a
 * reason to fall back to the default language, never a reason not to render the screen.
 */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return defaultLocale;

  const ranked = header
    .split(",")
    .map((entry) => {
      const [tag, ...parameters] = entry.split(";").map((part) => part.trim());
      const quality = parameters.map((parameter) => /^q=([0-9.]+)$/i.exec(parameter)).find((match) => match !== null);
      const weight = quality === undefined ? 1 : Number.parseFloat(quality[1]!);
      return {
        language: (tag ?? "").split("-")[0]?.toLowerCase() ?? "",
        // A weight that does not parse is not a weight. Treating it as zero would silently drop a
        // language the person actually asked for.
        weight: Number.isFinite(weight) ? weight : 0
      };
    })
    // `q=0` means "not this one" in the same RFC, so it is a rejection and not a low preference.
    .filter((entry) => entry.weight > 0)
    .sort((left, right) => right.weight - left.weight);

  return ranked.map((entry) => entry.language).find(isLocale) ?? defaultLocale;
}
