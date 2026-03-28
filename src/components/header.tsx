"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Sun, Moon, Monitor, Undo2, Redo2, ArrowLeft, Cloud, CloudOff, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSheetStore } from "@/store/sheet-store";

export function Header() {
  const router = useRouter();
  const { fileName, rows, undo, redo, canUndo, canRedo, undoVersion, saveStatus, projectId, activeSheet, setActiveSheet } = useSheetStore();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hasUndo = mounted ? canUndo() : false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hasRedo = mounted ? canRedo() : false;

  useEffect(() => setMounted(true), []);

  const doneCount = rows.filter((r) => r.status === "done").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const processingCount = rows.filter((r) => r.status === "processing").length;

  const cycleTheme = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  const resolvedTheme = mounted ? theme : undefined;
  const themeIcon = resolvedTheme === "dark" ? <Moon className="h-4 w-4" /> : resolvedTheme === "light" ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />;

  return (
    <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-20 shrink-0">
      <div className="flex items-center justify-between h-12 px-4">
        <div className="flex items-center gap-3">
          {/* Back to projects */}
          {projectId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 -ml-1"
              onClick={() => router.push("/projects")}
              title="Back to Projects"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}

          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-primary">
              <FileSpreadsheet className="h-4 w-4 text-primary-foreground" />
            </div>
            <h1 className="font-bold text-sm tracking-tight">DataSheet AI</h1>
          </div>

          {fileName && (
            <>
              <span className="text-muted-foreground/30">|</span>
              <span className="text-xs text-muted-foreground truncate max-w-[250px]">
                {fileName}
              </span>
            </>
          )}

          {/* Sheet Toggle */}
          {fileName && (
            <>
              <span className="text-muted-foreground/30">|</span>
              <div className="flex items-center bg-muted rounded-lg p-0.5">
                <button
                  onClick={() => setActiveSheet("existing")}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    activeSheet === "existing"
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Existing
                </button>
                <button
                  onClick={() => setActiveSheet("new")}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    activeSheet === "new"
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  New
                </button>
              </div>
            </>
          )}

          {/* Save status */}
          {projectId && mounted && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground ml-1">
              {saveStatus === "saving" && (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Saving...</span>
                </>
              )}
              {saveStatus === "saved" && (
                <>
                  <Cloud className="h-3 w-3 text-green-500" />
                  <span className="text-green-600 dark:text-green-400">Saved</span>
                </>
              )}
              {saveStatus === "unsaved" && (
                <>
                  <CloudOff className="h-3 w-3 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400">Unsaved</span>
                </>
              )}
              {saveStatus === "error" && (
                <>
                  <CloudOff className="h-3 w-3 text-red-500" />
                  <span className="text-red-600 dark:text-red-400">Save failed</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {fileName && (
            <>
              {processingCount > 0 && (
                <Badge variant="secondary" className="text-[10px] gap-1 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200">
                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Processing {processingCount}
                </Badge>
              )}
              {doneCount > 0 && (
                <Badge variant="secondary" className="text-[10px] gap-1 bg-green-50 dark:bg-green-950/30 text-green-700 border-green-200">
                  {doneCount} done
                </Badge>
              )}
              {errorCount > 0 && (
                <Badge variant="secondary" className="text-[10px] gap-1 bg-red-50 dark:bg-red-950/30 text-red-700 border-red-200">
                  {errorCount} errors
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] font-mono">
                {rows.length} rows
              </Badge>
            </>
          )}

          {fileName && (
            <div className="flex items-center gap-0.5 border-l pl-2 ml-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={undo}
                disabled={!hasUndo}
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={redo}
                disabled={!hasRedo}
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={cycleTheme} title={mounted ? `Theme: ${theme}` : undefined}>
            {themeIcon}
          </Button>
        </div>
      </div>
    </header>
  );
}
