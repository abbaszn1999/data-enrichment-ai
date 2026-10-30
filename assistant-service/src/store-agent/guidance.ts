import type { SDKCustomTool } from "@cursor/sdk";
import type { StoreAgentRun } from "./run";

/** How the user's mid-run messages are put to the agent. */
export function guidanceText(messages: readonly string[]): string {
  return messages.map((m) => `"${m}"`).join("\n");
}

/**
 * Hand the user's mid-run messages to the agent at its next tool call: the
 * call does not run, and its result is the message. A "stop" therefore lands
 * before the next store change, whatever the SDK did with the steer.
 */
export function withGuidance(tools: Record<string, SDKCustomTool>, run: StoreAgentRun): Record<string, SDKCustomTool> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: (args, context) => {
          const pending = run.takeGuidance();
          if (!pending.length) return tool.execute(args, context);
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `This ${name} call was NOT run: the user sent you a message while you were working.\n${guidanceText(pending)}\n` +
                  "Read it before doing anything else. If it stops or replaces the task, follow it and do not repeat the call. " +
                  "Otherwise it adds to the task: keep going with the original request (you may call the tool again), do what the message asks too, and answer both.",
              },
            ],
            isError: true,
          };
        },
      } satisfies SDKCustomTool,
    ])
  );
}
