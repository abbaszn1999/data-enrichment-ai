"use client";

import { useEffect, useState, useCallback } from "react";
import { getWorkspaceMembers, getWorkspaceInvites, type WorkspaceMember } from "@/lib/supabase";

interface TeamData {
  members: WorkspaceMember[];
  invites: any[];
}

const activeFetches = new Map<string, Promise<TeamData>>();
const cacheStore = new Map<string, { data: TeamData; ts: number }>();
const CACHE_TTL_MS = 15_000; // 15 seconds TTL

async function fetchTeamData(workspaceId: string): Promise<TeamData> {
  const [members, invites] = await Promise.all([
    getWorkspaceMembers(workspaceId),
    getWorkspaceInvites(workspaceId),
  ]);
  return { members, invites };
}

async function dedupedFetch(workspaceId: string, forceRefresh = false): Promise<TeamData> {
  const url = `team:${workspaceId}`;
  const cached = cacheStore.get(url);
  if (!forceRefresh && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  let promise = activeFetches.get(url);
  if (!promise) {
    promise = fetchTeamData(workspaceId).then((data) => {
      cacheStore.set(url, { data, ts: Date.now() });
      return data;
    }).finally(() => {
      activeFetches.delete(url);
    });
    activeFetches.set(url, promise);
  }
  return promise;
}

export function useTeam(workspaceId: string | null) {
  const [state, setState] = useState<{
    members: WorkspaceMember[];
    invites: any[];
    isLoading: boolean;
    error: string | null;
  }>(() => {
    if (workspaceId) {
      const cached = cacheStore.get(`team:${workspaceId}`);
      if (cached) {
        return {
          members: cached.data.members,
          invites: cached.data.invites,
          isLoading: false,
          error: null,
        };
      }
    }
    return {
      members: [],
      invites: [],
      isLoading: true,
      error: null,
    };
  });

  const refresh = useCallback(async (force = false) => {
    if (!workspaceId) return;
    try {
      const data = await dedupedFetch(workspaceId, force);
      setState({
        members: data.members,
        invites: data.invites,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      setState((prev) => ({ ...prev, isLoading: false, error: err.message }));
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh(false);
  }, [refresh]);

  return {
    ...state,
    refresh: () => refresh(true),
  };
}
