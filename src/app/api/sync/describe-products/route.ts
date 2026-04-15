import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

const MODELS: Record<string, string> = {
  fast: "gemini-3.1-flash-lite-preview",
  pro: "gemini-3.1-pro-preview",
};

type ProductRow = {
  id?: string;
  title?: string;
  handle?: string;
  vendor?: string;
  product_type?: string;
  status?: string;
  [key: string]: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const {
      rows,
      mode = "fast",
      integration,
      instruction,
    } = (await request.json()) as {
      rows?: ProductRow[];
      mode?: "fast" | "pro";
      integration?: {
        provider?: string;
        integration_name?: string;
      } | null;
      instruction?: string;
    };

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No product rows provided" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "AI service not configured" }, { status: 500 });
    }

    const normalizedRows = rows.slice(0, 100).map((row, index) => ({
      rowIndex: index,
      id: String(row.id ?? ""),
      title: String(row.title ?? ""),
      handle: String(row.handle ?? ""),
      vendor: String(row.vendor ?? ""),
      product_type: String(row.product_type ?? ""),
      status: String(row.status ?? ""),
    }));

    const systemInstruction = `You generate product descriptions for a connected ecommerce catalog.
Return JSON only.
You will receive real product rows from the user's connected platform.
Write one distinct description for each row.
Rules:
- Use only the provided product data.
- Do not invent specifications, materials, sizes, or features that are not present.
- Keep each description concise, professional, and useful for catalog publishing.
- Each description should be 1 to 3 sentences.
- If data is sparse, write a conservative generic description based on title, vendor, and product type only.
- Preserve the rowIndex exactly as provided.
- Respond in the same language as the user's instruction if possible.`;

    const prompt = `Connected platform: ${integration?.provider || "unknown"}
Integration name: ${integration?.integration_name || "unknown"}
User instruction: ${instruction || "Write a description for each product"}

Product rows:
${JSON.stringify(normalizedRows, null, 2)}

Return valid JSON with this exact shape:
{
  "descriptions": [
    {
      "rowIndex": 0,
      "description": "..."
    }
  ]
}`;

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const model = MODELS[mode] || MODELS.fast;

    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction,
        temperature: mode === "pro" ? 0.6 : 0.3,
        maxOutputTokens: mode === "pro" ? 8192 : 4096,
        responseMimeType: "application/json",
      },
    });

    const text = response.text?.trim();
    if (!text) {
      return NextResponse.json({ error: "Empty AI response" }, { status: 500 });
    }

    let parsed: { descriptions?: { rowIndex: number; description: string }[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response", raw: text }, { status: 500 });
    }

    const descriptions = Array.isArray(parsed.descriptions) ? parsed.descriptions : [];

    return NextResponse.json({ descriptions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
