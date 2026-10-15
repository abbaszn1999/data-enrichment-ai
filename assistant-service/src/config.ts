import { resolve } from "node:path";

export type BillingMode = "log" | "charge";

export interface ServiceConfig {
  port: number;
  /** Shared secret that signs every request from the gateway. */
  secret: string;
  cursorApiKey: string;
  model: string;
  /** Composer defaults to its Fast variant, billed about 6x the standard one. */
  modelFast: boolean;
  knowledgeRoot: string;
  storeDir: string;
  billingMode: BillingMode;
  /** Dollars per million tokens, used only when the SDK reports no billed cost. */
  rates: TokenRates;
}

export type TokenRates = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** Cursor's published Composer 2.5 prices per million tokens (cursor.com/docs/models). Cache writes are not priced separately. */
export const COMPOSER_RATES: Record<"standard" | "fast", TokenRates> = {
  standard: { input: 0.5, output: 2.5, cacheRead: 0.2, cacheWrite: 0.5 },
  fast: { input: 3, output: 15, cacheRead: 0.5, cacheWrite: 3 },
};

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const secret = env.ASSISTANT_SERVICE_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("ASSISTANT_SERVICE_SECRET must be set to at least 32 characters");
  }
  const cursorApiKey = env.CURSOR_API_KEY ?? "";
  if (!cursorApiKey) throw new Error("CURSOR_API_KEY is not set");
  const billingMode: BillingMode = env.ASSISTANT_BILLING_MODE === "charge" ? "charge" : "log";
  const modelFast = env.ASSISTANT_MODEL_FAST === "true";
  const base = COMPOSER_RATES[modelFast ? "fast" : "standard"];
  return {
    port: num(env.ASSISTANT_SERVICE_PORT, 4100),
    secret,
    cursorApiKey,
    model: env.ASSISTANT_MODEL || "composer-2.5",
    modelFast,
    knowledgeRoot: resolve(env.ASSISTANT_KNOWLEDGE_DIR || "knowledge"),
    storeDir: resolve(env.ASSISTANT_STORE_DIR || ".store"),
    billingMode,
    rates: {
      input: num(env.ASSISTANT_RATE_INPUT, base.input),
      output: num(env.ASSISTANT_RATE_OUTPUT, base.output),
      cacheRead: num(env.ASSISTANT_RATE_CACHE_READ, base.cacheRead),
      cacheWrite: num(env.ASSISTANT_RATE_CACHE_WRITE, base.cacheWrite),
    },
  };
}
