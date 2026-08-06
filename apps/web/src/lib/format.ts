/**
 * Presentation helpers shared by the listings and the detail pages.
 *
 * They live here rather than in a component because two screens rendering the same minutes
 * differently is the kind of inconsistency nobody reports and everybody notices.
 */

/**
 * Minutes as something a person reads.
 *
 * Spelled out with units rather than `1:30`, which a screen reader announces as a time of day.
 */
export function formatHours(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  if (hours === 0) return `${whole} min`;
  const rest = whole % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Minor units as money, in the currency the amount is actually in and never a mixed total. */
export function formatMoney(minor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}
