import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { attachSheetImages, extractSheetImages, type SheetImage } from "./sheet-images";

const PNG_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
const PNG_B = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]);

const WORKBOOK = `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const WORKBOOK_RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

async function build(files: Record<string, string | Uint8Array>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", WORKBOOK);
  zip.file("xl/_rels/workbook.xml.rels", WORKBOOK_RELS);
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("extractSheetImages", () => {
  it("reads floating pictures with their anchor cell", async () => {
    const buffer = await build({
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData/></worksheet>`,
      "xl/worksheets/_rels/sheet1.xml.rels": `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing7.xml"/></Relationships>`,
      "xl/drawings/drawing7.xml": `<xdr:wsDr xmlns:xdr="x" xmlns:a="a" xmlns:r="r">
        <xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>1</xdr:col><xdr:row>3</xdr:row></xdr:to>
          <xdr:pic><xdr:blipFill><a:blip r:embed="rId5"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor>
        <xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:row>3</xdr:row></xdr:from>
          <xdr:pic><xdr:blipFill><a:blip r:embed="rId6"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor>
      </xdr:wsDr>`,
      "xl/drawings/_rels/drawing7.xml.rels": `<Relationships><Relationship Target="../media/image1.png" Id="rId5" Type="image"/><Relationship Id="rId6" Type="image" Target="../media/image2.jpeg"/></Relationships>`,
      "xl/media/image1.png": PNG_A,
      "xl/media/image2.jpeg": PNG_B,
    });

    const images = await extractSheetImages(buffer);
    expect(images.map((i) => [i.row, i.col, i.mime, i.ext])).toEqual([
      [2, 0, "image/png", "png"],
      [3, 0, "image/jpeg", "jpg"],
    ]);
    expect(Array.from(images[0].bytes)).toEqual(Array.from(PNG_A));
  });

  it("reads WPS in-cell pictures from DISPIMG formulas", async () => {
    const buffer = await build({
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
        <row r="2"><c r="A2" t="str"><f>_xlfn.DISPIMG(&quot;ID_AAA&quot;,1)</f><v>#NAME?</v></c></row>
        <row r="3"><c r="A3" t="str"><f>_xlfn.DISPIMG("ID_BBB",1)</f><v>#NAME?</v></c></row>
        <row r="4"><c r="A4" t="str"><f>_xlfn.DISPIMG(&quot;ID_AAA&quot;,1)</f><v>#NAME?</v></c></row>
      </sheetData></worksheet>`,
      "xl/cellimages.xml": `<etc:cellImages xmlns:etc="e" xmlns:xdr="x" xmlns:a="a" xmlns:r="r">
        <etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="ID_AAA"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></etc:cellImage>
        <etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="ID_BBB"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill></xdr:pic></etc:cellImage>
      </etc:cellImages>`,
      "xl/_rels/cellimages.xml.rels": `<Relationships><Relationship Id="rId1" Type="image" Target="media/image1.png"/><Relationship Id="rId2" Type="image" Target="media/image2.png"/></Relationships>`,
      "xl/media/image1.png": PNG_A,
      "xl/media/image2.png": PNG_B,
    });

    const images = await extractSheetImages(buffer);
    expect(images.map((i) => [i.row, i.col, i.key])).toEqual([
      [1, 0, "xl/media/image1.png"],
      [2, 0, "xl/media/image2.png"],
      [3, 0, "xl/media/image1.png"],
    ]);
  });

  it("reads Excel in-cell pictures through rich values", async () => {
    const buffer = await build({
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
        <row r="2"><c r="B2" t="e" vm="1"><v>#VALUE!</v></c></row>
        <row r="3"><c r="B3" t="e" vm="2"><v>#VALUE!</v></c></row>
      </sheetData></worksheet>`,
      "xl/metadata.xml": `<metadata>
        <futureMetadata name="XLRICHVALUE" count="2"><bk><extLst><ext uri="u"><xlrd:rvb i="0"/></ext></extLst></bk><bk><extLst><ext uri="u"><xlrd:rvb i="1"/></ext></extLst></bk></futureMetadata>
        <valueMetadata count="2"><bk><rc t="1" v="0"/></bk><bk><rc t="1" v="1"/></bk></valueMetadata>
      </metadata>`,
      "xl/richData/rdrichvaluestructure.xml": `<rvStructures><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>`,
      "xl/richData/rdrichvalue.xml": `<rvData><rv s="0"><v>1</v><v>5</v></rv><rv s="0"><v>0</v><v>5</v></rv></rvData>`,
      "xl/richData/richValueRel.xml": `<richValueRels xmlns:r="r"><rel r:id="rId1"/><rel r:id="rId2"/></richValueRels>`,
      "xl/richData/_rels/richValueRel.xml.rels": `<Relationships><Relationship Id="rId1" Type="image" Target="../media/image1.png"/><Relationship Id="rId2" Type="image" Target="../media/image2.png"/></Relationships>`,
      "xl/media/image1.png": PNG_A,
      "xl/media/image2.png": PNG_B,
    });

    const images = await extractSheetImages(buffer);
    expect(images.map((i) => [i.row, i.col, i.key])).toEqual([
      [1, 1, "xl/media/image2.png"],
      [2, 1, "xl/media/image1.png"],
    ]);
  });

  it("returns nothing for files without pictures or that are not xlsx", async () => {
    expect(await extractSheetImages(await build({ "xl/worksheets/sheet1.xml": "<worksheet/>" }))).toEqual([]);
    expect(await extractSheetImages(new TextEncoder().encode("a,b\n1,2").buffer as ArrayBuffer)).toEqual([]);
  });
});

