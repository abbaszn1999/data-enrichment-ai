import type { AssistantEvent } from "../../../src/lib/assistant/protocol";

/** The subset of SDK stream messages the mapper reads. Everything else is dropped. */
export type SdkStreamMessage =
  | { type: "assistant"; message: { content: Array<{ type: string; text?: string }> } }
  | { type: "tool_call"; name: string; status: "running" | "completed" | "error" }
  | { type: string; [key: string]: unknown };

/** Friendly step labels. Matching is by suffix because custom tools arrive with a server prefix. */
const STEP_LABELS: Array<[RegExp, string]> = [
  [/see_page$/, "Looking at the page"],
  [/click$/, "Clicking"],
  [/type$/, "Typing"],
  [/navigate$/, "Opening a page"],
  [/upload_file$/, "Uploading the file"],
  [/wait_for$/, "Waiting for the page"],
  [/ci_get_state$/, "Reading the sheet"],
  [/ci_select_rows$/, "Selecting rows"],
  [/ci_set_columns$/, "Choosing columns"],
  [/ask_confirmation$/, "Waiting for your approval"],
  [/list_dir$|read_file$|search_code$/, "Checking how the platform works"],
];

export function stepLabel(toolName: string): string {
  for (const [pattern, label] of STEP_LABELS) if (pattern.test(toolName)) return label;
  return "Working";
}

/**
 * Convert one SDK message into zero or more public events. Thinking, usage,
 * model names and raw tool arguments never leave this function.
 */
export function mapSdkMessage(message: SdkStreamMessage): AssistantEvent[] {
  if (message.type === "assistant") {
    const content = (message as { message?: { content?: Array<{ type: string; text?: string }> } }).message?.content ?? [];
    const out: AssistantEvent[] = [];
    for (const block of content) {
      if (block.type === "text" && block.text) out.push({ type: "text", text: block.text });
    }
    return out;
  }
  if (message.type === "tool_call") {
    const call = message as { name?: string; status?: string };
    if (call.status === "running" && typeof call.name === "string") {
      return [{ type: "step", label: stepLabel(call.name) }];
    }
  }
  return [];
}
