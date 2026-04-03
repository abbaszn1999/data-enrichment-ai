"use client";

import { canEdit, canAdmin, canUpload, canImport, isOwner, type Role } from "@/lib/permissions";

export function useRole(role: Role | null) {
  return {
    role,
    canEdit: role ? canEdit(role) : false,
    canAdmin: role ? canAdmin(role) : false,
    canUpload: role ? canUpload(role) : false,
    canImport: role ? canImport(role) : false,
    isOwner: role ? isOwner(role) : false,
  };
}
