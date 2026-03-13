"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FileSpreadsheet,
  Plus,
  Trash2,
  Copy,
  Clock,
  Search,
  ArrowUpDown,
  MoreVertical,
  FolderOpen,
  Loader2,
  Upload,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  getProjects,
  createProject,
  deleteProject,
  duplicateProject,
  insertRows,
  type DBProject,
} from "@/lib/supabase";
import { parseExcelFile } from "@/lib/excel";
import { DEFAULT_ENRICHMENT_COLUMNS, DEFAULT_ENRICHMENT_SETTINGS } from "@/types";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<DBProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"updated" | "created" | "name">("updated");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const data = await getProjects();
      setProjects(data);
    } catch (err) {
      console.error("Failed to load projects:", err);
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleCreate = async () => {
    if (!projectName.trim() || !selectedFile) return;
    setCreating(true);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const { columns, rows: parsedRows } = await parseExcelFile(buffer);

      // Create project in Supabase
      const project = await createProject({
        name: projectName.trim(),
        file_name: selectedFile.name,
        original_columns: columns,
        source_columns: [...columns],
        enrichment_columns: DEFAULT_ENRICHMENT_COLUMNS.map((c) => ({ ...c, enabled: true })),
        enrichment_settings: DEFAULT_ENRICHMENT_SETTINGS,
        row_count: parsedRows.length,
      });

      // Insert rows in Supabase
      const dbRows = parsedRows.map((r) => ({
        project_id: project.id,
        row_index: r.rowIndex,
        status: "pending" as const,
        error_message: null,
        original_data: r.originalData,
        enriched_data: {},
      }));

      await insertRows(dbRows);

      toast.success("Project created!", { description: `${parsedRows.length} rows imported` });
      setShowCreate(false);
      setProjectName("");
      setSelectedFile(null);

      // Navigate to the project
      router.push(`/project/${project.id}`);
    } catch (err) {
      console.error("Failed to create project:", err);
      toast.error("Failed to create project", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast.success("Project deleted");
    } catch (err) {
      toast.error("Failed to delete project");
    }
    setDeleteConfirm(null);
  };

  const handleDuplicate = async (id: string, name: string) => {
    try {
      const newProject = await duplicateProject(id, `${name} (copy)`);
      setProjects((prev) => [newProject, ...prev]);
      toast.success("Project duplicated");
    } catch (err) {
      toast.error("Failed to duplicate project");
    }
  };

  // Filter & sort
  const filtered = projects
    .filter((p) =>
      searchQuery
        ? p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.file_name.toLowerCase().includes(searchQuery.toLowerCase())
        : true
    )
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "created") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-20">
        <div className="flex items-center justify-between h-14 px-6">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-primary">
              <FileSpreadsheet className="h-5 w-5 text-primary-foreground" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">DataSheet AI</h1>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Title & Actions */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Your Projects</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {projects.length} project{projects.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>

        {/* Search & Sort */}
        {projects.length > 0 && (
          <div className="flex items-center gap-3 mb-6">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
              <input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-9 pr-4 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 text-xs">
                  <ArrowUpDown className="h-3 w-3" />
                  {sortBy === "updated" ? "Last Modified" : sortBy === "created" ? "Date Created" : "Name"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSortBy("updated")}>Last Modified</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("created")}>Date Created</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("name")}>Name</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {/* Empty state */}
        {!loading && projects.length === 0 && (
          <Card className="flex flex-col items-center justify-center py-20 px-8 border-dashed">
            <div className="p-4 rounded-full bg-muted mb-4">
              <FolderOpen className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No projects yet</h3>
            <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
              Create your first project by uploading an Excel or CSV file with product data.
            </p>
            <Button onClick={() => setShowCreate(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Create New Project
            </Button>
          </Card>
        )}

        {/* Project Grid */}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((project) => {
              const progress = project.row_count > 0
                ? Math.round((project.enriched_count / project.row_count) * 100)
                : 0;

              return (
                <Card
                  key={project.id}
                  className="group relative p-5 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer"
                  onClick={() => router.push(`/project/${project.id}`)}
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm truncate">{project.name}</h3>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{project.file_name}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <MoreVertical className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => router.push(`/project/${project.id}`)}>
                          <FolderOpen className="h-3.5 w-3.5 mr-2" />
                          Open
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(project.id, project.name)}>
                          <Copy className="h-3.5 w-3.5 mr-2" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteConfirm(project.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-3 mb-3">
                    <Badge variant="secondary" className="text-[10px] font-mono gap-1">
                      {project.row_count} rows
                    </Badge>
                    {project.enriched_count > 0 && (
                      <Badge variant="secondary" className="text-[10px] gap-1 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        {project.enriched_count} enriched
                      </Badge>
                    )}
                  </div>

                  {/* Progress bar */}
                  {project.enriched_count > 0 && (
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-3">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}

                  {/* Time */}
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {timeAgo(project.updated_at)}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* No search results */}
        {!loading && projects.length > 0 && filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No projects match &quot;{searchQuery}&quot;</p>
          </div>
        )}
      </main>

      {/* Create Project Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create New Project
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Project Name */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Project Name</label>
              <input
                autoFocus
                type="text"
                placeholder="e.g. BABYLISS Products"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full h-10 px-3 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* File Upload */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Upload File</label>
              <div
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) {
                    setSelectedFile(file);
                    if (!projectName.trim()) {
                      setProjectName(file.name.replace(/\.(xlsx|xls|csv)$/i, ""));
                    }
                  }
                }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => document.getElementById("create-file-input")?.click()}
                className={`
                  flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed rounded-xl cursor-pointer transition-all
                  ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"}
                  ${selectedFile ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/10" : ""}
                `}
              >
                <input
                  id="create-file-input"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setSelectedFile(file);
                      if (!projectName.trim()) {
                        setProjectName(file.name.replace(/\.(xlsx|xls|csv)$/i, ""));
                      }
                    }
                  }}
                />
                {selectedFile ? (
                  <>
                    <FileSpreadsheet className="h-8 w-8 text-green-600" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-400">{selectedFile.name}</span>
                    <span className="text-xs text-muted-foreground">Click to change file</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Drag & drop or click to browse
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      .xlsx, .xls, .csv
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)} disabled={creating}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!projectName.trim() || !selectedFile || creating}
                className="gap-2"
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Create
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Delete Project
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete this project and all its data. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
