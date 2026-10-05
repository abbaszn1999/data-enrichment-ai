import { toStoredImageRef } from "./stored-image-ref";

/**
 * Pictures that live inside an xlsx instead of being links. Spreadsheet apps
 * store them in three different ways, all handled here:
 *  - floating pictures laid over cells (Excel "Insert > Picture", most tools),
 *  - WPS pictures placed in a cell (`=DISPIMG("ID_…",1)` + `xl/cellimages.xml`),
 *  - Excel "Place in cell" pictures (rich values: `vm` + `xl/richData/*`).
 * Only the first worksheet is read, matching what `parseExcelFile` imports.
 */

type Zip = import("jszip");

export interface SheetImage {
  /** 0-based sheet row. */
  row: number;
  /** 0-based sheet column. */
  col: number;
  /** Identifies the picture inside the file, so one picture used in many cells is stored once. */
  key: string;
  bytes: Uint8Array;
  mime: string;
  ext: string;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const MAX_SHEET_IMAGES = 5000;

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[match[1]] = match[2];
  return out;
}

function attrBySuffix(attrs: Record<string, string>, suffix: string): string | undefined {
  for (const [name, value] of Object.entries(attrs)) {
    if (name === suffix || name.endsWith(`:${suffix}`)) return value;
  }
  return undefined;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = baseDir ? baseDir.split("/") : [];
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment && segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

function relsPathFor(part: string): string {
  const i = part.lastIndexOf("/");
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
}

async function readText(zip: Zip, path: string): Promise<string | null> {
  const file = zip.file(path);
  return file ? file.async("text") : null;
}

interface Rel {
  target: string;
  type: string;
}

async function readRels(zip: Zip, part: string): Promise<Map<string, Rel>> {
  const map = new Map<string, Rel>();
  const xml = await readText(zip, relsPathFor(part));
  if (!xml) return map;
  const base = dirOf(part);
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.Id || !attrs.Target) continue;
    const external = attrs.TargetMode === "External";
    map.set(attrs.Id, {
      target: external ? attrs.Target : resolvePath(base, attrs.Target),
      type: attrs.Type ?? "",
    });
  }
  return map;
}

async function firstSheetPath(zip: Zip): Promise<string | null> {
  const workbook = await readText(zip, "xl/workbook.xml");
  if (workbook) {
    const sheetTag = workbook.match(/<(?:\w+:)?sheet\b([^>]*)\/?>/);
    if (sheetTag) {
      const rId = attrBySuffix(parseAttrs(sheetTag[1]), "id");
      if (rId) {
        const rels = await readRels(zip, "xl/workbook.xml");
        const target = rels.get(rId)?.target;
        if (target && zip.file(target)) return target;
      }
    }
  }
  return zip.file("xl/worksheets/sheet1.xml") ? "xl/worksheets/sheet1.xml" : null;
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!match) return null;
  return { col: columnIndex(match[1]), row: Number(match[2]) - 1 };
}

interface Placed {
  row: number;
  col: number;
  media: string;
}

