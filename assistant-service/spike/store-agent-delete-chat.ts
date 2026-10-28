// Delete Store Agent chats left behind by spikes: agent memory, files and rows.
// Run: npx tsx --env-file=.env.local --env-file=../.env.local spike/store-agent-delete-chat.ts <chatId> [chatId...]
import { createClient } from "@supabase/supabase-js";
import { installDnsCache } from "../src/dns-cache";
import { createResilientFetch } from "../src/store-agent/resilient-fetch";
import { SupabaseAgentStoreBackend } from "../src/store-agent/agent-store/supabase-backend";
import { WriteBehindAgentStore } from "../src/store-agent/agent-store/write-behind-store";
import { deleteChatData } from "../src/store-agent/routes";
installDnsCache();

const chatIds = process.argv.slice(2);
if (!chatIds.length) throw new Error("usage: store-agent-delete-chat.ts <chatId> [chatId...]");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false }, global: { fetch: createResilientFetch() } });
const store = new WriteBehindAgentStore(new SupabaseAgentStoreBackend(db), console.log);

for (const id of chatIds) {
  const { data: chat } = await db.from("store_agent_chats").select("id, workspace_id, cursor_agent_id, title").eq("id", id).maybeSingle();
  if (!chat) {
    console.log(`${id}: not found`);
    continue;
  }
  await deleteChatData({ db, store }, chat as { id: string; workspace_id: string; cursor_agent_id: string | null });
  console.log(`${id}: deleted (${chat.title})`);
}
await store.flush();
