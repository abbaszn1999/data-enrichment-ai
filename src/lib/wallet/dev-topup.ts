/** Dev/staging credits only. Production needs a real processor (Stripe). */
export function walletDevTopupEnabled(): boolean {
  const flag = process.env.WALLET_ALLOW_DEV_TOPUP?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  if (flag === "true" || flag === "1") return true;
  return process.env.NODE_ENV !== "production";
}
