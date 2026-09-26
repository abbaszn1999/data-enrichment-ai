import { describe, expect, it } from "vitest";
import { EvidenceLedger } from "./evidence";
import { guardImageFinderAnswer } from "./guards";
import {
  extractRowIdentifiers,
  identifiersSeenIn,
  nearIdentifiersSeenIn,
  normalizeMatchText,
} from "./tools/identifiers";

const PAGE = "https://store.test/products/esp32-s3-board";
const OTHER = "https://market.test/item/esp32-s3-board";
const IMG1 = "https://cdn.test/esp32s3-front-631958.jpg";
const IMG2 = "https://cdn.test/esp32s3-back-631958.jpg";

function ledgerWith(pages: Array<{ url: string; text: string; images: string[]; status?: number }>, rowData: Record<string, string>) {
  const rowIdentifiers = extractRowIdentifiers(rowData);
  const ledger = new EvidenceLedger();
  for (const page of pages) {
    ledger.recordPage({
      url: page.url,
      finalUrl: page.url,
      status: page.status ?? 200,
      identifiers: identifiersSeenIn(page.text, rowIdentifiers),
      imageUrls: page.images,
      nearCodes: nearIdentifiersSeenIn(page.text, rowIdentifiers),
      matchText: normalizeMatchText(page.text),
    });
  }
  return { ledger, rowIdentifiers };
}

const answer = (images: Array<{ url: string; pageUrl: string }>, matchBasis = "identifier") => ({
  status: "found",
  verification: { pageUrl: PAGE, identifierSeen: "631958", matchBasis },
  images,
  notes: "",
});

describe("guardImageFinderAnswer", () => {
  const row = { Item: "Arduino Wifi Esp32-S3 631958" };

  it("accepts images from the verified page and from other pages that show the same identifier", () => {
    const { ledger, rowIdentifiers } = ledgerWith(
      [
        { url: PAGE, text: "SKU 631958 ESP32-S3", images: [IMG1] },
        { url: OTHER, text: "Code 631958", images: [IMG2] },
      ],
      row
    );
    const result = guardImageFinderAnswer({
      answer: answer([{ url: IMG1, pageUrl: PAGE }, { url: IMG2, pageUrl: OTHER }, { url: `${IMG1}?width=400`, pageUrl: PAGE }]),
      ledger,
      rowIdentifiers,
    });
    expect(result.found).toBe(true);
    expect(result.matchBasis).toBe("identifier");
    expect(result.images.map((image) => image.imageUrl)).toEqual([IMG1, IMG2]);
  });

  it("rejects images from a page of a different version, even if it looks similar", () => {
    const { ledger, rowIdentifiers } = ledgerWith(
      [
        { url: PAGE, text: "SKU 631958", images: [IMG1] },
        { url: OTHER, text: "ESP32-S2 board 631957", images: [IMG2] },
      ],
      row
    );
    const result = guardImageFinderAnswer({ answer: answer([{ url: IMG2, pageUrl: OTHER }]), ledger, rowIdentifiers });
    expect(result.images).toEqual([]);
    expect(result.rejections[0]).toContain("does not show the same item");
  });

  it("rejects image links that never appeared on the cited page", () => {
    const { ledger, rowIdentifiers } = ledgerWith([{ url: PAGE, text: "631958", images: [IMG1] }], row);
    const result = guardImageFinderAnswer({ answer: answer([{ url: IMG2, pageUrl: PAGE }]), ledger, rowIdentifiers });
    expect(result.images).toEqual([]);
  });

  it("rejects a verified page that failed to open or shows none of the row's identifiers", () => {
    const failed = ledgerWith([{ url: PAGE, text: "631958", images: [IMG1], status: 403 }], row);
    expect(guardImageFinderAnswer({ answer: answer([]), ...failed }).found).toBe(false);
    const unrelated = ledgerWith([{ url: PAGE, text: "some other board", images: [IMG1] }], row);
    expect(guardImageFinderAnswer({ answer: answer([]), ...unrelated }).found).toBe(false);
  });

  it("labels a match without a strong identifier as a model/variant match", () => {
    const { ledger, rowIdentifiers } = ledgerWith(
      [{ url: PAGE, text: "Model X2-4K board", images: [IMG1] }],
      { Item: "X2-4K board", Code: "INT-00012345" }
    );
    const result = guardImageFinderAnswer({
      answer: { ...answer([{ url: IMG1, pageUrl: PAGE }], "model_variant"), verification: { pageUrl: PAGE, identifierSeen: "X2-4K", matchBasis: "model_variant" } },
      ledger,
      rowIdentifiers,
    });
    expect(result.found).toBe(true);
    expect(result.matchBasis).toBe("model_variant");
    expect(result.images).toHaveLength(1);
  });

  it("returns not found when the model says so", () => {
    const { ledger, rowIdentifiers } = ledgerWith([], row);
    expect(guardImageFinderAnswer({ answer: { status: "not_found", images: [] }, ledger, rowIdentifiers }).found).toBe(false);
  });

  it("treats a short part number as an exact match when the row has nothing more specific", () => {
    const partRow = { Name: "IC | AN241", Id: "12457" };
    const { ledger, rowIdentifiers } = ledgerWith([{ url: PAGE, text: "AN241 DIP14 Panasonic", images: [IMG1] }], partRow);
    expect(rowIdentifiers.every((id) => !id.strong)).toBe(true);
    const result = guardImageFinderAnswer({ answer: answer([{ url: IMG1, pageUrl: PAGE }]), ledger, rowIdentifiers });
    expect(result.matchBasis).toBe("identifier");
    expect(result.matchNote).toBe("");
  });

  it("keeps a family name (too few digits) as a model match", () => {
    const familyRow = { Name: "ESP32 dev board" };
    const { ledger, rowIdentifiers } = ledgerWith([{ url: PAGE, text: "ESP32 board", images: [IMG1] }], familyRow);
    const result = guardImageFinderAnswer({ answer: answer([{ url: IMG1, pageUrl: PAGE }]), ledger, rowIdentifiers });
    expect(result.matchBasis).toBe("model_variant");
  });

  it("gives an exact code match no note", () => {
    const { ledger, rowIdentifiers } = ledgerWith([{ url: PAGE, text: "SKU 631958", images: [IMG1] }], row);
    const result = guardImageFinderAnswer({ answer: answer([{ url: IMG1, pageUrl: PAGE }]), ledger, rowIdentifiers });
    expect(result.matchNote).toBe("");
  });
});

