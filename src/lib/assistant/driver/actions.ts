import { isAllowedNavigation, isBlockedNavigation, type BrowserAction } from "../protocol";
import { ciGetState, ciSelectRows, ciSetColumns } from "./ci-handlers";
import { moveCursorTo, pressCursor } from "./cursor-controller";
import { getPageHandlers, type PageScope } from "./page-handlers";
import { consumeApproval, isSpendControl } from "./spend-guard";
import { findAgentElement, takeSnapshot } from "./snapshot";

export type ActionOutcome = { ok: true; result?: unknown } | { ok: false; error: string };

export interface DriverContext {
  workspaceSlug: string;
  navigate: (path: string) => void;
  getFile: (fileId: string) => File | undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class ActionError extends Error {}

function requireElement(id: string): HTMLElement {
  const element = findAgentElement(id);
  if (!element) throw new ActionError(`Control "${id}" is not on the page. Call see_page for the current controls.`);
  return element;
}

function requirePage(scope: PageScope) {
  const handlers = getPageHandlers(scope);
  if (!handlers) throw new ActionError(`That page is not open. Navigate to it first.`);
  return handlers;
}

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled === true || element.getAttribute("aria-disabled") === "true";
}

async function waitForElement(id: string, timeoutMs: number): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const element = findAgentElement(id);
    if (element) return element;
    await sleep(200);
  }
  return null;
}

function reveal(element: HTMLElement) {
  element.scrollIntoView({ block: "center", behavior: "smooth" });
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function click(action: Extract<BrowserAction, { kind: "click" }>) {
  const element = requireElement(action.target);
  if (isDisabled(element)) throw new ActionError("That control is disabled right now.");
  if (isSpendControl(element) && !consumeApproval(action.target, action.approvalToken)) {
    throw new ActionError("This control spends credits. Ask the user with ask_confirmation first, then click with the approvalToken it returns.");
  }
  reveal(element);
  await sleep(250);
  await moveCursorTo(element, "Clicking");
  await pressCursor();
  element.click();
  await sleep(500);
  return "clicked";
}

async function type(action: Extract<BrowserAction, { kind: "type" }>) {
  const element = requireElement(action.target);
  reveal(element);
  await sleep(250);
  await moveCursorTo(element, "Typing");
  if (element instanceof HTMLSelectElement) {
    const wanted = action.text.trim().toLowerCase();
    const option = Array.from(element.options).find(
      (o) => o.text.trim().toLowerCase() === wanted || o.value.toLowerCase() === wanted
    );
    if (!option) {
      throw new ActionError(`No option "${action.text}". Options: ${Array.from(element.options).map((o) => o.text).join(" | ")}`);
    }
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, option.value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return `selected ${option.text}`;
  }
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
    throw new ActionError("That control does not accept text.");
  }
  element.focus();
  setNativeValue(element, "");
  // Typed in short bursts so the user sees it happen.
  let typed = "";
  for (const chunk of action.text.match(/[\s\S]{1,6}/g) ?? []) {
    typed += chunk;
    setNativeValue(element, typed);
    await sleep(40);
  }
  await sleep(200);
  return "typed";
}

async function navigate(action: Extract<BrowserAction, { kind: "navigate" }>, ctx: DriverContext) {
  if (!isAllowedNavigation(action.path, ctx.workspaceSlug) || isBlockedNavigation(action.path)) {
    throw new ActionError("The agent cannot open that page.");
  }
  ctx.navigate(action.path);
  const target = action.path.split("?")[0];
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && window.location.pathname !== target) await sleep(150);
  if (window.location.pathname !== target) throw new ActionError("The page did not open in time.");
  await sleep(900);
  return `opened ${window.location.pathname}`;
}

async function upload(action: Extract<BrowserAction, { kind: "upload_file" }>, ctx: DriverContext) {
  const element = requireElement(action.target);
  if (!(element instanceof HTMLInputElement) || element.type !== "file") {
    throw new ActionError("That control is not a file input.");
  }
  const ids = action.fileIds?.length ? action.fileIds : action.fileId ? [action.fileId] : [];
  if (ids.length === 0) throw new ActionError("Pass fileId or fileIds.");
  if (ids.length > 1 && !element.multiple) throw new ActionError("This input takes one file at a time.");
  const chosen: File[] = [];
  for (const id of ids) {
    const file = ctx.getFile(id);
    if (!file) throw new ActionError(`File ${id} is no longer attached. Ask the user to attach it again.`);
    chosen.push(file);
  }
  const zone = findAgentElement(action.target.replace(/\.file$/, ".dropzone")) ?? element.parentElement;
  if (zone) {
    reveal(zone as HTMLElement);
    await sleep(250);
    await moveCursorTo(zone, "Uploading");
    await pressCursor();
  }
  const transfer = new DataTransfer();
  for (const file of chosen) transfer.items.add(file);
  element.files = transfer.files;
  element.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(1500);
  return chosen.length === 1 ? `uploaded ${chosen[0].name}` : `uploaded ${chosen.length} files`;
}

async function waitFor(action: Extract<BrowserAction, { kind: "wait_for" }>) {
  if (action.target) {
    const found = await waitForElement(action.target, action.ms ?? 10000);
    if (!found) throw new ActionError(`"${action.target}" did not appear in time.`);
    return "appeared";
  }
  await sleep(action.ms ?? 1000);
  return "waited";
}

/** Run one action requested by the agent on this tab. Never throws. */
export async function executeBrowserAction(action: BrowserAction, ctx: DriverContext): Promise<ActionOutcome> {
  try {
    switch (action.kind) {
      case "see_page":
        return { ok: true, result: takeSnapshot() };
      case "click":
        return { ok: true, result: await click(action) };
      case "type":
        return { ok: true, result: await type(action) };
      case "navigate":
        return { ok: true, result: await navigate(action, ctx) };
      case "upload_file":
        return { ok: true, result: await upload(action, ctx) };
      case "wait_for":
        return { ok: true, result: await waitFor(action) };
      case "ci_get_state":
        return { ok: true, result: ciGetState() };
      case "ci_select_rows":
        return { ok: true, result: ciSelectRows(action) };
      case "ci_set_columns":
        return { ok: true, result: ciSetColumns(action) };
      case "page_get_state":
        return { ok: true, result: requirePage(action.scope).getState() };
      case "page_select_rows":
        return {
          ok: true,
          result: requirePage(action.scope).selectRows?.({
            mode: action.mode,
            indexes: action.indexes,
            statuses: action.statuses,
          }),
        };
      case "page_set_columns":
        return { ok: true, result: requirePage(action.scope).setColumns?.(action.columns) };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The action failed" };
  }
}
