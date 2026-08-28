export function halfPeriodDeltaPercent(values: number[]): number | null {
  if (values.length < 4) return null;
  const mid = Math.floor(values.length / 2);
  const first = values.slice(0, mid).reduce((sum, value) => sum + value, 0);
  const second = values.slice(mid).reduce((sum, value) => sum + value, 0);
  if (first === 0) return second === 0 ? null : 100;
  return ((second - first) / first) * 100;
}
