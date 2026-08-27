import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "./server-auth";

export async function platformAdminJson(
  handler: () => Promise<object>
): Promise<NextResponse> {
  const denied = await requirePlatformAdmin();
  if (denied) return denied;
  try {
    return NextResponse.json(await handler());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 500 }
    );
  }
}
