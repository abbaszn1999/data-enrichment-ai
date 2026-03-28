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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          lock: (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => fn(),
        },
      }
    );
  }
  return client;
}
