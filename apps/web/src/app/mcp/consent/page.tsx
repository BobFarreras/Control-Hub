import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { negotiateLocale } from "@/lib/negotiate-locale";

/**
 * The one address in this panel that is linked to from outside.
 *
 * The API's authorization endpoint sends an agent's browser here, and it deliberately sends it to
 * an address with no language in it: the list of languages this panel speaks belongs to the panel,
 * and a copy of it on the API side would be a second place for it to be wrong. So the locale is
 * chosen here, from what the browser already says it wants, and the request is passed on unchanged.
 *
 * Everything in the query string travels through untouched. It is not read here and it is not
 * trusted anywhere -- the screen it lands on re-reads every fact it renders through the API. This
 * page moves the request; it does not interpret it.
 */
export default async function McpConsentEntryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = negotiateLocale((await headers()).get("accept-language"));
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) {
    // A repeated parameter arrives as an array. Keeping every copy rather than the first is the
    // honest thing to do: the screen refuses a request it cannot make sense of, and dropping the
    // duplicate here would hide the ambiguity instead of surfacing it.
    for (const single of Array.isArray(value) ? value : [value ?? ""]) parameters.append(name, single);
  }

  const query = parameters.toString();
  redirect(`/${locale}/mcp/consent${query === "" ? "" : `?${query}`}`);
}
