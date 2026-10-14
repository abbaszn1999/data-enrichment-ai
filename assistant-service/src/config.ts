import { resolve } from "node:path";

export type BillingMode = "log" | "charge";

export interface ServiceConfig {
  port: number;
  /** Shared secret that signs every request from the gateway. */
  secret: string;
  cursorApiKey: string;
  model: string;
  knowledgeRoot: string;
  storeDir: string;
  billingMode: BillingMode;
  /** Dollars per million tokens, used only when the SDK reports no billed cost. */
  rates: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

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
  return {
    port: num(env.ASSISTANT_SERVICE_PORT, 4100),
    secret,
    cursorApiKey,
    model: env.ASSISTANT_MODEL || "composer-2.5",
    knowledgeRoot: resolve(env.ASSISTANT_KNOWLEDGE_DIR || "knowledge"),
    storeDir: resolve(env.ASSISTANT_STORE_DIR || ".store"),
    billingMode,
    rates: {
      input: num(env.ASSISTANT_RATE_INPUT, 2),
      output: num(env.ASSISTANT_RATE_OUTPUT, 10),
      cacheRead: num(env.ASSISTANT_RATE_CACHE_READ, 0.2),
      cacheWrite: num(env.ASSISTANT_RATE_CACHE_WRITE, 2.5),
    },
  };
}
