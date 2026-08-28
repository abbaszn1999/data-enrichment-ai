import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function createClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          flowType: "pkce",
          // The SDK's default auto-detection races with our own explicit
          // exchange in /auth/callback (whichever runs first "wins", and the
          // loser silently keeps whatever session was already in the
          // browser — e.g. an admin's own session — instead of the invited
          // user's). /auth/callback is the single, deliberate consumer of
          // ?code=/token_hash, so disable auto-detection everywhere else.
          detectSessionInUrl: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          lock: (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => fn(),
        },
      }
    );
  }
  return client;
}
