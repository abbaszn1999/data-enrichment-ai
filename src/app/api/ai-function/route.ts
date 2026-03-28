import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ── Types ──────────────────────────────────────────

export interface AiFunctionPlan {
  summary: string;
  functionBody: string;
  targetColumn: string;
  newColumn?: string;
  warnings?: string[];
}

// ── POST: User command → AI generates a JS function ──

export async function POST(request: NextRequest) {
  try {
    const { command, columns, sampleRows, totalRows, selectedRows } = await request.json();

    if (!command || !columns || !sampleRows) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const systemPrompt = `You are a data manipulation code generator. You receive column names + sample rows from a product spreadsheet and a user command in any language.

Your job: write a JavaScript function body that transforms each row according to the command.

AVAILABLE COLUMNS: ${JSON.stringify(columns)}

SAMPLE DATA (first 5 rows):
${JSON.stringify(sampleRows, null, 2)}

TOTAL ROWS: ${totalRows}
SELECTED ROWS: ${selectedRows}

RULES:
- The function receives one argument: \`row\` — an object where keys are column names, values are strings.
- The function must return an object with ONLY the columns that changed. Example: \`{ "PRICE": "900.00" }\`
- Return an empty object \`{}\` if this row should NOT be changed.
- All returned values MUST be strings.
- For math: parse numbers with parseFloat(), compute, return .toFixed(2).
- For text: use standard JS string methods.
- The function body must be pure JavaScript — no imports, no async, no DOM.
- Be precise with column names — they must match EXACTLY.
- The function will be applied ONLY to selected rows — do NOT add extra filtering conditions for selection.

RESPONSE FORMAT (return ONLY this JSON, no markdown):
{
  "summary": "Human-readable description (same language as command)",
  "functionBody": "the JS function body as a string — receives 'row' arg, returns changes object",
  "targetColumn": "the main column being read/modified",
  "newColumn": "if creating a new column, its name — otherwise omit this field",
  "warnings": ["optional"]
}

EXAMPLES:

Command: "apply 10% discount to products where price > 1000"
Columns include "RETAIL PRICE HT"
→ {
  "summary": "Apply 10% discount to RETAIL PRICE HT where price > 1000",
  "functionBody": "const price = parseFloat(row[\\"RETAIL PRICE HT\\"]); if (isNaN(price) || price <= 1000) return {}; return { \\"RETAIL PRICE HT\\": (price * 0.9).toFixed(2) };",
  "targetColumn": "RETAIL PRICE HT"
}

Command: "uppercase all product names"
Columns include "PRODUCT NAME"
→ {
  "summary": "Convert all PRODUCT NAME values to uppercase",
  "functionBody": "const name = row[\\"PRODUCT NAME\\"]; if (!name) return {}; return { \\"PRODUCT NAME\\": name.toUpperCase() };",
  "targetColumn": "PRODUCT NAME"
}

Command: "create SALE PRICE = RETAIL PRICE HT * 0.85"
→ {
  "summary": "Create new column SALE PRICE = RETAIL PRICE HT x 0.85",
  "functionBody": "const price = parseFloat(row[\\"RETAIL PRICE HT\\"]); if (isNaN(price)) return { \\"SALE PRICE\\": \\"\\" }; return { \\"SALE PRICE\\": (price * 0.85).toFixed(2) };",
  "targetColumn": "RETAIL PRICE HT",
  "newColumn": "SALE PRICE"
}

Command: "replace Samsung with SAMSUNG in DESCRIPTION"
→ {
  "summary": "Replace 'Samsung' with 'SAMSUNG' in DESCRIPTION column",
  "functionBody": "const desc = row[\\"DESCRIPTION\\"]; if (!desc || !desc.includes(\\"Samsung\\")) return {}; return { \\"DESCRIPTION\\": desc.replaceAll(\\"Samsung\\", \\"SAMSUNG\\") };",
  "targetColumn": "DESCRIPTION"
}`;

    const result = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: [{ role: "user", parts: [{ text: command }] }],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.1,
      },
    });

    const text = result.text?.trim() || "";

    // Parse JSON (strip markdown code fences if present)
    let jsonStr = text;
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const plan: AiFunctionPlan = JSON.parse(jsonStr);

    if (!plan.summary || !plan.functionBody || !plan.targetColumn) {
      return NextResponse.json({ error: "Invalid response from AI — missing summary, functionBody, or targetColumn" }, { status: 500 });
    }

    // Validate function by trying to construct it
    try {
      new Function("row", plan.functionBody);
    } catch (syntaxErr: any) {
      return NextResponse.json({ error: `AI generated invalid function: ${syntaxErr.message}` }, { status: 500 });
    }

    console.log(`[AI Function] "${command}" → target: ${plan.targetColumn}${plan.newColumn ? `, new col: ${plan.newColumn}` : ""}`);

    return NextResponse.json({ plan });
  } catch (err: any) {
    console.error("[AI Function] Error:", err);
    return NextResponse.json({ error: err?.message || "Failed to process command" }, { status: 500 });
  }
}
