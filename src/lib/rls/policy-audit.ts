/**
 * Classify live `pg_policies` rows. Service-role `USING (true)` is expected;
 * the same predicate on anon/authenticated for a tenant table is a finding.
 */

const SERVICE_ROLE = /\bservice_role\b/;
const TENANT_KEY =
  /workspace_id|is_workspace_member|auth\.uid\(\)|auth\.jwt|owner_id|user_id\s*=/i;

export type PolicyRow = {
  tablename: string;
  policyname: string;
  cmd: string;
  roles: string;
  qual: string | null;
  with_check: string | null;
};

export const PUBLIC_CATALOG_TABLES = new Set(["subscription_plans"]);

export function rolesAreServiceOnly(roles: string): boolean {
  const cleaned = roles.replace(/[{}]/g, "");
  const parts = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => SERVICE_ROLE.test(part));
}

export function predicateIsOpen(sql: string | null): boolean {
  if (!sql) return false;
  return sql.trim().toLowerCase() === "true";
}

export function predicateIsTenantScoped(sql: string | null): boolean {
  if (!sql) return false;
  return TENANT_KEY.test(sql);
}

export function classifyPolicy(row: PolicyRow): "ok" | "open" | "unowned" {
  if (PUBLIC_CATALOG_TABLES.has(row.tablename)) return "ok";
  if (rolesAreServiceOnly(row.roles)) return "ok";
  const clauses = [row.qual, row.with_check];
  if (clauses.some(predicateIsOpen)) return "open";
  const relevant = clauses.filter((clause) => clause !== null);
  if (relevant.length === 0) return "unowned";
  if (relevant.every((clause) => predicateIsTenantScoped(clause))) return "ok";
  return "unowned";
}
