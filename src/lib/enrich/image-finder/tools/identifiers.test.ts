import { describe, expect, it } from "vitest";
import {
  codeKeysInText,
  distinctiveWords,
  extractRowIdentifiers,
  identifiersSeenIn,
  isSpecificPartNumber,
  nearIdentifiersSeenIn,
  normalizeMatchText,
  wordsPresentRatio,
} from "./identifiers";

describe("isSpecificPartNumber", () => {
  it("accepts a specific part number (letters plus 3+ digits, 5+ chars) but not a family/series name", () => {
    expect(isSpecificPartNumber("AN253")).toBe(true);
    expect(isSpecificPartNumber("AN241")).toBe(true);
    expect(isSpecificPartNumber("ESP32")).toBe(false); // only 2 digits
    expect(isSpecificPartNumber("AN25")).toBe(false); // too short
  });
});

describe("nearIdentifiersSeenIn", () => {
  const ids = extractRowIdentifiers({ Part: "AN5120", Barcode: "4901234567894" });

  it("finds a near code for a 5-character part number, below the strong bar", () => {
    const shortIds = extractRowIdentifiers({ Part: "AN253" });
    expect(shortIds[0]!.strong).toBe(false);
    expect(nearIdentifiersSeenIn("Panasonic AN253P DIP-16", shortIds)).toEqual([
      { rowKey: "AN253", rowValue: "AN253", pageCode: "AN253P" },
    ]);
  });

  it("finds a code with one or two extra trailing letters, in either direction", () => {
    expect(nearIdentifiersSeenIn("Panasonic AN5120N DIP-16", ids)).toEqual([
      { rowKey: "AN5120", rowValue: "AN5120", pageCode: "AN5120N" },
    ]);
    expect(nearIdentifiersSeenIn("AN5120NK", ids).map((m) => m.pageCode)).toEqual(["AN5120NK"]);
    const longer = extractRowIdentifiers({ Part: "AN5120N" });
    expect(nearIdentifiersSeenIn("Part no. AN5120", longer).map((m) => m.pageCode)).toEqual(["AN5120"]);
  });

  it("ignores digit changes, three or more letters, the exact code and barcodes", () => {
    expect(nearIdentifiersSeenIn("AN5121 AN51201 AN5120 AN5120ABC", ids)).toEqual([]);
    expect(nearIdentifiersSeenIn("4901234567894A 490123456789", ids)).toEqual([]);
  });

  it("never treats a cut inside the code as a suffix", () => {
    const row = extractRowIdentifiers({ Model: "ESP32S3N" });
    // ESP32S is not "code + letters": the shorter code must end in a digit.
    expect(nearIdentifiersSeenIn("ESP32S board", row)).toEqual([]);
  });
});

describe("distinctiveWords", () => {
  it("keeps descriptive words and drops stop words, numbers, codes, URLs and list cells", () => {
    expect(
      distinctiveWords({
        Code: "RCP1151426",
        Description: "2.4G RC Engineering Vehicle (YELLOW) with 4 pcs set",
        Image: "https://cdn.test/a.jpg",
        Similar: "Red truck | Blue car | Green bus",
      })
    ).toEqual(["engineering", "vehicle", "yellow"]);
  });

  it("works for non-Latin scripts", () => {
    expect(distinctiveWords({ Name: "لعبة سيارة حمراء" })).toEqual(["لعبة", "سيارة", "حمراء"]);
  });
});

describe("wordsPresentRatio", () => {
  it("counts exact words and shared stems of four or more letters", () => {
    const page = normalizeMatchText("Running Shoes — Men's, white");
    expect(wordsPresentRatio(["shoe", "white", "running", "red"], page)).toBe(0.75);
    expect(wordsPresentRatio([], page)).toBe(0);
  });
});

