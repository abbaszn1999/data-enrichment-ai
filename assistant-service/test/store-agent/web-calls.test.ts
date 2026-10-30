import { describe, expect, it } from "vitest";
import { emptyReply, reduceReply } from "../../../src/lib/store-agent/blocks";
import { NO_RESULTS, webCallsInMessages } from "../../src/store-agent/events";
import { themedReport } from "../../../src/lib/store-agent/report-theme";

/** A saved turn as Agent.messages.list returns it (its JSON form). */
const turn = (steps: unknown[]) => ({ type: "user", message: { toJSON: () => ({ agentConversationTurn: { userMessage: { text: "hi" }, steps } }) } });

describe("webCallsInMessages", () => {
  it("reads search links and page reads, and drops server paths and bad links", () => {
    const calls = webCallsInMessages([
      turn([
        { thinkingMessage: { text: "…" } },
        {
          toolCallId: "s1",
          toolCall: {
            webSearchToolCall: {
              args: { searchTerm: "woo batch", toolCallId: "s1" },
              result: {
                success: {
                  references: [
                    { title: "Web search results", url: "", chunk: "Links: …" },
                    { title: "Products | WooCommerce", url: "https://developer.woocommerce.com/docs/products/", chunk: "Full page text written to file: C:\\Users\\x" },
                    { title: "dup", url: "https://developer.woocommerce.com/docs/products/" },
                    { title: "bad", url: "javascript:alert(1)" },
                  ],
                },
              },
            },
          },
        },
        { toolCallId: "f1", toolCall: { webFetchToolCall: { args: { url: "https://shopify.dev/docs/x" }, result: { success: { url: "https://shopify.dev/docs/x", markdown: "…" } } } } },
        { toolCallId: "f2", toolCall: { webFetchToolCall: { args: { url: "https://a.example" }, result: { error: { url: "https://a.example", error: "blocked" } } } } },
        // Still running: no result yet.
        { toolCallId: "s2", toolCall: { webSearchToolCall: { args: { searchTerm: "later" } } } },
      ]),
    ]);
    expect(calls).toEqual([
      {
        callId: "s1",
        tool: "webSearch",
        args: { searchTerm: "woo batch", toolCallId: "s1" },
        ok: true,
        summary: undefined,
        links: [{ title: "Products | WooCommerce", url: "https://developer.woocommerce.com/docs/products/" }],
      },
      { callId: "f1", tool: "webFetch", args: { url: "https://shopify.dev/docs/x" }, ok: true, summary: undefined, links: [{ title: "shopify.dev", url: "https://shopify.dev/docs/x" }] },
      { callId: "f2", tool: "webFetch", args: { url: "https://a.example" }, ok: false, summary: "blocked", links: [{ title: "a.example", url: "https://a.example/" }] },
    ]);
    expect(JSON.stringify(calls)).not.toContain("C:\\");
  });

  it("ignores messages that are not turns", () => {
    expect(webCallsInMessages([null, {}, { message: "x" }, { type: "assistant", message: { agentConversationTurn: {} } }])).toEqual([]);
  });

  it("says when a search found nothing", () => {
    const [call] = webCallsInMessages([
      turn([{ toolCallId: "s3", toolCall: { webSearchToolCall: { args: { searchTerm: "x" }, result: { success: { references: [{ title: "Web search results", url: "" }] } } } } }]),
    ]);
    expect(call).toMatchObject({ ok: true, summary: NO_RESULTS, links: [] });
  });

  it("keeps the links on the saved tool block", () => {
    let state = reduceReply(emptyReply(), { type: "tool_start", callId: "s1", tool: "webSearch", kind: "web", title: "Searching the web", seq: 1 });
    state = reduceReply(state, { type: "tool_end", callId: "s1", ok: true, links: [{ title: "A", url: "https://a.example/" }], seq: 2 });
    expect(state.blocks[0]).toMatchObject({ status: "ok", links: [{ title: "A", url: "https://a.example/" }] });
  });

  it("keeps links and summary when a web call ends a second time without them", () => {
    let state = reduceReply(emptyReply(), { type: "tool_start", callId: "s1", tool: "webSearch", kind: "web", title: "Searching the web", seq: 1 });
    state = reduceReply(state, { type: "tool_end", callId: "s1", ok: true, summary: NO_RESULTS, seq: 2 });
    state = reduceReply(state, { type: "tool_end", callId: "s1", ok: true, seq: 3 });
    expect(state.blocks[0]).toMatchObject({ status: "ok", summary: NO_RESULTS });

    state = reduceReply(state, { type: "tool_start", callId: "s2", tool: "webSearch", kind: "web", title: "Searching the web", seq: 4 });
    state = reduceReply(state, { type: "tool_end", callId: "s2", ok: true, links: [{ title: "A", url: "https://a.example/" }], seq: 5 });
    state = reduceReply(state, { type: "tool_end", callId: "s2", ok: true, seq: 6 });
    expect(state.blocks[1]).toMatchObject({ links: [{ title: "A", url: "https://a.example/" }] });
  });

  it("keeps a message sent mid-run in the reply, where it arrived", () => {
    let state = reduceReply(emptyReply(), { type: "text", delta: "Searching…", seq: 1 });
    state = reduceReply(state, { type: "guidance", text: "also count the free products", seq: 2 });
    state = reduceReply(state, { type: "text", delta: "Done.", seq: 3 });
    expect(state.blocks).toEqual([
      { type: "text", text: "Searching…" },
      { type: "guidance", text: "also count the free products" },
      { type: "text", text: "Done." },
    ]);
  });
});

describe("themedReport", () => {
  const themed = `<!doctype html><html lang="en" data-theme="light"><head><style>:root[data-theme="dark"]{--bg:#000}</style></head><body></body></html>`;

  it("sets the app's theme on a report that supports it", () => {
    const { doc, themed: ok } = themedReport(themed, true);
    expect(ok).toBe(true);
    expect(doc).toContain(`<html lang="en" data-theme="dark">`);
    expect(doc).toContain(`:root[data-theme="dark"]{--bg:#000}`);
    expect(doc).toContain(`<base target="_blank">`);
    expect(themedReport(themed, false).doc).toContain(`<html lang="en" data-theme="light">`);
  });

  it("leaves an older report with fixed colors as it was", () => {
    const old = `<html><head></head><body style="background:#fff"></body></html>`;
    expect(themedReport(old, true)).toEqual({ doc: `<html><head><base target="_blank"></head><body style="background:#fff"></body></html>`, themed: false });
  });
});
