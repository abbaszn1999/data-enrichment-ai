import type { SDKCustomTool, SDKCustomToolResult } from "@cursor/sdk";

/**
 * Cursor re-delivers a tool call that has gone a few minutes without a result
 * (seen while a change waited for approval), with the same toolCallId. Run each
 * call once: a repeat joins the first execution and gets its result, so a
 * change is never asked for or applied twice.
 */
export function oncePerToolCall(tools: Record<string, SDKCustomTool>): Record<string, SDKCustomTool> {
  const calls = new Map<string, Promise<SDKCustomToolResult>>();
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: (args, context) => {
          const id = context?.toolCallId;
          if (!id) return tool.execute(args, context);
          const key = `${name}\u0000${id}`;
          const running = calls.get(key);
          if (running) return running;
          const result = Promise.resolve().then(() => tool.execute(args, context));
          calls.set(key, result);
          return result;
        },
      } satisfies SDKCustomTool,
    ])
  );
}
