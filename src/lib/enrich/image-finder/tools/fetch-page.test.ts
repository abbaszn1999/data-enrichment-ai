import { describe, expect, it, vi } from "vitest";
import { EvidenceLedger, pageShowsImage } from "../evidence";
import { createCheckPagesTool } from "./check-pages";
import { createFetchPageTool, createPageSession, type CachedPage, type PageSessionOptions } from "./fetch-page";
import { extractRowIdentifiers } from "./identifiers";
import { extractHtmlPage } from "./page-extract";

const rowIdentifiers = extractRowIdentifiers({ Code: "RCP887291" });
const noRules = { allowedDomains: [], blockedDomains: [] };

function page(url: string, html: string, status = 200): CachedPage {
  return { at: Date.now(), status, finalUrl: url, extract: status === 200 ? extractHtmlPage(html, url) : null, body: html };
}

const fetchTool = (options: PageSessionOptions) => createFetchPageTool(createPageSession(options));

const ROBOT = "https://store.test/products/space-warrior-rc-fighting-robot";
const robotHtml = `<html><head><title>Space Warrior RC Fighting Robot</title>
  <script type="application/json">{"variants":[{"sku":"RCP887291"}]}</script></head>
  <body><img src="https://cdn.test/robot-front-887291.jpg"></body></html>`;

describe("fetch_page tool", () => {
  it("reports row identifiers found anywhere in the page, including scripts, and records evidence", async () => {
    const ledger = new EvidenceLedger();
    const tool = fetchTool({ rowIdentifiers, ledger, domainRules: noRules, load: async (url: string) => page(url, robotHtml) });
    const output = JSON.parse(String(await tool.run({ url: ROBOT })));
    expect(output.title).toBe("Space Warrior RC Fighting Robot");
    expect(output.rowIdentifiersSeen).toEqual(["RCP887291"]);
    const evidence = ledger.find(`${ROBOT}.json`);
    expect(evidence?.identifierKeys.has("RCP887291")).toBe(true);
    expect(evidence?.matchText).toContain(" space warrior rc fighting robot ");
    expect(pageShowsImage(evidence!, "https://cdn.test/robot-front-887291.jpg?width=800")).toBe(true);
  });

  it("refuses blocked websites and websites outside the allow list without loading them", async () => {
    const load = vi.fn();
    const tool = fetchTool({
      rowIdentifiers,
      ledger: new EvidenceLedger(),
      domainRules: { allowedDomains: ["store.test"], blockedDomains: ["bad.test"] },
      load,
    });
    expect(JSON.parse(String(await tool.run({ url: "https://other.test/p" }))).error).toContain("outside");
    expect(JSON.parse(String(await tool.run({ url: "https://www.bad.test/p" }))).error).toContain("blocked");
    expect(load).not.toHaveBeenCalled();
  });

  it("stops at the per-product page budget", async () => {
    const tool = fetchTool({
      rowIdentifiers,
      ledger: new EvidenceLedger(),
      domainRules: noRules,
      maxFetches: 1,
      load: async (url: string) => page(url, robotHtml),
    });
    await tool.run({ url: ROBOT });
    expect(JSON.parse(String(await tool.run({ url: `${ROBOT}?x=1` }))).error).toContain("budget");
  });

  it("caps pages per website per product, but still allows other websites", async () => {
    const tool = fetchTool({
      rowIdentifiers,
      ledger: new EvidenceLedger(),
      domainRules: noRules,
      maxFetchesPerSite: 2,
      load: async (url: string) => page(url, robotHtml),
    });
    await tool.run({ url: `${ROBOT}?p=1` });
    await tool.run({ url: `https://www.store.test/collections/robots` });
    expect(JSON.parse(String(await tool.run({ url: `${ROBOT}?p=3` }))).error).toContain("opened 2 pages on store.test");
    expect(JSON.parse(String(await tool.run({ url: "https://other.test/p" }))).error).toBeUndefined();
  });

  it("returns the HTTP error for pages that fail, and records them as not opened", async () => {
    const ledger = new EvidenceLedger();
    const tool = fetchTool({ rowIdentifiers, ledger, domainRules: noRules, load: async (url: string) => page(url, "", 404) });
    const output = JSON.parse(String(await tool.run({ url: ROBOT })));
    expect(output.status).toBe(404);
    expect(ledger.find(ROBOT)?.status).toBe(404);
  });

  it("reports near codes (row code plus a trailing letter) and records them", async () => {
    const ledger = new EvidenceLedger();
    const ids = extractRowIdentifiers({ Part: "AN5120" });
    const tool = fetchTool({
      rowIdentifiers: ids,
      ledger,
      domainRules: noRules,
      load: async (url: string) => page(url, "<html><title>AN5120N IC</title><body>Part AN5120N DIP-16</body></html>"),
    });
    const output = JSON.parse(String(await tool.run({ url: "https://chips.test/an5120n" })));
    expect(output.rowIdentifiersSeen).toEqual([]);
    expect(output.nearCodesSeen).toEqual(["AN5120N"]);
    expect(ledger.find("https://chips.test/an5120n")?.nearCodes.has("AN5120>AN5120N")).toBe(true);
  });
});

