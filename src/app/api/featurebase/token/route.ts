import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const base64Url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** HS256 JWT, the format Featurebase expects for secure messenger identification. */
function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

/**
 * Returns a short identity token for the signed-in user so the Featurebase
 * messenger (Fibi) can recognise them. Returns `{ token: null }` when
 * FEATUREBASE_JWT_SECRET is not configured; the widget then runs anonymously.
 * The secret never leaves the server.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401, headers: NO_STORE });
    }

    const secret = process.env.FEATUREBASE_JWT_SECRET;
    if (!secret) {
      return NextResponse.json({ token: null }, { headers: NO_STORE });
    }

    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const fullName =
      (typeof metadata.full_name === "string" && metadata.full_name) ||
      (typeof metadata.name === "string" && metadata.name) ||
      undefined;

    const token = signJwt(
      {
        userId: user.id,
        ...(user.email ? { email: user.email } : {}),
        ...(fullName ? { name: fullName } : {}),
      },
      secret,
    );

    return NextResponse.json({ token }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ token: null }, { headers: NO_STORE });
  }
}
