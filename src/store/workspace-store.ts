import { create } from "zustand";
import type { Role } from "@/lib/permissions";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string;
  logo_url: string | null;
  cms_type: string;
  owner_id: string;
}

interface WorkspaceMember {
  id: string;
  user_id: string;
  role: Role;
  profiles?: { full_name: string; avatar_url: string | null };
}

interface WorkspaceStore {
  workspace: Workspace | null;
  role: Role | null;
  members: WorkspaceMember[];
  isLoading: boolean;
  creditsVersion: number;
  setWorkspace: (workspace: Workspace | null) => void;
  setRole: (role: Role | null) => void;
  setMembers: (members: WorkspaceMember[]) => void;
  setLoading: (loading: boolean) => void;
  invalidateCredits: () => void;
  reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  workspace: null,
  role: null,
  members: [],
  isLoading: true,
  creditsVersion: 0,
  setWorkspace: (workspace) => set({ workspace }),
  setRole: (role) => set({ role }),
  setMembers: (members) => set({ members }),
  setLoading: (isLoading) => set({ isLoading }),
  invalidateCredits: () => set((s) => ({ creditsVersion: s.creditsVersion + 1 })),
  reset: () => set({ workspace: null, role: null, members: [], isLoading: false, creditsVersion: 0 }),
}));
