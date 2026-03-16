"use client";

import { useState } from "react";
import {
  Settings,
  Save,
  Upload,
  Trash2,
  AlertTriangle,
  Globe,
  Sparkles,
  Brain,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export default function DemoSettingsPage() {
  const [wsName, setWsName] = useState("TechStore Electronics");
  const [wsDescription, setWsDescription] = useState("Main electronics store product management");
  const [language, setLanguage] = useState("English");
  const [model, setModel] = useState("gemini-3.1-pro-preview");
  const [thinking, setThinking] = useState("low");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Settings className="h-5 w-5" /> Workspace Settings
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">Manage your workspace configuration</p>
      </div>

      {/* General */}
      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Building2 className="h-4 w-4" /> General
        </h2>

        <div className="space-y-2">
          <Label className="text-xs">Workspace Name</Label>
          <Input value={wsName} onChange={(e) => setWsName(e.target.value)} className="h-9" />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Description</Label>
          <textarea
            value={wsDescription}
            onChange={(e) => setWsDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-xs rounded-lg border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Workspace Logo</Label>
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-xl bg-muted flex items-center justify-center border-2 border-dashed">
              <Building2 className="h-6 w-6 text-muted-foreground" />
            </div>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs">
              <Upload className="h-3.5 w-3.5" /> Upload Logo
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Workspace Slug</Label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">/w/</span>
            <Input value="techstore-electronics" readOnly className="h-9 font-mono text-xs bg-muted/50" />
          </div>
        </div>
      </Card>

      {/* Default AI Settings */}
      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Default AI Settings
        </h2>
        <p className="text-[10px] text-muted-foreground">These defaults are used for new enrichment sessions. Can be overridden per session.</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1.5">
              <Globe className="h-3 w-3" /> Output Language
            </Label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full h-9 px-3 text-xs rounded-lg border bg-background"
            >
              <option value="English">English</option>
              <option value="Arabic">Arabic (العربية)</option>
              <option value="French">French</option>
              <option value="Spanish">Spanish</option>
              <option value="Turkish">Turkish</option>
              <option value="German">German</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> AI Model
            </Label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full h-9 px-3 text-xs rounded-lg border bg-background"
            >
              <option value="gemini-3.1-pro-preview">Pro (Best Quality)</option>
              <option value="gemini-3.1-flash-lite-preview">Flash (Fastest)</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1.5">
              <Brain className="h-3 w-3" /> Thinking Level
            </Label>
            <select
              value={thinking}
              onChange={(e) => setThinking(e.target.value)}
              className="w-full h-9 px-3 text-xs rounded-lg border bg-background"
            >
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
      </Card>

      {/* API Keys */}
      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold">API Configuration</h2>
        <div className="space-y-2">
          <Label className="text-xs">Gemini API Key (workspace override)</Label>
          <Input type="password" value="••••••••••••••••" readOnly className="h-9 font-mono text-xs" />
          <p className="text-[10px] text-muted-foreground">Leave empty to use the system default key</p>
        </div>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} className="gap-1.5 text-xs">
          <Save className="h-3.5 w-3.5" />
          {saved ? "Saved!" : "Save Settings"}
        </Button>
      </div>

      {/* Danger Zone */}
      <Card className="p-5 border-destructive/50">
        <h2 className="text-sm font-semibold text-destructive flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4" /> Danger Zone
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium">Delete Workspace</p>
            <p className="text-[10px] text-muted-foreground">Permanently delete this workspace and all its data. This cannot be undone.</p>
          </div>
          <Button variant="destructive" size="sm" className="gap-1.5 text-xs">
            <Trash2 className="h-3.5 w-3.5" /> Delete Workspace
          </Button>
        </div>
      </Card>
    </div>
  );
}
