"use client";

import { useState, useEffect } from "react";
import { FileSpreadsheet, Sun, Moon, Monitor, Undo2, Redo2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSheetStore } from "@/store/sheet-store";

export function Header() {
  const { fileName, rows, undo, redo, canUndo, canRedo, undoVersion } = useSheetStore();
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
