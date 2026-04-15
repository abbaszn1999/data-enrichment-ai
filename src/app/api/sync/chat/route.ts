import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";

const MODELS: Record<string, string> = {
  fast: "gemini-3.1-flash-lite-preview",
  pro: "gemini-3.1-pro-preview",
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const {
      messages,
      mode = "fast",
      integration,
    } = (await request.json()) as {
      messages: { role: string; content: string }[];
      mode: string;
      integration: {
        provider: string;
        integration_name: string;
        base_url: string;
      } | null;
    };

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ error: "No messages provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const model = MODELS[mode] || MODELS.fast;

    const integrationContext = integration
      ? `\nConnected Platform: ${integration.provider} (${integration.integration_name})
Store URL: ${integration.base_url}
You have access to this platform's data through the user's integration. When the user asks to fetch, sync, or modify data, acknowledge the connected platform and explain what you would do.`
      : "\nNo platform is currently connected.";

    const systemInstruction = `You are Sync AI — a professional data operations assistant inside DataSheet AI.
Your role is to help users manage, sync, and transform their product data.
${integrationContext}

Capabilities you should communicate:
- Import/fetch records from the connected platform
- Compare local sheet data with remote source
- Extract structured data from uploaded files (CSV, PDF, images)
- Search the web to enrich or find missing data
- Stage updates for review before applying
- Clean, map, and restructure datasets

Rules:
- Be concise and professional
- Use markdown formatting for clarity
- When the user asks to perform an action, describe the plan step by step
- Always confirm before destructive operations
- If no platform is connected, guide the user to Settings > Integrations
- Respond in the same language the user writes in`;

    const { GoogleGenAI } = await import("@google/genai");
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const contents = messages.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const response = await ai.models.generateContentStream({
            model,
            contents,
            config: {
              systemInstruction,
              temperature: mode === "pro" ? 0.7 : 0.4,
              maxOutputTokens: mode === "pro" ? 8192 : 4096,
            },
          });

          for await (const chunk of response) {
            const text = chunk.text || "";
            if (text) {
              controller.enqueue(new TextEncoder().encode(text));
            }
          }

          controller.close();
        } catch (err: any) {
          console.error("[Sync Chat] Streaming error:", err);
          controller.enqueue(
            new TextEncoder().encode(
              "\n\n⚠️ An error occurred while generating the response."
            )
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err: any) {
    console.error("[Sync Chat] Error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
