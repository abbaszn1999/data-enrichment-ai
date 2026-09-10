import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decryptIntegrationConfig,
  encryptIntegrationConfig,
  encryptionConfigured,
} from "@/lib/integrations/crypto";
import { refreshGoogleAccessToken, type GoogleTokenSet } from "./oauth";
import type { AnalyticsConnectionPublic, AnalyticsConnectionType } from "./types";

export type AnalyticsConnectionRow = {
  id: string;
  workspace_id: string;
  connection_type: AnalyticsConnectionType;
  connected_email: string | null;
  selected_property: string | null;
  property_details: Record<string, unknown> | null;
  token_envelope: unknown;
};

type TokenPlaintext = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scopes: string;
};

function propertyLabel(details: Record<string, unknown> | null | undefined, fallback: string | null) {
  if (!details) return fallback;
  const label = details.label ?? details.displayName ?? details.url;
  return typeof label === "string" && label.trim() ? label : fallback;
}

export function toPublicConnection(
  row: AnalyticsConnectionRow | null
): AnalyticsConnectionPublic {
  if (!row) {
    return {
      connected: false,
      email: null,
      property: null,
      propertyLabel: null,
      needsProperty: false,
    };
  }
  return {
    connected: true,
    email: row.connected_email,
    property: row.selected_property,
    propertyLabel: propertyLabel(row.property_details, row.selected_property),
    needsProperty: !row.selected_property,
  };
}

export async function getAnalyticsConnection(
  admin: SupabaseClient,
  workspaceId: string,
  type: AnalyticsConnectionType
): Promise<AnalyticsConnectionRow | null> {
  const { data, error } = await admin
    .from("workspace_analytics_connections")
    .select(
      "id, workspace_id, connection_type, connected_email, selected_property, property_details, token_envelope"
    )
    .eq("workspace_id", workspaceId)
    .eq("connection_type", type)
    .maybeSingle();
  if (error) throw error;
  return (data as AnalyticsConnectionRow | null) ?? null;
}

export async function saveAnalyticsConnection(
  admin: SupabaseClient,
  input: {
    workspaceId: string;
    type: AnalyticsConnectionType;
    tokens: GoogleTokenSet;
    keepProperty?: boolean;
  }
) {
  if (!encryptionConfigured()) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is not set");
  }
  const existing = await getAnalyticsConnection(admin, input.workspaceId, input.type);
  const refreshToken = input.tokens.refreshToken || decryptTokens(existing?.token_envelope)?.refresh_token;
  if (!refreshToken) {
    throw new Error("No refresh token available. Please reconnect your account.");
  }
  const envelope = encryptIntegrationConfig({
    access_token: input.tokens.accessToken,
    refresh_token: refreshToken,
    expires_at: input.tokens.expiresAt.toISOString(),
    scopes: input.tokens.scopes,
  });

  const { error } = await admin.from("workspace_analytics_connections").upsert(
    {
      workspace_id: input.workspaceId,
      connection_type: input.type,
      connected_email: input.tokens.email ?? existing?.connected_email ?? null,
      selected_property: input.keepProperty ? existing?.selected_property ?? null : null,
      property_details: input.keepProperty ? existing?.property_details ?? {} : {},
      token_envelope: envelope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,connection_type" }
  );
  if (error) throw error;
}

function decryptTokens(envelope: unknown): TokenPlaintext | null {
  if (!envelope) return null;
  const plaintext = decryptIntegrationConfig(envelope).plaintext;
  const access = plaintext.access_token;
  const refresh = plaintext.refresh_token;
  const expires = plaintext.expires_at;
  if (typeof access !== "string" || typeof refresh !== "string" || typeof expires !== "string") {
    return null;
  }
  return {
    access_token: access,
    refresh_token: refresh,
    expires_at: expires,
    scopes: typeof plaintext.scopes === "string" ? plaintext.scopes : "",
  };
}

export async function getValidAnalyticsAccessToken(
  admin: SupabaseClient,
  workspaceId: string,
  type: AnalyticsConnectionType
): Promise<{ token: string; connection: AnalyticsConnectionRow }> {
  const connection = await getAnalyticsConnection(admin, workspaceId, type);
  if (!connection) {
    throw new Error(`${type} is not connected`);
  }
  const tokens = decryptTokens(connection.token_envelope);
  if (!tokens) {
    throw new Error("Stored Google tokens are unreadable. Please reconnect.");
  }
  const expiresAt = new Date(tokens.expires_at).getTime();
  if (expiresAt - Date.now() > 5 * 60 * 1000) {
    return { token: tokens.access_token, connection };
  }
  const refreshed = await refreshGoogleAccessToken(tokens.refresh_token);
  await saveAnalyticsConnection(admin, {
    workspaceId,
    type,
    tokens: {
      ...refreshed,
      email: connection.connected_email,
      refreshToken: refreshed.refreshToken || tokens.refresh_token,
    },
    keepProperty: true,
  });
  return { token: refreshed.accessToken, connection };
}

export async function updateSelectedProperty(
  admin: SupabaseClient,
  workspaceId: string,
  type: AnalyticsConnectionType,
  selectedProperty: string,
  propertyDetails: Record<string, unknown>
) {
  const existing = await getAnalyticsConnection(admin, workspaceId, type);
  if (!existing) throw new Error("Connection not found");
  if (existing.selected_property && existing.selected_property !== selectedProperty) {
    throw new Error("Property already selected. Disconnect and reconnect to change it.");
  }
  const { error } = await admin
    .from("workspace_analytics_connections")
    .update({
      selected_property: selectedProperty,
      property_details: propertyDetails,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  if (error) throw error;
}

export async function deleteAnalyticsConnection(
  admin: SupabaseClient,
  workspaceId: string,
  type: AnalyticsConnectionType
) {
  const { error } = await admin
    .from("workspace_analytics_connections")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("connection_type", type);
  if (error) throw error;
}
