/** Re-presents Fastify's header bag as a `Headers`, which is what better-auth expects. */
export function requestHeaders(headers: Record<string, string | string[] | undefined>) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers))
    if (value) result.set(name, Array.isArray(value) ? value.join(",") : value);
  return result;
}
