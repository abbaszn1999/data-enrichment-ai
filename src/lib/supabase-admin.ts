import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Singleton admin client that bypasses RLS — only use in server-side API routes
let _adminClient: SupabaseClient | null = null;

export function createAdminClient() {
  if (!_adminClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!serviceKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    }

    _adminClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminClient;
}
