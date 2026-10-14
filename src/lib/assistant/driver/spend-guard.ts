/**
 * Credit-spending controls (`data-agent-spend`) can only be clicked with an
 * approval token. Tokens are created here in the browser when the user presses
 * Approve on the confirmation card, are bound to one control, work once and
 * expire. The agent can only pass a token along; it cannot make one.
 */

const TOKEN_TTL_MS = 5 * 60 * 1000;

type Approval = { target: string; expiresAt: number };
const approvals = new Map<string, Approval>();

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function issueApproval(target: string): string {
  const token = randomToken();
  approvals.set(token, { target, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

/** Returns true once for a valid token bound to this target. */
export function consumeApproval(target: string, token: string | undefined): boolean {
  if (!token) return false;
  const approval = approvals.get(token);
  if (!approval) return false;
  approvals.delete(token);
  return approval.target === target && approval.expiresAt > Date.now();
}

export function clearApprovals() {
  approvals.clear();
}

export function isSpendControl(element: Element): boolean {
  return element.hasAttribute("data-agent-spend");
}
