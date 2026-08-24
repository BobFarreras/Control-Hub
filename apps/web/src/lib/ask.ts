import { problemCode } from "@/lib/integrations";

/**
 * A read whose answer is the point, rather than whether it succeeded.
 *
 * Most calls on these screens only need to know that they worked; a discovery needs what came
 * back. Shared between the two panels that do so the failure half is shaped the same way in both:
 * a code the dictionary can turn into a sentence, and never a raw message on screen.
 */
export type Answered<T> = { ok: true; data: T } | { ok: false; code: string | null };

export async function ask<T>(path: string, init?: RequestInit): Promise<Answered<T>> {
  const response = await fetch(path, init);
  const payload: unknown = await response.json().catch(() => null);
  return response.ok ? { ok: true, data: payload as T } : { ok: false, code: problemCode(payload) };
}