describe("guardImageFinderAnswer — near codes", () => {
  const chipRow = { Part: "AN5120", Description: "IC TV signal processor" };
  const A = "https://chips-a.test/p/an5120n";
  const B = "https://chips-b.test/item/an5120n-dip";
  const IMG_A = "https://cdn.chips-a.test/an5120n-top-20240101.jpg";
  const IMG_B = "https://cdn.chips-b.test/an5120n-pins-20240101.jpg";
  const nearAnswer = (images: Array<{ url: string; pageUrl: string }>, pageUrl = A) => ({
    status: "found",
    verification: { pageUrl, identifierSeen: "AN5120N", brandSeen: "", matchBasis: "near_identifier" },
    images,
  });

  it("accepts a near code confirmed on two websites, labels it, and keeps images from pages with that code", () => {
    const { ledger, rowIdentifiers } = ledgerWith(
      [
        { url: A, text: "Panasonic AN5120N DIP-16", images: [IMG_A] },
        { url: B, text: "AN5120N integrated circuit", images: [IMG_B] },
      ],
      chipRow
    );
    const result = guardImageFinderAnswer({
      answer: nearAnswer([{ url: IMG_A, pageUrl: A }, { url: IMG_B, pageUrl: B }]),
      ledger,
      rowIdentifiers,
    });
    expect(result.found).toBe(true);
    expect(result.matchBasis).toBe("near_identifier");
    expect(result.matchNote).toBe("Near code: the page shows AN5120N, the sheet has AN5120.");
    expect(result.images).toHaveLength(2);
  });

  it("requires a second independent website", () => {
    const { ledger, rowIdentifiers } = ledgerWith(
      [
        { url: A, text: "AN5120N DIP-16", images: [IMG_A] },
        { url: `${A}?tab=specs`, text: "AN5120N specs", images: [] },
      ],
      chipRow
    );
    const result = guardImageFinderAnswer({ answer: nearAnswer([{ url: IMG_A, pageUrl: A }]), ledger, rowIdentifiers });
    expect(result.found).toBe(false);
    expect(result.rejections[0]).toContain("only one website");
  });

  it("is refused when any opened page shows the exact code", () => {
    const { ledger, rowIdentifiers } = ledgerWith(
      [
        { url: A, text: "AN5120N DIP-16", images: [IMG_A] },
        { url: B, text: "AN5120N", images: [IMG_B] },
        { url: "https://other.test/an5120", text: "AN5120 exact part", images: [] },
      ],
      chipRow
    );
    const result = guardImageFinderAnswer({ answer: nearAnswer([{ url: IMG_A, pageUrl: A }]), ledger, rowIdentifiers });
    expect(result.found).toBe(false);
    expect(result.rejections[0]).toContain("exact code appears");
  });

  it("rejects images from pages that show a different near code", () => {
    const { ledger, rowIdentifiers } = ledgerWith(
      [
        { url: A, text: "AN5120N", images: [IMG_A] },
        { url: B, text: "AN5120N", images: [] },
        { url: "https://chips-c.test/an5120s", text: "AN5120S SMD", images: [IMG_B] },
      ],
      chipRow
    );
    const result = guardImageFinderAnswer({
      answer: nearAnswer([{ url: IMG_A, pageUrl: A }, { url: IMG_B, pageUrl: "https://chips-c.test/an5120s" }]),
      ledger,
      rowIdentifiers,
    });
    expect(result.images.map((image) => image.imageUrl)).toEqual([IMG_A]);
  });
});

