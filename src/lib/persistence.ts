import type { ProductRow, EnrichmentColumn, EnrichmentSettings } from "@/types";

const DB_NAME = "datasheet-ai";
const DB_VERSION = 1;
const STORE_NAME = "session";
const SESSION_KEY = "current-session";

export interface PersistedSession {
  fileName: string;
  rows: ProductRow[];
  originalColumns: string[];
  sourceColumns: string[];
  enrichmentColumns: EnrichmentColumn[];
  enrichmentSettings: EnrichmentSettings;
  columnVisibility: Record<string, boolean>;
  savedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function saveSession(session: PersistedSession): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(session, SESSION_KEY);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) {
    console.warn("Failed to save session to IndexedDB:", e);
  }
}

export async function loadSession(): Promise<PersistedSession | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(SESSION_KEY);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        db.close();
        resolve(request.result || null);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (e) {
    console.warn("Failed to load session from IndexedDB:", e);
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(SESSION_KEY);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) {
    console.warn("Failed to clear session from IndexedDB:", e);
  }
}