describe("check_pages tool", () => {
  const SIMILAR = "https://store.test/products/space-warrior-mini";
  const similarHtml = `<html><head><title>Space Warrior Mini</title>
    <script type="application/ld+json">{"@type":"Product","name":"Space Warrior Mini","sku":"RCP887292","brand":{"name":"Toyland"},"offers":{"price":"19.99","priceCurrency":"USD"}}</script>
    </head><body><img src="https://cdn.test/mini-1.jpg"><img src="https://cdn.test/mini-2.jpg"></body></html>`;
  const load = async (url: string) => (url === SIMILAR ? page(url, similarHtml) : page(url, robotHtml));

  it("opens every page, records full evidence, and returns one compact line per page", async () => {
    const ledger = new EvidenceLedger();
    const tool = createCheckPagesTool(createPageSession({ rowIdentifiers, ledger, domainRules: noRules, load }));
    const output = JSON.parse(String(await tool.run({ urls: [ROBOT, SIMILAR, ROBOT] })));
    expect(output.pages).toHaveLength(2);
    const [hit, miss] = output.pages;
    expect(hit).toMatchObject({ url: ROBOT, status: 200, rowIdentifiersSeen: ["RCP887291"], images: 1 });
    expect(hit.text).toBeUndefined();
    expect(hit.links).toBeUndefined();
    expect(miss).toMatchObject({ product: "Space Warrior Mini", brand: "Toyland", price: "19.99 USD", rowIdentifiersSeen: [], images: 2 });
    expect(pageShowsImage(ledger.find(ROBOT)!, "https://cdn.test/robot-front-887291.jpg")).toBe(true);
  });

  it("shares the per-row and per-site budgets with fetch_page", async () => {
    const session = createPageSession({ rowIdentifiers, ledger: new EvidenceLedger(), domainRules: noRules, maxFetches: 3, maxFetchesPerSite: 2, load });
    const check = createCheckPagesTool(session);
    const fetch = createFetchPageTool(session);
    const output = JSON.parse(String(await check.run({ urls: [`${ROBOT}?a`, `${ROBOT}?b`, `${ROBOT}?c`] })));
    expect(output.pages[2].error).toContain("opened 2 pages on store.test");
    expect(output.pagesLeftForThisProduct).toBe(1);
    await fetch.run({ url: "https://other.test/p" });
    expect(JSON.parse(String(await fetch.run({ url: "https://third.test/p" }))).error).toContain("budget");
  });

  it("checks at most 15 URLs per call and says how many were skipped", async () => {
    const opened: string[] = [];
    const session = createPageSession({
      rowIdentifiers,
      ledger: new EvidenceLedger(),
      domainRules: noRules,
      load: async (url: string) => {
        opened.push(url);
        return page(url, robotHtml);
      },
    });
    const urls = Array.from({ length: 18 }, (_, i) => `https://site${i}.test/p`);
    const output = JSON.parse(String(await createCheckPagesTool(session).run({ urls })));
    expect(opened).toHaveLength(15);
    expect(output.skipped).toContain("3 URLs");
  });
});