describe("guardImageFinderAnswer — best match for rows without codes", () => {
  const toyRow = { Description: "Unicorn plush toy with rainbow mane, pink", Brand: "Cuddle Co" };
  const P1 = "https://toys.test/p/unicorn-plush";
  const P2 = "https://market.test/i/cuddle-unicorn";
  const P3 = "https://toys.test/p/dragon-plush";
  const I1 = "https://cdn.toys.test/unicorn-front-20250101.jpg";
  const I2 = "https://cdn.market.test/unicorn-side-20250101.jpg";
  const I3 = "https://cdn.toys.test/dragon-front-20250101.jpg";
  const bestAnswer = (images: Array<{ url: string; pageUrl: string }>, brandSeen = "Cuddle Co") => ({
    status: "found",
    verification: { pageUrl: P1, identifierSeen: "", brandSeen, matchBasis: "best_match" },
    images,
  });
  const pages = [
    { url: P1, text: "Cuddle Co Unicorn Plush Toy — rainbow mane, pink, 30 cm", images: [I1] },
    { url: P2, text: "Cuddle Co pink unicorn plush with rainbow mane", images: [I2] },
    { url: P3, text: "Cuddle Co Dragon Plush Toy green", images: [I3] },
  ];

  it("accepts a page with the row's brand and most of its distinctive words, and labels it", () => {
    const { ledger, rowIdentifiers } = ledgerWith(pages, toyRow);
    expect(rowIdentifiers).toEqual([]);
    const result = guardImageFinderAnswer({
      answer: bestAnswer([{ url: I1, pageUrl: P1 }, { url: I2, pageUrl: P2 }]),
      ledger,
      rowIdentifiers,
      rowData: toyRow,
    });
    expect(result.found).toBe(true);
    expect(result.matchBasis).toBe("best_match");
    expect(result.matchNote).toBe("Best match by title and brand (no code in the sheet).");
    expect(result.images).toHaveLength(2);
  });

  it("rejects images from a different candidate of the same brand (no mixing)", () => {
    const { ledger, rowIdentifiers } = ledgerWith(pages, toyRow);
    const result = guardImageFinderAnswer({
      answer: bestAnswer([{ url: I1, pageUrl: P1 }, { url: I3, pageUrl: P3 }]),
      ledger,
      rowIdentifiers,
      rowData: toyRow,
    });
    expect(result.images.map((image) => image.imageUrl)).toEqual([I1]);
    expect(result.rejections[0]).toContain("does not show the same item");
  });

  it("requires the brand in both the row and on the page", () => {
    const { ledger, rowIdentifiers } = ledgerWith(pages, toyRow);
    const missing = guardImageFinderAnswer({ answer: bestAnswer([], ""), ledger, rowIdentifiers, rowData: toyRow });
    expect(missing.found).toBe(false);
    const notInRow = guardImageFinderAnswer({ answer: bestAnswer([], "Plushland"), ledger, rowIdentifiers, rowData: toyRow });
    expect(notInRow.rejections[0]).toContain("not in this row's data");
  });

  it("rejects a page that shares the brand but too few of the row's words", () => {
    const { ledger, rowIdentifiers } = ledgerWith(
      [{ url: P1, text: "Cuddle Co Dragon Plush Toy green", images: [I1] }],
      toyRow
    );
    const result = guardImageFinderAnswer({ answer: bestAnswer([{ url: I1, pageUrl: P1 }]), ledger, rowIdentifiers, rowData: toyRow });
    expect(result.found).toBe(false);
    expect(result.rejections[0]).toContain("closely enough");
  });

  it("refuses rows with too little description to match safely", () => {
    const thin = { Description: "Cuddle Co toy" };
    const { ledger, rowIdentifiers } = ledgerWith(pages, thin);
    const result = guardImageFinderAnswer({ answer: bestAnswer([]), ledger, rowIdentifiers, rowData: thin });
    expect(result.found).toBe(false);
    expect(result.rejections[0]).toContain("too little description");
  });

  it("never applies best match to rows that have a code", () => {
    const coded = { ...toyRow, Code: "CUD778812" };
    const { ledger, rowIdentifiers } = ledgerWith(pages, coded);
    const result = guardImageFinderAnswer({ answer: bestAnswer([{ url: I1, pageUrl: P1 }]), ledger, rowIdentifiers, rowData: coded });
    expect(result.found).toBe(false);
  });
});
