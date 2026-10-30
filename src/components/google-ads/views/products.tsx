"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Ban, Bot, CheckCircle2, ChevronRight, Clock, PackageX, ShoppingBag, Split, Trash2, Wand2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { catalogFix, groupMetrics, productMetrics, productsInGroup } from "@/lib/google-ads/analytics";
import { money } from "@/lib/google-ads/metrics";
import { gid } from "@/lib/google-ads/mutations";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { ListingDimension, ListingGroup, MutateOp, Product } from "@/lib/google-ads/types";
import { metricColumns } from "../ga-columns";
import { BulkButton, GaTable, type GaColumn } from "../ga-table";
import { Card, EmptyState, ImageTile, Pill, Segmented, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";
import { SearchBox } from "./campaigns";

const STATUS: Record<Product["status"], { label: string; tone: "good" | "warn" | "bad" | "info"; icon: typeof CheckCircle2 }> = {
  APPROVED: { label: "Approved", tone: "good", icon: CheckCircle2 },
  LIMITED: { label: "Limited", tone: "warn", icon: AlertTriangle },
  DISAPPROVED: { label: "Disapproved", tone: "bad", icon: XCircle },
  PENDING: { label: "Pending review", tone: "info", icon: Clock },
};

export function ProductsView() {
  const { data, range, currency } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const setView = useGoogleAds((s) => s.setView);
  const [filter, setFilter] = useState<"ALL" | "ISSUES" | "OUT" | "TOP">("ALL");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const metrics = useMemo(() => productMetrics(data, range), [data, range]);

  if (!data.account.merchantCenterId) {
    return (
      <div>
        <ViewHeader title="Products" />
        <EmptyState
          icon={ShoppingBag}
          title="Link Merchant Center to see products"
          body="Shopping and feed-based Performance Max campaigns use your Merchant Center product feed. Link it to see every product's status and performance."
          action={
            <button type="button" onClick={() => setView("links")} className="rounded-lg border border-border/70 px-3 py-2 text-xs font-semibold hover:bg-muted">
              Go to linked accounts
            </button>
          }
        />
      </div>
    );
  }

  const counts = {
    APPROVED: data.products.filter((p) => p.status === "APPROVED").length,
    LIMITED: data.products.filter((p) => p.status === "LIMITED").length,
    DISAPPROVED: data.products.filter((p) => p.status === "DISAPPROVED").length,
    PENDING: data.products.filter((p) => p.status === "PENDING").length,
  };
  const topIds = new Set([...data.products].sort((a, b) => metrics.get(b.id)!.conversionsValue - metrics.get(a.id)!.conversionsValue).slice(0, 5).map((p) => p.id));
  const rows = data.products
    .filter((p) => p.title.toLowerCase().includes(query.toLowerCase()) || p.id.includes(query.toLowerCase()))
    .filter((p) => (filter === "ISSUES" ? p.issues.length > 0 : filter === "OUT" ? p.availability !== "IN_STOCK" : filter === "TOP" ? topIds.has(p.id) : true));
  const fixable = data.products.filter((p) => p.issues.some((i) => i.fixable));
  const open = data.products.find((p) => p.id === openId);

  const fix = (ids: string[]) => {
    const items = data.products.filter((p) => ids.includes(p.id) && p.issues.some((i) => i.fixable)).map(catalogFix);
    if (!items.length) return toast.info("Nothing the catalog can fix in this selection");
    const res = applyDirect(`Fix ${items.length} product${items.length > 1 ? "s" : ""} from catalog`, [{ kind: "collection.upsert", collection: "products", items }]);
    if (res.ok) toast.success(`Sent ${items.length} corrected product${items.length > 1 ? "s" : ""} to Merchant Center`);
    setSelected(new Set());
  };

  const exclude = (ids: string[]) => {
    const shopping = data.campaigns.find((c) => c.type === "SHOPPING" && c.status !== "REMOVED");
    const root = data.listingGroups.find((g) => g.campaignId === shopping?.id && !g.parentId);
    if (!root) return toast.error("No Shopping product groups to exclude from");
    const nodes: ListingGroup[] = ids.map((id) => ({ id: gid("lg"), campaignId: root.campaignId, parentId: root.id, dimension: "ITEM_ID", value: id, excluded: true }));
    applyDirect(`Exclude ${ids.length} product${ids.length > 1 ? "s" : ""} from Shopping`, [{ kind: "collection.upsert", collection: "listingGroups", items: nodes }]);
    setSelected(new Set());
  };

  const columns: GaColumn<Product>[] = [
    {
      id: "title",
      header: "Product",
      label: "Product",
      sticky: true,
      sortValue: (p) => p.title,
      render: (p) => (
        <button type="button" onClick={() => setOpenId(openId === p.id ? null : p.id)} className="flex max-w-80 items-center gap-2.5 text-left">
          <ImageTile label={p.id.replace("sku-", "")} className="h-9 w-9 shrink-0 rounded-md" />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-[#400095] hover:underline dark:text-violet-300">{p.title}</span>
            <span className="block truncate text-[10px] text-muted-foreground">{p.id} · {p.productType}</span>
          </span>
        </button>
      ),
    },
    {
      id: "status",
      header: "Status",
      label: "Status",
      sortValue: (p) => p.status,
      render: (p) => {
        const s = STATUS[p.status];
        return (
          <span className="flex flex-col items-start gap-0.5">
            <Pill tone={s.tone}>
              <s.icon className="h-3 w-3" /> {s.label}
            </Pill>
            {p.issues.length > 0 && <span className="text-[10px] text-muted-foreground">{p.issues.length} issue{p.issues.length > 1 ? "s" : ""}</span>}
          </span>
        );
      },
    },
    {
      id: "price",
      header: "Price",
      label: "Price",
      align: "right",
      sortValue: (p) => p.salePrice ?? p.price,
      render: (p) => (
        <span className="whitespace-nowrap">
          {p.salePrice ? (
            <>
              <span className="font-semibold">{money(p.salePrice, currency)}</span> <span className="text-muted-foreground line-through">{money(p.price, currency)}</span>
            </>
          ) : (
            money(p.price, currency)
          )}
        </span>
      ),
    },
    {
      id: "benchmark",
      header: "vs. market",
      label: "Price competitiveness",
      align: "right",
      hideable: true,
      sortValue: (p) => (p.benchmarkPrice ? (p.salePrice ?? p.price) / p.benchmarkPrice : 1),
      render: (p) => {
        if (!p.benchmarkPrice) return <span className="text-muted-foreground">—</span>;
        const diff = ((p.salePrice ?? p.price) - p.benchmarkPrice) / p.benchmarkPrice;
        return <span className={cn("font-semibold", diff > 0.03 ? "text-red-600" : diff < -0.03 ? "text-emerald-600" : "text-muted-foreground")}>{diff > 0 ? "+" : ""}{(diff * 100).toFixed(0)}%</span>;
      },
    },
    {
      id: "stock",
      header: "Availability",
      label: "Availability",
      hideable: true,
      render: (p) => (p.availability === "IN_STOCK" ? <span className="text-muted-foreground">In stock</span> : <Pill tone="bad">{p.availability === "OUT_OF_STOCK" ? "Out of stock" : "Pre-order"}</Pill>),
    },
    ...metricColumns<Product>((p) => metrics.get(p.id)!, currency, { keys: ["impressions", "clicks", "cost", "conversions", "conversionsValue", "roas"] }),
  ];

  return (
    <div className="space-y-4">
      <ViewHeader
        title="Products"
        subtitle={`Merchant Center ${data.account.merchantCenterId} · performance across Shopping and Performance Max`}
        actions={
          <>
            <SearchBox value={query} onChange={setQuery} placeholder="Find a product or ID" />
            <button type="button" onClick={() => runAgentTurn("Fix my Merchant Center product issues")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-xs font-semibold hover:bg-muted">
              <Bot className="h-3.5 w-3.5" /> Ask agent
            </button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(Object.keys(counts) as Product["status"][]).map((k) => {
          const s = STATUS[k];
          return (
            <Card key={k} className="flex items-center gap-3 p-4">
              <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", s.tone === "good" ? "bg-emerald-500/10 text-emerald-600" : s.tone === "warn" ? "bg-amber-500/10 text-amber-600" : s.tone === "bad" ? "bg-red-500/10 text-red-600" : "bg-sky-500/10 text-sky-600")}>
                <s.icon className="h-4 w-4" />
              </span>
              <div>
                <p className="text-2xl font-black tabular-nums">{counts[k]}</p>
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
              </div>
            </Card>
          );
        })}
      </div>
      {fixable.length > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-[#400095]/20 bg-[#400095]/[0.03] p-4">
          <Wand2 className="h-5 w-5 text-[#400095] dark:text-violet-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{fixable.length} products can be fixed from your catalog</p>
            <p className="text-xs text-muted-foreground">Missing GTINs, long titles and price mismatches are corrected with Catalog Intelligence data and resubmitted to Merchant Center.</p>
          </div>
          <button type="button" onClick={() => fix(fixable.map((p) => p.id))} className="rounded-lg bg-[#400095] px-3 py-2 text-xs font-semibold text-white hover:bg-[#33007a] dark:bg-violet-600">
            Fix {fixable.length} products
          </button>
        </Card>
      )}
      <Segmented
        value={filter}
        onChange={setFilter}
        size="xs"
        options={[
          { value: "ALL", label: "All products", count: data.products.length },
          { value: "ISSUES", label: "With issues", count: data.products.filter((p) => p.issues.length).length },
          { value: "OUT", label: "Out of stock", count: data.products.filter((p) => p.availability !== "IN_STOCK").length },
          { value: "TOP", label: "Top sellers" },
        ]}
      />
      {open && (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <ImageTile label={open.id.replace("sku-", "")} className="h-16 w-16 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{open.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {open.id} · {open.brand} · {open.productType} · GTIN {open.gtin ?? "missing"} {open.customLabel0 && `· label: ${open.customLabel0}`}
              </p>
              {open.issues.length ? (
                <div className="mt-2 space-y-1.5">
                  {open.issues.map((i) => (
                    <p key={i.code} className={cn("flex gap-2 rounded-lg p-2 text-[11px]", i.severity === "DISAPPROVED" ? "bg-red-500/10" : "bg-amber-500/10")}>
                      <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", i.severity === "DISAPPROVED" ? "text-red-600" : "text-amber-600")} />
                      <span className="flex-1">{i.detail}</span>
                      <Pill tone={i.fixable ? "brand" : "neutral"}>{i.fixable ? "Fixable from catalog" : "Needs manual change"}</Pill>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-emerald-600">No issues. This product is serving.</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {open.issues.some((i) => i.fixable) && <BulkButton onClick={() => fix([open.id])}><Wand2 className="h-3 w-3" /> Fix from catalog</BulkButton>}
              <BulkButton onClick={() => exclude([open.id])}><Ban className="h-3 w-3" /> Exclude from ads</BulkButton>
            </div>
          </div>
        </Card>
      )}
      <GaTable
        rows={rows}
        columns={columns}
        rowKey={(p) => p.id}
        exportName="products"
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        defaultSort={{ id: "conversionsValue", dir: "desc" }}
        rowClassName={(p) => cn(p.status === "DISAPPROVED" && "bg-red-500/[0.03]")}
        bulkActions={(ids) => (
          <>
            <BulkButton onClick={() => fix(ids)}><Wand2 className="h-3 w-3" /> Fix from catalog</BulkButton>
            <BulkButton tone="danger" onClick={() => exclude(ids)}><PackageX className="h-3 w-3" /> Exclude from Shopping</BulkButton>
          </>
        )}
      />
    </div>
  );
}

// ─── Product groups (Shopping partition tree) ──────────────────────────────

const DIMENSIONS: { value: ListingDimension; label: string; of: (p: Product) => string | undefined }[] = [
  { value: "PRODUCT_TYPE", label: "Product type", of: (p) => p.productType.split(" > ")[0] },
  { value: "BRAND", label: "Brand", of: (p) => p.brand },
  { value: "CUSTOM_LABEL_0", label: "Custom label 0", of: (p) => p.customLabel0 },
  { value: "ITEM_ID", label: "Item ID", of: (p) => p.id },
];

function dimensionLabel(d: ListingDimension) {
  return d === "ALL" ? "All products" : d === "OTHERS" ? "Everything else" : DIMENSIONS.find((x) => x.value === d)?.label ?? d;
}

export function ProductGroupsView() {
  const { data, range, currency, campaign } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [subdividing, setSubdividing] = useState<string | null>(null);
  const metrics = useMemo(() => productMetrics(data, range), [data, range]);
  const nodes = data.listingGroups.filter((g) => g.campaignId === campaign?.id);
  const manual = campaign?.bidding.type === "MANUAL_CPC";

  if (!campaign || campaign.type !== "SHOPPING") {
    return (
      <div>
        <ViewHeader title="Product groups" />
        <EmptyState icon={Split} title="Open a Shopping campaign" body="Product groups split a Shopping campaign's products so each part can be bid on or excluded." />
      </div>
    );
  }

  const childrenOf = (id?: string) => nodes.filter((n) => n.parentId === id);
  const descendants = (id: string): string[] => childrenOf(id).flatMap((c) => [c.id, ...descendants(c.id)]);

  const subdivide = (node: ListingGroup, dimension: ListingDimension) => {
    const meta = DIMENSIONS.find((d) => d.value === dimension)!;
    const values = [...new Set(productsInGroup(data, node.id).map(meta.of).filter((v): v is string => !!v))].slice(0, 12);
    const items: ListingGroup[] = [
      ...values.map((v) => ({ id: gid("lg"), campaignId: campaign.id, parentId: node.id, dimension, value: v })),
      { id: gid("lg"), campaignId: campaign.id, parentId: node.id, dimension: "OTHERS" as const, value: `Everything else in ${node.value}` },
    ];
    applyDirect(`Subdivide "${node.value}" by ${meta.label.toLowerCase()}`, [{ kind: "collection.upsert", collection: "listingGroups", items }]);
    setSubdividing(null);
  };

  const rows: { node: ListingGroup; depth: number }[] = [];
  const walk = (id: string | undefined, depth: number) => {
    for (const n of childrenOf(id)) {
      rows.push({ node: n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(undefined, 0);

  const columns: GaColumn<{ node: ListingGroup; depth: number }>[] = [
    {
      id: "group",
      header: "Product group",
      render: ({ node, depth }) => {
        const count = productsInGroup(data, node.id).length;
        return (
          <span className="flex items-center gap-1.5" style={{ paddingLeft: depth * 20 }}>
            {childrenOf(node.id).length ? <ChevronRight className="h-3 w-3 rotate-90 text-muted-foreground" /> : <span className="w-3" />}
            <span className={cn("font-semibold", node.excluded && "text-muted-foreground line-through")}>{node.value}</span>
            <span className="text-[10px] text-muted-foreground">{dimensionLabel(node.dimension)} · {count} products</span>
          </span>
        );
      },
    },
    {
      id: "bid",
      header: "Max. CPC",
      align: "right",
      render: ({ node }) =>
        node.excluded ? <Pill tone="bad">Excluded</Pill> : childrenOf(node.id).length ? <span className="text-muted-foreground">—</span> : manual ? money(node.bid ?? 0.6, currency) : <span className="text-muted-foreground">Smart Bidding</span>,
    },
    ...metricColumns<{ node: ListingGroup; depth: number }>(({ node }) => (node.excluded ? groupMetrics(data, "__none__", metrics) : groupMetrics(data, node.id, metrics)), currency, { keys: ["impressions", "clicks", "cost", "conversions", "conversionsValue", "roas"] }),
    {
      id: "actions",
      header: "",
      align: "right",
      render: ({ node }) => (
        <span className="flex justify-end gap-1">
          {!childrenOf(node.id).length && !node.excluded && node.dimension !== "ITEM_ID" && (
            subdividing === node.id ? (
              <select autoFocus onChange={(e) => e.target.value && subdivide(node, e.target.value as ListingDimension)} onBlur={() => setSubdividing(null)} className="h-7 rounded border border-input bg-background px-1 text-[11px]" defaultValue="">
                <option value="">Subdivide by…</option>
                {DIMENSIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            ) : (
              <BulkButton onClick={() => setSubdividing(node.id)}><Split className="h-3 w-3" /> Subdivide</BulkButton>
            )
          )}
          {node.parentId && !childrenOf(node.id).length && (
            <BulkButton onClick={() => applyDirect(`${node.excluded ? "Include" : "Exclude"} "${node.value}"`, [{ kind: "collection.upsert", collection: "listingGroups", items: [{ ...node, excluded: !node.excluded }] }])}>
              {node.excluded ? "Include" : <><Ban className="h-3 w-3" /> Exclude</>}
            </BulkButton>
          )}
          {childrenOf(node.id).length > 0 && (
            <BulkButton tone="danger" onClick={() => applyDirect(`Remove subdivision of "${node.value}"`, [{ kind: "collection.remove", collection: "listingGroups", ids: descendants(node.id) } satisfies MutateOp])}>
              <Trash2 className="h-3 w-3" /> Remove subdivision
            </BulkButton>
          )}
        </span>
      ),
    },
  ];

  return (
    <div>
      <ViewHeader title="Product groups" subtitle="Split the campaign's products to bid differently or exclude some. Every level needs an 'Everything else' group so no product is left out." />
      <GaTable rows={rows} columns={columns} rowKey={(r) => r.node.id} exportName="product-groups" />
    </div>
  );
}
