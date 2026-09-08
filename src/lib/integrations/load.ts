import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationRecord } from "@/lib/sync/core/types";
import {
  decryptIntegrationConfig,
  encryptIntegrationConfig,
  encryptionConfigured,
  primaryCredentialFingerprint,
  publicIntegrationConfig,
} from "./crypto";

export type IntegrationRow = {
  id?: string;
  workspace_id?: string;
  provider: string;
  integration_name: string;
  base_url?: string | null;
  config?: unknown;
  credential_fingerprint?: string | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
};

export function decryptedIntegrationConfig(config: unknown): Record<string, unknown> {
  return decryptIntegrationConfig(config).plaintext;
}

export function toClientIntegration(row: IntegrationRow | null) {
  if (!row) return null;
  const { plaintext, hints } = decryptIntegrationConfig(row.config);
  return {
    ...row,
    config: publicIntegrationConfig(plaintext),
    credential_fingerprint:
      row.credential_fingerprint || primaryCredentialFingerprint(hints) || null,
  };
}

export async function decryptAndMaybeReencrypt(
  admin: SupabaseClient,
  row: IntegrationRow | null
): Promise<IntegrationRecord | null> {
  if (!row) return null;
  const { plaintext, needsReencrypt, hints } = decryptIntegrationConfig(
    row.config
  );
  if (needsReencrypt && encryptionConfigured() && row.id) {
    const envelope = encryptIntegrationConfig(plaintext);
    const fingerprint = primaryCredentialFingerprint(hints);
    await admin
      .from("workspace_integrations")
      .update({
        config: envelope,
        credential_fingerprint: fingerprint || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }
  return {
    provider: row.provider,
    integration_name: row.integration_name,
    base_url: row.base_url,
    config: plaintext,
  };
}
