import { NextRequest, NextResponse } from "next/server";
import { analyticsErrorResponse, requireAnalyticsAccess } from "@/lib/analytics/access";
import { deleteAnalyticsConnection } from "@/lib/analytics/connections";
import { isAnalyticsConnectionType } from "@/lib/analytics/types";
import { writeSecurityAuditLog } from "@/lib/security/audit-log";

export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") || "";
    const type = url.searchParams.get("type") || "";
    if (!isAnalyticsConnectionType(type)) {
      return NextResponse.json({ error: "Invalid connection type" }, { status: 400 });
    }
    const { user, admin } = await requireAnalyticsAccess(workspaceId, { admin: true });
    await deleteAnalyticsConnection(admin, workspaceId, type);
    await writeSecurityAuditLog(admin, {
      workspaceId,
      actorId: user.id,
      action: "analytics.disconnect",
      after: { type },
      request,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return analyticsErrorResponse(err);
  }
}
