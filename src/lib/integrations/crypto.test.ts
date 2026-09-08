import { afterEach, describe, expect, it } from "vitest";
import {
  decryptIntegrationConfig,
  encryptIntegrationConfig,
  fingerprintSecret,
  isEncryptedEnvelope,
  publicIntegrationConfig,
} from "./crypto";

describe("integration envelope encryption", () => {
  afterEach(() => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS;
  });
  it("round-trips secrets and keeps a last-4 fingerprint", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = "a".repeat(64);
    const envelope = encryptIntegrationConfig({
      store_url: "https://shop.myshopify.com",
      admin_api_token: "shpat_live_secret_token",
    });
    expect(isEncryptedEnvelope(envelope)).toBe(true);
    expect(envelope.hints.admin_api_token).toBe("oken");
    const { plaintext, wasLegacy } = decryptIntegrationConfig(envelope);
    expect(wasLegacy).toBe(false);
    expect(plaintext.admin_api_token).toBe("shpat_live_secret_token");
    expect(plaintext.store_url).toBe("https://shop.myshopify.com");
  });

  it("treats historical plaintext JSON as legacy and still decrypts", () => {
    const { plaintext, wasLegacy, hints } = decryptIntegrationConfig({
      application_password: "xxxx yyyy zzzz",
      username: "admin",
    });
    expect(wasLegacy).toBe(true);
    expect(plaintext.username).toBe("admin");
    expect(hints.application_password).toBe(fingerprintSecret("xxxxyyyyzzzz"));
  });

  it("strips secrets from the client-facing config", () => {
    expect(
      publicIntegrationConfig({
        store_domain: "shop.example",
        admin_api_token: "shpat_abc",
      })
    ).toEqual({ store_domain: "shop.example" });
  });

  it("decrypts with the previous key after rotation", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = "a".repeat(64);
    const envelope = encryptIntegrationConfig({
      admin_api_token: "shpat_old",
    });
    process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS = "a".repeat(64);
    process.env.INTEGRATION_ENCRYPTION_KEY = "b".repeat(64);
    const { plaintext, needsReencrypt } = decryptIntegrationConfig(envelope);
    expect(plaintext.admin_api_token).toBe("shpat_old");
    expect(needsReencrypt).toBe(true);
  });
});