/** Floating pictures: anchored to the cell where their top-left corner sits. */
async function floatingPictures(zip: Zip, sheetPath: string): Promise<Placed[]> {
  const sheetRels = await readRels(zip, sheetPath);
  const placed: Placed[] = [];
  for (const rel of sheetRels.values()) {
    if (!/\/drawing$/.test(rel.type)) continue;
    const xml = await readText(zip, rel.target);
    if (!xml) continue;
    const drawingRels = await readRels(zip, rel.target);
    const anchorRe = /<(?:\w+:)?(twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/g;
    for (const anchor of xml.matchAll(anchorRe)) {
      const block = anchor[2];
      const from = block.match(/<(?:\w+:)?from>([\s\S]*?)<\/(?:\w+:)?from>/);
      const col = from?.[1].match(/<(?:\w+:)?col>(\d+)</);
      const row = from?.[1].match(/<(?:\w+:)?row>(\d+)</);
      const blip = block.match(/<(?:\w+:)?blip\b([^>]*)>/);
      if (!col || !row || !blip) continue;
      const rId = attrBySuffix(parseAttrs(blip[1]), "embed");
      const media = rId ? drawingRels.get(rId)?.target : undefined;
      if (media) placed.push({ row: Number(row[1]), col: Number(col[1]), media });
    }
  }
  return placed;
}

/** WPS in-cell pictures: `=DISPIMG("ID_…",1)` resolved through xl/cellimages.xml. */
async function wpsCellPictures(zip: Zip, sheetXml: string): Promise<Placed[]> {
  if (!sheetXml.includes("DISPIMG")) return [];
  const registry = await readText(zip, "xl/cellimages.xml");
  if (!registry) return [];
  const rels = await readRels(zip, "xl/cellimages.xml");
  const mediaById = new Map<string, string>();
  for (const block of registry.matchAll(/<(?:\w+:)?cellImage\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellImage>/g)) {
    const name = block[1].match(/<(?:\w+:)?cNvPr\b([^>]*)>/);
    const blip = block[1].match(/<(?:\w+:)?blip\b([^>]*)>/);
    const id = name ? parseAttrs(name[1]).name : undefined;
    const rId = blip ? attrBySuffix(parseAttrs(blip[1]), "embed") : undefined;
    const media = rId ? rels.get(rId)?.target : undefined;
    if (id && media) mediaById.set(id, media);
  }
  const placed: Placed[] = [];
  for (const cell of cellsOf(sheetXml)) {
    if (!cell.body.includes("DISPIMG")) continue;
    const id = cell.body.match(/DISPIMG\(\s*(?:&quot;|&#34;|")([^"&]+)/)?.[1];
    const media = id ? mediaById.get(id) : undefined;
    const pos = parseCellRef(cell.ref);
    if (media && pos) placed.push({ ...pos, media });
  }
  return placed;
}

/** Excel "Place in cell" pictures: cell `vm` → metadata → rich value → related media. */
async function richValuePictures(zip: Zip, sheetXml: string): Promise<Placed[]> {
  if (!/\bvm="\d+"/.test(sheetXml)) return [];
  const [metadata, values, structures, relList] = await Promise.all([
    readText(zip, "xl/metadata.xml"),
    readText(zip, "xl/richData/rdrichvalue.xml"),
    readText(zip, "xl/richData/rdrichvaluestructure.xml"),
    readText(zip, "xl/richData/richValueRel.xml"),
  ]);
  if (!metadata || !values || !relList) return [];

  const futureBody = metadata.match(
    /<futureMetadata\b[^>]*name="XLRICHVALUE"[^>]*>([\s\S]*?)<\/futureMetadata>/
  )?.[1];
  const rvIndexByFutureBk = [...(futureBody ?? "").matchAll(/<(?:\w+:)?rvb\b[^>]*\bi="(\d+)"/g)].map((m) =>
    Number(m[1])
  );
  const valueBody = metadata.match(/<valueMetadata\b[^>]*>([\s\S]*?)<\/valueMetadata>/)?.[1] ?? "";
  const futureBkByVm = [...valueBody.matchAll(/<bk>([\s\S]*?)<\/bk>/g)].map((m) => {
    const v = m[1].match(/<rc\b[^>]*\bv="(\d+)"/)?.[1];
    return v === undefined ? -1 : Number(v);
  });

  const imageKeyIndexByStructure: number[] = [];
  for (const s of (structures ?? "").matchAll(/<s\b[^>]*>([\s\S]*?)<\/s>/g)) {
    const keys = [...s[1].matchAll(/<k\b[^>]*\bn="([^"]+)"/g)].map((m) => m[1]);
    const at = keys.indexOf("_rvRel:LocalImageIdentifier");
    imageKeyIndexByStructure.push(at < 0 ? 0 : at);
  }

  const richValues = [...values.matchAll(/<rv\b([^>]*)>([\s\S]*?)<\/rv>/g)].map((m) => ({
    structure: Number(parseAttrs(m[1]).s ?? 0),
    fields: [...m[2].matchAll(/<v>([^<]*)<\/v>/g)].map((v) => v[1]),
  }));

  const relRIds = [...relList.matchAll(/<(?:\w+:)?rel\b([^>]*)\/?>/g)].map((m) =>
    attrBySuffix(parseAttrs(m[1]), "id")
  );
  const rels = await readRels(zip, "xl/richData/richValueRel.xml");

  const placed: Placed[] = [];
  for (const cell of cellsOf(sheetXml)) {
    const vm = Number(parseAttrs(cell.attrs).vm);
    if (!vm) continue;
    const futureBk = futureBkByVm[vm - 1];
    const rvIndex = futureBk >= 0 ? rvIndexByFutureBk[futureBk] : undefined;
    const rv = rvIndex === undefined ? undefined : richValues[rvIndex];
    if (!rv) continue;
    const relIndex = Number(rv.fields[imageKeyIndexByStructure[rv.structure] ?? 0]);
    const rId = Number.isFinite(relIndex) ? relRIds[relIndex] : undefined;
    const media = rId ? rels.get(rId)?.target : undefined;
    const pos = parseCellRef(cell.ref);
    if (media && pos) placed.push({ ...pos, media });
  }
  return placed;
}

function* cellsOf(sheetXml: string): Generator<{ ref: string; attrs: string; body: string }> {
  for (const match of sheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = parseAttrs(match[1]).r;
    if (ref) yield { ref, attrs: match[1], body: match[2] ?? "" };
  }
}

/**
 * Every picture in the first worksheet with the cell it belongs to. Never
 * throws: a file whose pictures cannot be read simply yields none.
 */
export async function extractSheetImages(buffer: ArrayBuffer): Promise<SheetImage[]> {
  try {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return [];
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const sheetPath = await firstSheetPath(zip);
    if (!sheetPath) return [];
    const sheetXml = (await readText(zip, sheetPath)) ?? "";

    const placed = [
      ...(await floatingPictures(zip, sheetPath)),
      ...(await wpsCellPictures(zip, sheetXml)),
      ...(await richValuePictures(zip, sheetXml)),
    ].slice(0, MAX_SHEET_IMAGES);

    const bytesByMedia = new Map<string, Uint8Array | null>();
    const images: SheetImage[] = [];
    const seenCells = new Set<string>();
    for (const item of placed) {
      const ext = item.media.split(".").pop()?.toLowerCase() ?? "";
      const mime = MIME_BY_EXT[ext];
      if (!mime) continue;
      const cellKey = `${item.row}:${item.col}:${item.media}`;
      if (seenCells.has(cellKey)) continue;
      seenCells.add(cellKey);
      if (!bytesByMedia.has(item.media)) {
        const file = zip.file(item.media);
        bytesByMedia.set(item.media, file ? await file.async("uint8array") : null);
      }
      const data = bytesByMedia.get(item.media);
      if (!data || data.length === 0) continue;
      images.push({
        row: item.row,
        col: item.col,
        key: item.media,
        bytes: data,
        mime,
        ext: ext === "jpeg" ? "jpg" : ext,
      });
    }
    return images;
  } catch (error) {
    console.warn("Could not read pictures from the workbook:", error);
    return [];
  }
}

export interface ParsedSheetForImages {
  columns: string[];
  rows: Array<{ originalData: Record<string, string> }>;
  headerRowIndex: number;
  /** Header text per 0-based sheet column (`__EMPTY_n` when the header cell is blank). */
  headers: string[];
  /** 0-based sheet row of each parsed row. */
  rowSheetIndexes: number[];
}

export interface AttachedSheetImages {
  columns: string[];
  /** Cell values to merge into each parsed row, same order as `rows`. */
  rows: Array<Record<string, string>>;
  imageCount: number;
  imageColumns: string[];
}

const UPLOAD_CONCURRENCY = 4;

/**
 * Stores every picture and puts a `vz-storage:` reference in its cell. A
 * picture sitting in a column without a header becomes an "Image" column.
 */
export async function attachSheetImages(params: {
  images: SheetImage[];
  parsed: ParsedSheetForImages;
  /** Saves one picture and returns its Storage path. */
  upload: (image: SheetImage) => Promise<string>;
}): Promise<AttachedSheetImages> {
  const { images, parsed } = params;
  const rows = parsed.rows.map((row) => ({ ...row.originalData }));
  const columns = [...parsed.columns];
  const rowBySheet = new Map<number, number>();
  parsed.rowSheetIndexes.forEach((sheetRow, index) => rowBySheet.set(sheetRow, index));

  const usable = images.filter((image) => image.row > parsed.headerRowIndex && rowBySheet.has(image.row));
  if (usable.length === 0) return { columns, rows, imageCount: 0, imageColumns: [] };

  const pathByKey = new Map<string, string>();
  const unique = [...new Map(usable.map((image) => [image.key, image])).values()];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, unique.length) }, async () => {
      while (next < unique.length) {
        const image = unique[next++];
        try {
          pathByKey.set(image.key, await params.upload(image));
        } catch (error) {
          console.warn("Could not store a sheet picture:", error);
        }
      }
    })
  );

  const labelByCol = new Map<number, string>();
  const labelFor = (col: number): string => {
    const known = labelByCol.get(col);
    if (known) return known;
    const header = parsed.headers[col] ?? "";
    let label = header && !header.startsWith("__EMPTY") ? header : "";
    if (!label) {
      const taken = new Set([...columns, ...labelByCol.values()]);
      label = "Image";
      for (let n = 2; taken.has(label); n += 1) label = `Image ${n}`;
    }
    labelByCol.set(col, label);
    return label;
  };

  const cellRefs = new Map<string, string[]>();
  for (const image of usable) {
    const path = pathByKey.get(image.key);
    if (!path) continue;
    const label = labelFor(image.col);
    const index = rowBySheet.get(image.row)!;
    const cellKey = `${index}\u0000${label}`;
    const refs = cellRefs.get(cellKey) ?? [];
    const ref = toStoredImageRef(path);
    if (!refs.includes(ref)) refs.push(ref);
    cellRefs.set(cellKey, refs);
  }

  let imageCount = 0;
  const imageColumns = new Set<string>();
  for (const [cellKey, refs] of cellRefs) {
    const [indexText, label] = cellKey.split("\u0000");
    const index = Number(indexText);
    const existing = rows[index][label] ?? "";
    if (/^https?:\/\//i.test(existing)) continue;
    if (!columns.includes(label)) columns.push(label);
    rows[index][label] = refs.join("\n");
    imageColumns.add(label);
    imageCount += refs.length;
  }
  for (const row of rows) for (const label of imageColumns) row[label] ??= "";

  return { columns, rows, imageCount, imageColumns: [...imageColumns] };
}
