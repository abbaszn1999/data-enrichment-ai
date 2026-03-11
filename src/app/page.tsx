"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Header } from "@/components/header";
import { FileUpload } from "@/components/file-upload";
import { Sidebar } from "@/components/sidebar";
import { DataTable } from "@/components/data-table";
import { useSheetStore } from "@/store/sheet-store";
import { loadSession } from "@/lib/persistence";

export default function Home() {
  const { fileName, restoreSession } = useSheetStore();
  const [checking, setChecking] = useState(true);
  const [hasSaved, setHasSaved] = useState(false);

  useEffect(() => {
    if (fileName) {
      setChecking(false);
      return;
    }
    loadSession()
      .then((session) => {
        if (session && session.fileName && session.rows.length > 0) {
          setHasSaved(true);
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [fileName]);

  const handleRestore = async () => {
    const restored = await restoreSession();
    if (restored) {
      toast.success("Session restored", { description: "Your previous work has been loaded" });
    } else {
      toast.error("Failed to restore session");
    }
    setHasSaved(false);
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!fileName) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 56px)" }}>
          <div className="space-y-4">
            {hasSaved && (
              <div className="w-full max-w-xl mx-auto p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Previous session found</p>
                  <p className="text-xs text-muted-foreground">Would you like to continue where you left off?</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setHasSaved(false)}
                    className="text-xs px-3 py-1.5 rounded-md border hover:bg-muted transition-colors"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={handleRestore}
                    className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
                  >
                    Restore Session
                  </button>
                </div>
              </div>
            )}
            <FileUpload />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Header />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <DataTable />
      </div>
    </div>
  );
}
