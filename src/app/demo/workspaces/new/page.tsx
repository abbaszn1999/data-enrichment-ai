"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, ArrowRight, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function generateSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

export default function DemoNewWorkspacePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [cmsType, setCmsType] = useState("");
  const [loading, setLoading] = useState(false);

  const handleNameChange = (val: string) => {
    setName(val);
    setSlug(generateSlug(val));
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1500));
    router.push("/demo/dashboard");
  };

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Building2 className="h-5 w-5" /> Create Workspace
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">Set up a new workspace for your store</p>
      </div>

      <Card className="p-6 space-y-5">
        <div className="space-y-2">
          <Label className="text-xs">Workspace Name</Label>
          <Input
            placeholder="e.g. My Electronics Store"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="h-10"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Description (optional)</Label>
          <textarea
            placeholder="Brief description of this workspace..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Store Platform (CMS)</Label>
          <select
            value={cmsType}
            onChange={(e) => setCmsType(e.target.value)}
            className="w-full h-10 px-3 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">Select your platform...</option>
            <optgroup label="International">
              <option value="shopify">Shopify</option>
              <option value="woocommerce">WooCommerce</option>
              <option value="magento">Magento / Adobe Commerce</option>
              <option value="bigcommerce">BigCommerce</option>
              <option value="prestashop">PrestaShop</option>
              <option value="opencart">OpenCart</option>
            </optgroup>
            <optgroup label="Middle East">
              <option value="salla">Salla (سلة)</option>
              <option value="zid">Zid (زد)</option>
            </optgroup>
            <optgroup label="Marketplaces">
              <option value="amazon">Amazon</option>
              <option value="noon">Noon</option>
              <option value="ebay">eBay</option>
            </optgroup>
            <optgroup label="Other">
              <option value="custom_csv">Custom CSV</option>
              <option value="custom_api">Custom API</option>
            </optgroup>
          </select>
          {cmsType && (
            <p className="text-[10px] text-muted-foreground">
              Export format will be optimized for <span className="font-semibold capitalize">{cmsType.replace('_', ' ')}</span>
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs">URL Slug</Label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">/w/</span>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="h-9 font-mono text-xs"
              placeholder="auto-generated"
            />
          </div>
          {slug && (
            <p className="text-[10px] text-muted-foreground">
              Your workspace URL: <code className="bg-muted px-1 py-0.5 rounded">/w/{slug}</code>
            </p>
          )}
        </div>

        <Button onClick={handleCreate} disabled={!name.trim() || !cmsType || loading} className="w-full h-10 gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {loading ? "Creating workspace..." : "Create Workspace"}
        </Button>
      </Card>
    </div>
  );
}
