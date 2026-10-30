import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe("Markdown", () => {
  it("draws a mermaid fence as a diagram instead of showing its source", () => {
    const html = render('خطة:\n\n```mermaid\nflowchart TD\n  a["قراءة"] --> b["تسعير"]\n```\n');
    expect(html).not.toContain("flowchart");
    expect(html).toContain("animate-pulse");
  });

  it("keeps other code left to right inside an Arabic reply", () => {
    const html = render("التنفيذ:\n\n```graphql\nmutation { productVariantsBulkUpdate }\n```\n");
    expect(html).toContain('<pre dir="ltr"');
    expect(html).toContain("productVariantsBulkUpdate");
  });
});
