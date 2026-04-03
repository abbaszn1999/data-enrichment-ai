export type Role = "owner" | "admin" | "editor" | "viewer";

const ROLE_LEVELS: Record<Role, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

export function canEdit(role: Role): boolean {
  return ROLE_LEVELS[role] >= ROLE_LEVELS.editor;
}

export function canAdmin(role: Role): boolean {
  return ROLE_LEVELS[role] >= ROLE_LEVELS.admin;
}

export function canUpload(role: Role): boolean {
  return ROLE_LEVELS[role] >= ROLE_LEVELS.admin;
}

export function canImport(role: Role): boolean {
  return ROLE_LEVELS[role] >= ROLE_LEVELS.editor;
}

export function isOwner(role: Role): boolean {
  return role === "owner";
}

export function hasMinRole(userRole: Role, minRole: Role): boolean {
  return ROLE_LEVELS[userRole] >= ROLE_LEVELS[minRole];
}
