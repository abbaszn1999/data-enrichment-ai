"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { User, Session } from "@supabase/supabase-js";

interface AuthState {
  user: User | null | undefined;
  session: Session | null;
  profile: { id: string; full_name: string; avatar_url: string | null } | null;
  isLoading: boolean;
  sessionReady: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: undefined,
    session: null,
    profile: null,
    isLoading: false,
    sessionReady: false,
  });

  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const supabase = createClient();

    async function loadProfile(userId: string) {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .eq("id", userId)
        .single();
      return data;
    }

    // onAuthStateChange always fires INITIAL_SESSION immediately on mount —
    // this is the most reliable way to get the session and set sessionReady.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setState((prev) => ({ ...prev, user, session, isLoading: false, sessionReady: true }));
      if (user) {
        setTimeout(() => {
          loadProfile(user.id).then((profile) => {
            setState((prev) => ({ ...prev, profile }));
          });
        }, 0);
      } else {
        setState((prev) => ({ ...prev, profile: null }));
      }
    });

    // Fallback: if onAuthStateChange is slow, getSession() ensures sessionReady is set
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const user = session?.user ?? null;
      setState((prev) => ({
        ...prev,
        user: prev.sessionReady ? prev.user : user,
        session: prev.sessionReady ? prev.session : session,
        isLoading: false,
        sessionReady: true,
      }));
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return state;
}
