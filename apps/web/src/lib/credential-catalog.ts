/** Browser-side defence in depth; the API remains the authority for the destination. */
export function safeCredentialDestination(destination: string, registeredBaseUrl: string): URL | null {
  try {
    const candidate = new URL(destination);
    const base = new URL(registeredBaseUrl);
    if (candidate.protocol !== "https:" || base.protocol !== "https:" || candidate.origin !== base.origin) return null;
    return candidate;
  } catch {
    return null;
  }
}

/** Navigate without giving the external page an opener or a referrer. */
export function openCredentialDestination(destination: URL): void {
  const anchor = document.createElement("a");
  anchor.href = destination.href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.referrerPolicy = "no-referrer";
  anchor.click();
}
