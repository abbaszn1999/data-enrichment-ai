/** Minimal CSV reader for the builder's output (quoted cells may hold commas). */
export function parseCsv(csv: string): Record<string, string>[] {
  const splitLine = (line: string) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cell += '"';
          i += 1;
        }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") {
        cells.push(cell);
        cell = "";
      }
      else cell += ch;
    }
    return [...cells, cell];
  };
  const [header, ...lines] = csv.replace(/^\uFEFF/, "").split("\n").map(splitLine);
  return lines.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
}
