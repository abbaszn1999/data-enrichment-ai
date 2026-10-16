import { ASSISTANT_LIMITS } from "../protocol";

export type SnapshotControl = {
  id: string;
  kind: string;
  label: string;
  value?: string;
  options?: string[];
  state?: string;
  spends_credits?: boolean;
};

export function findAgentElement(id: string): HTMLElement | null {
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
  return document.querySelector<HTMLElement>(`[data-agent-id="${escaped}"]`);
}

function isVisible(element: HTMLElement): boolean {
  // Hidden file inputs stay targetable: they are the upload entry point.
  if (element instanceof HTMLInputElement && element.type === "file") return true;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

function labelOf(element: HTMLElement): string {
  const own = element.getAttribute("data-agent-label");
  if (own) return own.trim().slice(0, 120);
  const aria = element.getAttribute("aria-label");
  if (aria) return aria.trim().slice(0, 120);
  if (element.id && (element instanceof HTMLSelectElement || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    const text = document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent?.replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 120);
  }
  if (element instanceof HTMLSelectElement) return "dropdown";
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return (element.placeholder || element.name || element.type || "").slice(0, 120);
  }
  return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function kindOf(element: HTMLElement): string {
  if (element instanceof HTMLSelectElement) return "select";
  if (element instanceof HTMLTextAreaElement) return "textarea";
  if (element instanceof HTMLInputElement) return element.type === "file" ? "file_input" : "input";
  return "button";
}

export function describeControl(element: HTMLElement): SnapshotControl | null {
  const id = element.getAttribute("data-agent-id");
  if (!id || !isVisible(element)) return null;
  const control: SnapshotControl = { id, kind: kindOf(element), label: labelOf(element) };
  if (element instanceof HTMLSelectElement) {
    control.value = element.selectedOptions[0]?.text ?? "";
    control.options = Array.from(element.options).map((o) => o.text).slice(0, 40);
  } else if (element instanceof HTMLInputElement && element.type !== "file") {
    control.value = element.value.slice(0, 200);
  } else if (element instanceof HTMLTextAreaElement) {
    control.value = element.value.slice(0, 200);
  }
  const disabled = (element as HTMLButtonElement).disabled === true || element.getAttribute("aria-disabled") === "true";
  const active = element.getAttribute("aria-pressed") === "true" || element.getAttribute("aria-checked") === "true";
  const states = [disabled ? "disabled" : "", active ? "active" : ""].filter(Boolean);
  if (states.length) control.state = states.join(",");
  if (element.hasAttribute("data-agent-spend")) control.spends_credits = true;
  return control;
}

/** A compact view of the page: where we are, a heading, the toasts and every controllable element. */
export function takeSnapshot(): string {
  const controls = Array.from(document.querySelectorAll<HTMLElement>("[data-agent-id]"))
    .map(describeControl)
    .filter((c): c is SnapshotControl => c !== null);
  const heading = document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 160) ?? "";
  const toasts = Array.from(document.querySelectorAll("[data-sonner-toast]"))
    .map((t) => (t.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200))
    .slice(0, 3);
  const snapshot = {
    path: window.location.pathname,
    heading,
    ...(toasts.length ? { messages: toasts } : {}),
    controls,
  };
  const text = JSON.stringify(snapshot);
  return text.length > ASSISTANT_LIMITS.maxSnapshotChars ? text.slice(0, ASSISTANT_LIMITS.maxSnapshotChars) : text;
}
