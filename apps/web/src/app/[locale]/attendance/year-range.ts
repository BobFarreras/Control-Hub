export function attendanceYear(value?: string): number {
  const current = new Date().getUTCFullYear();
  if (!value || !/^\d{4}$/.test(value)) return current;
  const year = Number(value);
  return year >= 2000 && year <= current + 5 ? year : current;
}

export function yearRange(year: number): { from: string; to: string; year: number } {
  return { from: `${year}-01-01`, to: `${year}-12-31`, year };
}