describe("extractRowIdentifiers", () => {
  it("finds codes in any column without relying on column names, and skips prices and quantities", () => {
    const ids = extractRowIdentifiers({
      Code: "RCP1151426",
      Description: "2.4G RC ENGINEERING VEHICLE (YELLOW)",
      "Selling Price TTC": "299.99",
      Barcode: "3000000071502",
      "Tot Av. Qty.": "16",
    });
    const values = ids.map((id) => id.value);
    expect(values).toContain("RCP1151426");
    expect(values).toContain("3000000071502");
    expect(values).not.toContain("299.99");
    expect(values).not.toContain("16");
    expect(ids.find((id) => id.value === "RCP1151426")?.strong).toBe(true);
  });

  it("pulls model/version tokens and internal codes out of a free-text description", () => {
    const ids = extractRowIdentifiers({ Item: "Arduino Wifi Esp32-S3 631958 100432" });
    const byValue = new Map(ids.map((id) => [id.value, id]));
    expect(byValue.get("Esp32-S3")?.key).toBe("ESP32S3");
    expect(byValue.get("Esp32-S3")?.strong).toBe(true);
    expect(byValue.get("631958")?.strong).toBe(true);
    expect(byValue.has("100432")).toBe(true);
  });
});

describe("extractRowIdentifiers never treats quantities or measurements as identifiers", () => {
  it.each(["4PCS", "1000ML", "2.4G", "433MHz", "16GB", "PDQ30", "12V", "24PCS", "4K"])("skips %s", (token) => {
    expect(extractRowIdentifiers({ Description: `KUROMI KIT ${token} MIX` }).map((id) => id.value)).not.toContain(token);
  });

  it("still keeps the row's real codes next to them", () => {
    const ids = extractRowIdentifiers({ Code: "YWP1521278", Description: "KUROMI /KT 4PCS MIX", Barcode: "3000000050514" });
    expect(ids.map((id) => id.value).sort()).toEqual(["3000000050514", "YWP1521278"]);
  });
});

describe("extractRowIdentifiers with list-like columns", () => {
  it("ignores codes that only appear in similar / bought-with / keyword lists", () => {
    const ids = extractRowIdentifiers({
      product_name: "IC — AN241",
      filters: "Package: DIP | Manufacturer: Panasonic | Type: Audio Amplifier IC",
      keywords: "rf ics | sony rf ics | an241 rf ics | an355 rf ics | rf ic",
      similar: "IC — AN5732 [31] | IC — GL3201 [2875] | IC — AN5256 [217584]",
    });
    expect(ids.map((id) => id.value)).toEqual(["AN241"]);
  });

  it("keeps a code from a list segment labelled as an identifier", () => {
    const ids = extractRowIdentifiers({ specs: "MPN: XK-2231 | Colour: black | Buttons: 3" });
    expect(ids.map((id) => id.value)).toEqual(["XK-2231"]);
  });

  it("keeps several codes in an ordinary description", () => {
    const ids = extractRowIdentifiers({ Item: "Arduino Wifi Esp32-S3 631958 100432" });
    expect(ids).toHaveLength(3);
  });
});

describe("identifiersSeenIn", () => {
  const ids = extractRowIdentifiers({ Item: "Esp32-S3 631958" });

  it("matches on token boundaries, ignoring case and separators", () => {
    const seen = identifiersSeenIn('{"sku":"esp32s3-n16r8","barcode":"631958"}', ids);
    expect(seen.map((id) => id.value).sort()).toEqual(["631958", "Esp32-S3"]);
  });

  it("never matches a code inside a longer number", () => {
    expect(identifiersSeenIn("Part 16319580", ids)).toEqual([]);
  });

  it("does not confuse a neighbouring version", () => {
    expect(identifiersSeenIn("ESP32-S2 development board", ids)).toEqual([]);
  });
});

describe("codeKeysInText", () => {
  it("yields every separator-bounded run of a code token", () => {
    const keys = codeKeysInText("SKU: ESP32-S3-N16R8");
    for (const key of ["ESP32", "ESP32S3", "ESP32S3N16R8", "S3N16R8", "N16R8"]) expect(keys.has(key)).toBe(true);
  });
});
