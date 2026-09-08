import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALG = "aes-256-gcm";
const VERSION = 1;
const ACTIVE_KID = "active";
const PREVIOUS_KID = "previous";

const SECRET_KEYS = [
  "admin_api_token",
  "application_password",
  "consumer_secret",
  "client_secret",
  "access_token",
] as const;

export type EncryptedEnvelope = {
  v: typeof VERSION;
  kid: string;
  alg: typeof ALG;
  iv: string;
  tag: string;
  ct: string;
  hints: Record<string, string>;
};

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.v === VERSION &&
    row.alg === ALG &&
    typeof row.iv === "string" &&
    typeof row.tag === "string" &&
    typeof row.ct === "string"
  );
}

function decodeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const buf = Buffer.from(trimmed, "base64");
  if (buf.length === 32) return buf;
  throw new Error("INTEGRATION_ENCRYPTION_KEY must be 32 bytes (hex or base64)");
}

function keyForKid(kid: string): Buffer {
  if (kid === PREVIOUS_KID) {
    const previous = process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS;
    if (!previous) {
      throw new Error("INTEGRATION_ENCRYPTION_KEY_PREVIOUS is not set");
    }
    return decodeKey(previous);
  }
  const active = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!active) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is not set");
  }
  return decodeKey(active);
}

export function encryptionConfigured(): boolean {
  return Boolean(process.env.INTEGRATION_ENCRYPTION_KEY);
}

export function fingerprintSecret(value: string): string {
  const trimmed = value.replace(/\s+/g, "");
  if (!trimmed) return "";
  return trimmed.slice(-4);
}

export function publicIntegrationConfig(
  config: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!config) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_KEYS.includes(key as (typeof SECRET_KEYS)[number])) continue;
    if (key === "__enc") continue;
    out[key] = value;
  }
  return out;
}

export function encryptIntegrationConfig(
  config: Record<string, unknown>
): EncryptedEnvelope {
  const hints: Record<string, string> = {};
  for (const key of SECRET_KEYS) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) {
      hints[key] = fingerprintSecret(value);
    }
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, keyForKid(ACTIVE_KID), iv);
  const plaintext = Buffer.from(JSON.stringify(config), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: VERSION,
    kid: ACTIVE_KID,
    alg: ALG,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
    hints,
  };
}

function openEnvelope(
  config: EncryptedEnvelope,
  kid: string
): Record<string, unknown> {
  const decipher = createDecipheriv(
    ALG,
    keyForKid(kid),
    Buffer.from(config.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(config.tag, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(config.ct, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(pt.toString("utf8")) as Record<string, unknown>;
}

export function decryptIntegrationConfig(config: unknown): {
  plaintext: Record<string, unknown>;
  wasLegacy: boolean;
  needsReencrypt: boolean;
  hints: Record<string, string>;
} {
  if (!config || typeof config !== "object") {
    return { plaintext: {}, wasLegacy: false, needsReencrypt: false, hints: {} };
  }
  if (isEncryptedEnvelope(config)) {
    const labeledPrevious = config.kid === PREVIOUS_KID;
    const kids = labeledPrevious
      ? [PREVIOUS_KID]
      : process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS
        ? [ACTIVE_KID, PREVIOUS_KID]
        : [ACTIVE_KID];
    let lastError: unknown;
    for (const kid of kids) {
      try {
        const parsed = openEnvelope(config, kid);
        return {
          plaintext: parsed,
          wasLegacy: false,
          needsReencrypt: kid === PREVIOUS_KID,
          hints: config.hints ?? {},
        };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Failed to decrypt integration config");
  }
  const plaintext = { ...(config as Record<string, unknown>) };
  const hints: Record<string, string> = {};
  for (const key of SECRET_KEYS) {
    const value = plaintext[key];
    if (typeof value === "string" && value.trim()) {
      hints[key] = fingerprintSecret(value);
    }
  }
  return { plaintext, wasLegacy: true, needsReencrypt: true, hints };
}

export function primaryCredentialFingerprint(hints: Record<string, string>): string {
  return (
    hints.admin_api_token ||
    hints.application_password ||
    Object.values(hints)[0] ||
    ""
  );
}
