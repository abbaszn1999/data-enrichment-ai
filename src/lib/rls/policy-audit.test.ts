import { describe, expect, it } from "vitest";
import { classifyPolicy, type PolicyRow } from "./policy-audit";

function row(partial: Partial<PolicyRow>): PolicyRow {
  return {
    tablename: "gallery_sessions",
    policyname: "select",
    cmd: "SELECT",
    roles: "{public}",
    qual: "is_workspace_member(workspace_id)",
    with_check: null,
    ...partial,
  };
}

describe("classifyPolicy", () => {
  it("accepts membership-scoped tenant policies", () => {
    expect(classifyPolicy(row({}))).toBe("ok");
  });

  it("accepts service-role USING true", () => {
    expect(
      classifyPolicy(
        row({
          tablename: "webhook_events",
          roles: "{service_role}",
          qual: "true",
          with_check: "true",
        })
      )
    ).toBe("ok");
  });

  it("accepts the public pricing catalog", () => {
    expect(
      classifyPolicy(
        row({
          tablename: "subscription_plans",
          roles: "{public}",
          qual: "true",
        })
      )
    ).toBe("ok");
  });

  it("flags USING true on tenant tables for client roles", () => {
    expect(
      classifyPolicy(
        row({
          tablename: "profiles",
          policyname: "profiles_select",
          roles: "{public}",
          qual: "true",
        })
      )
    ).toBe("open");
  });

  it("flags invite policies that do not pin an identity", () => {
    expect(
      classifyPolicy(
        row({
          tablename: "workspace_invites",
          policyname: "invites_select",
          qual: "(accepted_at IS NULL AND expires_at > now())",
        })
      )
    ).toBe("unowned");
  });
});
