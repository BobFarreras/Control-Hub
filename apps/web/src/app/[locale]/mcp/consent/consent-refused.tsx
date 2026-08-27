import { getMcpDictionary, mcpErrorMessage, type Locale } from "@control-hub/i18n";
import { ShieldAlert } from "lucide-react";

/**
 * What a person sees when the request cannot be authorized at all.
 *
 * Deliberately a dead end with one way out: back to the panel. Every code that reaches this
 * component is a refusal the API already made -- an application nobody registered, an address that
 * is not one of its own, permissions the reader's role does not carry. Offering an action would
 * suggest the person can settle it from this screen, and they cannot.
 *
 * The sentence is looked up from the code rather than taken from the API's own message: the API
 * answers in one language and this screen is read in three.
 */
export function ConsentRefused({ locale, code }: { locale: Locale; code: string | undefined }) {
  const t = getMcpDictionary(locale);

  return (
    <main className="consent-page">
      <section className="consent-card consent-card-refused">
        <span className="consent-eyebrow">{t.eyebrow}</span>
        <ShieldAlert size={28} />
        <h1>{t.errorTitle}</h1>
        <p className="consent-subtitle">{mcpErrorMessage(locale, code)}</p>
        <a className="secondary-button" href={`/${locale}`}>
          {t.backToPanel}
        </a>
      </section>
    </main>
  );
}
