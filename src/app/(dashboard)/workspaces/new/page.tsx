"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Building2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { createWorkspace } from "@/lib/supabase";

const CMS_TYPES = [
  { value: "shopify", label: "Shopify" },
  { value: "woocommerce", label: "WooCommerce" },
  { value: "bigcommerce", label: "BigCommerce" },
  { value: "salla", label: "Salla" },
  { value: "zid", label: "Zid" },
  { value: "magento", label: "Magento" },
  { value: "custom", label: "Custom / Other" },
];

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
}

export default function NewWorkspacePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [cmsType, setCmsType] = useState("custom");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugEdited) {
      setSlug(generateSlug(val));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Workspace name is required");
      return;
    }
    if (!slug.trim()) {
      setError("Slug is required");
      return;
    }

    setLoading(true);
    try {
      const ws = await createWorkspace({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim(),
        cms_type: cmsType,
      });
      router.push(`/w/${ws.slug}`);
    } catch (err: any) {
      if (err?.message?.includes("duplicate")) {
        setError("A workspace with this slug already exists");
      } else {
        setError(err?.message || "Failed to create workspace");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto p-6 space-y-6">
        <Link
          href="/workspaces"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to workspaces
        </Link>

        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Create Workspace</h1>
            <p className="text-xs text-muted-foreground">
              Set up a new workspace for your products
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-xs font-medium">
                Workspace Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                placeholder="e.g. My Electronics Store"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="h-10"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug" className="text-xs font-medium">
                URL Slug
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">/w/</span>
                <Input
                  id="slug"
                  placeholder="my-store"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value);
                    setSlugEdited(true);
                  }}
                  className="h-9 text-sm font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cms" className="text-xs font-medium">
                CMS / Platform Type
              </Label>
              <select
                id="cms"
                value={cmsType}
                onChange={(e) => setCmsType(e.target.value)}
                className="w-full h-10 px-3 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {CMS_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">
                Determines default export templates and field suggestions
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="desc" className="text-xs font-medium">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <textarea
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this workspace..."
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <Button type="submit" className="w-full h-10" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create Workspace
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
