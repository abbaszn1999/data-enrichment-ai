"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

export default function DebugPage() {
  const [log, setLog] = useState<string[]>([]);

  function addLog(msg: string) {
    console.log(msg);
    setLog((prev) => [...prev, `${new Date().toISOString().slice(11, 23)} ${msg}`]);
  }

  useEffect(() => {
    async function run() {
      const supabase = createClient();

      addLog("1. Getting session...");
      const { data: { session }, error: sessErr } = await supabase.auth.getSession();
      addLog(`2. Session: ${session ? `user=${session.user.email}` : "NULL"} err=${sessErr?.message || "none"}`);

      if (!session) {
        addLog("STOP: No session — this is the problem. User not authenticated on client side.");
        return;
      }

      addLog("3. Querying workspaces...");
      const { data: wsData, error: wsErr } = await supabase
        .from("workspaces")
        .select("id, slug, name")
        .limit(5);
      addLog(`4. Workspaces: ${JSON.stringify(wsData)} err=${wsErr?.message || "none"}`);

      if (wsData && wsData.length > 0) {
        const ws = wsData[0];
        addLog(`5. Getting role for workspace ${ws.slug}...`);
        const { data: roleData, error: roleErr } = await supabase
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", ws.id)
          .eq("user_id", session.user.id)
          .single();
        addLog(`6. Role: ${JSON.stringify(roleData)} err=${roleErr?.message || "none"}`);
      }

      addLog("7. Checking activity_log table...");
      const { data: actData, error: actErr } = await supabase
        .from("activity_log")
        .select("*")
        .limit(1);
      addLog(`8. Activity: ${JSON.stringify(actData)} err=${actErr?.message || "none"}`);

      addLog("DONE");
    }

    run();
  }, []);

  return (
    <div className="p-6 font-mono text-xs space-y-1">
      <h1 className="text-lg font-bold mb-4">Debug Page</h1>
      {log.map((l, i) => (
        <div key={i} className={l.includes("STOP") || l.includes("err=") && !l.includes("err=none") ? "text-red-500" : "text-green-500"}>
          {l}
        </div>
      ))}
      {log.length === 0 && <div className="text-yellow-500">Running tests...</div>}
    </div>
  );
}
