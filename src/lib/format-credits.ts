export function formatCredits(value: number | null | undefined, fixed = false): string {
  const amount = Number(value ?? 0);

  return amount.toLocaleString(undefined, {
    minimumFractionDigits: fixed ? 3 : 0,
    maximumFractionDigits: 3,
  });
}

export function roundCredits(value: number): number {
  return Math.round(value * 1000) / 1000;
}
