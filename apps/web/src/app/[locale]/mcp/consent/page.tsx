import { isLocale } from "@control-hub/i18n";
import { notFound } from "next/navigation";
import { apiFetch, readJson } from "@/lib/api";
import type { McpConsentRequest } from "@/lib/api-types";
import { requireSession } from "@/lib/require-session";
import { ConsentDecision } from "./consent-decision";
import { ConsentRefused } from "./consent-refused";

/**
 * The one screen in this product where a person decides what somebody else's software may read.
 *
 * It is rendered on the server on purpose. The request it describes must be re-read through the
 * API before anything is drawn -- the query string is what an agent composed, and the client name,
 * the scopes and the expiry on this page are the API's answer, never the parameters echoed back.
 * Fetching here means the screen cannot be rendered from the address alone, not even for the
 * instant before a client-side load would replace it.
 *
 * The parameters are still passed on to the decision component untouched, because the POST that
 * follows carries the same request and the API validates it again there. This page reads; it does
 * not decide, and it does not repair anything it was handed.
 *
 * Specification: `docs/specifications/mcp-and-client-portal.md`.
 */
export default async function McpConsentPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const request = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) {
    for (const single of Array.isArray(value) ? value : [value ?? ""]) request.append(name, single);
  }
  const query = request.toString();

  // The address to come back to, so that authenticating does not lose the request. Somebody who
  // arrives here signed out is answering an agent, not browsing the panel: the dashboard is the
  // wrong place to land.
  await requireSession(locale, `/${locale}/mcp/consent${query === "" ? "" : `?${query}`}`);

  const response = await apiFetch(`/api/v1/mcp/consent?${query}`);
  if (!response.ok) {
    const problem = await readJson<{ code?: string }>(response).catch(() => ({ code: undefined }));
    return <ConsentRefused locale={locale} code={problem.code} />;
  }

  return (
    <ConsentDecision
      locale={locale}
      description={await readJson<McpConsentRequest>(response)}
      request={Object.fromEntries(request)}
    />
  );
}
