import { setAutoApprove } from "./driver/spend-guard";

const KEY = "assistant-auto-approve";
const EVENT = "assistant-settings";

/** Whether this browser lets the agent generate without an approval card. */
export function readAutoApprove(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAutoApprove(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Storage can be blocked; the in-memory guard still applies for this page.
  }
  setAutoApprove(on);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function subscribeAutoApprove(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

if (typeof window !== "undefined") setAutoApprove(readAutoApprove());
