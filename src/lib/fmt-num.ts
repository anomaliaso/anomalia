/** Compact KPI formatting: 12345 → "12.3K", 1500000 → "1.5M". */
export function fmtCompactNum(n: number): string {
  const v = Math.round(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return v.toLocaleString();
}
