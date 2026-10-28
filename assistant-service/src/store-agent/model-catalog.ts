import { Cursor, type ModelListItem } from "@cursor/sdk";

/**
 * Cursor's model list, fetched once an hour and shared.
 *
 * Every Agent.create / Agent.resume validates the model against this list,
 * and the list endpoint allows 30 requests a minute (plus an hourly cap) per
 * account, so a burst of chats starting at once would fail. The SDK reads the
 * list from CURSOR_SDK_LOCAL_MODEL_CATALOG_JSON when it is set, so keeping that
 * variable filled means starting an agent never calls the endpoint.
 */

const CATALOG_ENV = "CURSOR_SDK_LOCAL_MODEL_CATALOG_JSON";
const REFRESH_MS = 60 * 60 * 1000;

let cached: { at: number; models: ModelListItem[] } | null = null;
let pending: Promise<ModelListItem[]> | null = null;

/** The model list, from memory when it is less than an hour old. */
export async function cursorModels(apiKey: string): Promise<ModelListItem[]> {
  if (cached && Date.now() - cached.at < REFRESH_MS) return cached.models;
  pending ??= Cursor.models
    .list({ apiKey })
    .then((models) => {
      cached = { at: Date.now(), models };
      process.env[CATALOG_ENV] = JSON.stringify(models);
      return models;
    })
    .finally(() => {
      pending = null;
    });
  try {
    return await pending;
  } catch (error) {
    // A failed refresh keeps the last good list (and the variable) in use.
    if (cached) return cached.models;
    throw error;
  }
}

/** Fill the list at startup and refresh it every hour. Returns the stop function. */
export function keepModelCatalogFresh(apiKey: string, log: (message: string, extra?: unknown) => void): () => void {
  const refresh = () => {
    if (cached) cached.at = 0;
    void cursorModels(apiKey).catch((error) => log("refreshing the Cursor model list failed", error));
  };
  refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
