import { createHmac } from "node:crypto";

/**
 * Server-only client for the private assistant service. Every request is signed
 * (HMAC over timestamp, method, path, user id and body) so the service can trust
 * the user id it receives.
 */

export function isAssistantEnabled(): boolean {
  return process.env.ASSISTANT_ENABLED === "true" && Boolean(process.env.ASSISTANT_SERVICE_SECRET);
}

export function assistantBillingMode(): "log" | "charge" {
  return process.env.ASSISTANT_BILLING_MODE === "charge" ? "charge" : "log";
}

function serviceUrl(): string {
  return (process.env.ASSISTANT_SERVICE_URL || "http://127.0.0.1:4100").replace(/\/+$/, "");
}

export function signServiceRequest(params: {
  secret: string;
  timestamp: number;
  userId: string;
  method: string;
  path: string;
  body: string;
}): string {
  const payload = `${params.timestamp}.${params.method.toUpperCase()}.${params.path}.${params.userId}.${params.body}`;
  return createHmac("sha256", params.secret).update(payload).digest("hex");
}

export async function callAssistantService(params: {
  path: string;
  userId: string;
  body: unknown;
}): Promise<Response> {
  const secret = process.env.ASSISTANT_SERVICE_SECRET ?? "";
  const body = JSON.stringify(params.body);
  const timestamp = Date.now();
  const signature = signServiceRequest({ secret, timestamp, userId: params.userId, method: "POST", path: params.path, body });
  return fetch(`${serviceUrl()}${params.path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-assistant-signature": signature,
      "x-assistant-timestamp": String(timestamp),
      "x-assistant-user": params.userId,
    },
    body,
    cache: "no-store",
  });
}