describe("attachSheetImages", () => {
  const image = (row: number, col: number, key: string): SheetImage => ({
    row,
    col,
    key,
    bytes: PNG_A,
    mime: "image/png",
    ext: "png",
  });

  const parsed = {
    columns: ["Name", "PIC"],
    headerRowIndex: 0,
    headers: ["Name", "PIC", "__EMPTY_2"],
    rowSheetIndexes: [1, 2, 4],
    rows: [
      { originalData: { Name: "A", PIC: "" } },
      { originalData: { Name: "B", PIC: "" } },
      { originalData: { Name: "C", PIC: "https://cdn.example.com/c.jpg" } },
    ],
  };

  it("puts a reference in the picture's own column and stores each picture once", async () => {
    const uploads: string[] = [];
    const result = await attachSheetImages({
      images: [image(1, 1, "m1"), image(2, 1, "m1"), image(4, 1, "m2")],
      parsed,
      upload: async (img) => {
        uploads.push(img.key);
        return `ws/catalog/images/${img.key}.png`;
      },
    });

    expect(uploads.sort()).toEqual(["m1", "m2"]);
    expect(result.imageCount).toBe(2);
    expect(result.rows[0].PIC).toBe("vz-storage:ws/catalog/images/m1.png");
    expect(result.rows[1].PIC).toBe("vz-storage:ws/catalog/images/m1.png");
    expect(result.rows[2].PIC).toBe("https://cdn.example.com/c.jpg");
    expect(result.columns).toEqual(["Name", "PIC"]);
  });

  it("creates an Image column when the picture sits under a blank header", async () => {
    const result = await attachSheetImages({
      images: [image(1, 2, "m1"), image(4, 2, "m1")],
      parsed,
      upload: async () => "p/x.png",
    });
    expect(result.columns).toEqual(["Name", "PIC", "Image"]);
    expect(result.imageColumns).toEqual(["Image"]);
    expect(result.rows.map((r) => r.Image)).toEqual(["vz-storage:p/x.png", "", "vz-storage:p/x.png"]);
  });

  it("ignores pictures on the header, on skipped rows, and pictures that fail to upload", async () => {
    const result = await attachSheetImages({
      images: [image(0, 1, "h"), image(3, 1, "blank"), image(1, 1, "bad")],
      parsed,
      upload: async () => {
        throw new Error("nope");
      },
    });
    expect(result.imageCount).toBe(0);
    expect(result.rows[0].PIC).toBe("");
  });
});
