/**
 * Answer shapes Google AI Mode has produced (or, for the last group, could
 * produce) for the Agent 1 link prompt. Each fixture is the raw text a parser
 * receives plus what it must find. The first group is modelled on real
 * captured answers; the rest cover typographic and structural damage the
 * extractor has to survive, so a real answer is never lost to a weak parser.
 */
export interface AiModeFixture {
  name: string;
  text: string;
  /** URLs the parser must return, in order. Empty with `readable: true` means an explicit "no exact match". */
  urls: string[];
  readable: boolean;
}

const A = "https://haierlebanon.test/product/haier-hrf-570wh";
const B = "https://shop.example/p/hrf-570wh";

export const AI_MODE_FIXTURES: AiModeFixture[] = [
  {
    name: "pure JSON",
    text: JSON.stringify({ result: "MATCHES_FOUND", matches: [{ url: A, matchedOn: "code", evidence: "SKU HRF-570WH", differences: "none" }] }),
    urls: [A],
    readable: true,
  },
  {
    name: "fenced with json tag",
    text: '```json\n{"result":"MATCHES_FOUND","matches":[{"url":"' + A + '"}]}\n```',
    urls: [A],
    readable: true,
  },
  {
    name: "fence without a language tag, prose before and after",
    text: 'Here are the pages I found:\n```\n{"result":"MATCHES_FOUND","matches":[{"url":"' + A + '"}]}\n```\nLet me know if you want other sizes.',
    urls: [A],
    readable: true,
  },
  {
    name: "two fenced blocks, the first is an example object and the second is the answer",
    text:
      'Format:\n```json\n{"example":true}\n```\nAnswer:\n```json\n{"result":"MATCHES_FOUND","matches":[{"url":"' +
      A +
      '"}]}\n```',
    urls: [A],
    readable: true,
  },
  {
    name: "commentary object with braces before the answer",
    text: 'Searched {HRF-570WH} across shops. {"result":"MATCHES_FOUND","matches":[{"url":"' + B + '"}]}',
    urls: [B],
    readable: true,
  },
  {
    name: "smart quotes around every key and value",
    text: "{\u201Cresult\u201D:\u201CMATCHES_FOUND\u201D,\u201Cmatches\u201D:[{\u201Curl\u201D:\u201C" + A + "\u201D}]}",
    urls: [A],
    readable: true,
  },
  {
    name: "trailing commas",
    text: '{"result":"MATCHES_FOUND","matches":[{"url":"' + A + '",},{"url":"' + B + '",},],}',
    urls: [A, B],
    readable: true,
  },
  {
    name: "comments inside the JSON",
    text: '{\n  // best match first\n  "result": "MATCHES_FOUND",\n  "matches": [ /* two shops */ {"url": "' + A + '"}, {"url": "' + B + '"} ]\n}',
    urls: [A, B],
    readable: true,
  },
  {
    name: "raw line break inside a string value",
    text: '{"result":"MATCHES_FOUND","matches":[{"url":"' + A + '","evidence":"line one\nline two"}]}',
    urls: [A],
    readable: true,
  },
  {
    name: "a bare array of match objects",
    text: '[{"url":"' + A + '","matchedOn":"code"},{"url":"' + B + '"}]',
    urls: [A, B],
    readable: true,
  },
  {
    name: "a bare array of URL strings",
    text: '["' + A + '", "' + B + '"]',
    urls: [A, B],
    readable: true,
  },
  {
    name: "links present but result field missing",
    text: '{"matches":[{"url":"' + A + '"}]}',
    urls: [A],
    readable: true,
  },
  {
    name: "links present but result says NO_EXACT_MATCH",
    text: '{"result":"NO_EXACT_MATCH","matches":[{"url":"' + A + '"}]}',
    urls: [A],
    readable: true,
  },
  {
    name: "alternate key names (link / results)",
    text: '{"result":"MATCHES_FOUND","results":[{"link":"' + A + '"}]}',
    urls: [A],
    readable: true,
  },
  {
    name: "explicit no exact match",
    text: '{"result":"NO_EXACT_MATCH","matches":[]}',
    urls: [],
    readable: true,
  },
  {
    name: "snake_case matched_on field",
    text: '{"result":"MATCHES_FOUND","matches":[{"url":"' + A + '","matched_on":"barcode"}]}',
    urls: [A],
    readable: true,
  },
  {
    name: "prose only, no JSON",
    text: "I could not find a page that lists this exact item.",
    urls: [],
    readable: false,
  },
  {
    name: "empty answer",
    text: "",
    urls: [],
    readable: false,
  },
];
