"use client";

import { useId, useState } from "react";
import { AlertCircle, Globe, MapPin, X } from "lucide-react";
import { SITE_MAX_DOMAINS, parseDomainList } from "@/lib/enrich/domains";
import {
  MARKET_ANY,
  MARKET_AUTO,
  resolveSearchMarket,
  SEARCH_MARKETS,
} from "@/lib/enrich/source-urls/markets";

const FIELD_LABEL = "text-[10px] font-medium text-muted-foreground";
const FIELD_BASE =
  "w-full h-8 rounded-md border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50";

/**
 * The two settings that narrow a Source URLs search: the one website to search
 * (a text field) and the market, i.e. the country the search runs from (a
 * list). Both are optional. With no website the search is the open one.
 */
export function SourceUrlsSiteSettings(props: {
  website: string | undefined;
  market: string | undefined;
  disabled?: boolean;
  onWebsiteChange: (website: string) => void;
  onMarketChange: (market: string) => void;
}) {
  const websiteId = useId();
  const marketId = useId();
  const saved = props.website ?? "";
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);

  // Follow the saved value when it changes from outside (another project, an undo, a preset).
  const [seenSaved, setSeenSaved] = useState(saved);
  if (saved !== seenSaved) {
    setSeenSaved(saved);
    setDraft(saved);
    setError(null);
  }

  const commit = () => {
    const text = draft.trim();
    if (!text) {
      setError(null);
      setDraft("");
      if (saved) props.onWebsiteChange("");
      return;
    }
    const { domains, invalid } = parseDomainList(text);
    if (domains.length === 0 || invalid.length > 0) {
      setError(
        invalid.length > 0 && domains.length > 0
          ? `"${invalid[0]}" is not a website. Use names such as mamasandpapas.com, separated by commas.`
          : "Enter a website such as mamasandpapas.com. Paste a page link and only the website is kept."
      );
      return;
    }
    if (domains.length > SITE_MAX_DOMAINS) {
      setError(`Add up to ${SITE_MAX_DOMAINS} websites. Remove ${domains.length - SITE_MAX_DOMAINS} to continue.`);
      return;
    }
    const value = domains.join(", ");
    setError(null);
    setDraft(value);
    if (value !== saved) props.onWebsiteChange(value);
  };

  const clear = () => {
    setDraft("");
    setError(null);
    if (saved) props.onWebsiteChange("");
  };

  const marketValue = props.market?.trim() ? props.market : MARKET_AUTO;
  const { market: resolved, auto } = resolveSearchMarket(props.market, saved || null);
  const savedDomains = parseDomainList(saved).domains;
  const several = savedDomains.length > 1;

  let marketHint: string;
  if (marketValue === MARKET_ANY) {
    marketHint = "No location is sent. Google uses its default.";
  } else if (!auto) {
    marketHint = resolved ? `The search runs as a shopper in ${resolved.name} would see it.` : "No location is sent.";
  } else if (resolved) {
    marketHint = `Auto chose ${resolved.name} from the website ending${several ? "s" : ""}. Pick another country to override it.`;
  } else if (several) {
    marketHint =
      "These websites do not all point to one country, so no location is sent. Pick a country if they sell in one.";
  } else if (saved) {
    marketHint = `This website's ending does not say which country it sells in, so no location is sent. Pick a country if the shop sells in one.`;
  } else {
    marketHint = "Auto sets a country from the website's ending (.co.uk, .de). Pick one to use it for every row.";
  }

  const saveHint = saved
    ? `Searches ${several ? "these websites" : saved} only, in one search, and returns the item's page. Never the home page.`
    : `Optional. Add up to ${SITE_MAX_DOMAINS} websites, separated by commas. Leave empty to search every website.`;

  return (
    <div className="space-y-2.5 rounded-md border border-border/60 bg-background/60 p-2.5">
      <div className="flex items-center gap-1.5">
        <Globe className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-semibold">Where to search</span>
      </div>

      <div className="space-y-1">
        <label htmlFor={websiteId} className={FIELD_LABEL}>
          Website{` (up to ${SITE_MAX_DOMAINS})`}
        </label>
        <div className="relative">
          <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            id={websiteId}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            disabled={props.disabled}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") {
                setDraft(saved);
                setError(null);
              }
            }}
            placeholder="e.g. mamasandpapas.com, mintvelvet.co.uk"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${websiteId}-hint`}
            className={`${FIELD_BASE} pl-8 pr-8 placeholder:text-muted-foreground/50 ${
              error ? "border-destructive/60 focus:ring-destructive/40" : ""
            }`}
          />
          {draft && !props.disabled && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clear}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Clear website"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {error ? (
          <p id={`${websiteId}-hint`} className="flex items-start gap-1 text-[10px] leading-relaxed text-destructive">
            <AlertCircle className="mt-px h-3 w-3 shrink-0" />
            {error}
          </p>
        ) : (
          <p id={`${websiteId}-hint`} className="text-[10px] leading-relaxed text-muted-foreground">
            {saveHint}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor={marketId} className={FIELD_LABEL}>
          Market / country
        </label>
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <select
            id={marketId}
            value={marketValue}
            disabled={props.disabled}
            onChange={(e) => props.onMarketChange(e.target.value)}
            aria-describedby={`${marketId}-hint`}
            className={`${FIELD_BASE} cursor-pointer pl-8 pr-2.5`}
          >
            <optgroup label="Automatic">
              <option value={MARKET_AUTO}>
                {resolved && auto ? `Auto: ${resolved.name}` : "Auto (from the website)"}
              </option>
              <option value={MARKET_ANY}>Any country (no location)</option>
            </optgroup>
            <optgroup label="Countries">
              {SEARCH_MARKETS.map((market) => (
                <option key={market.code} value={market.code}>
                  {market.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <p id={`${marketId}-hint`} className="text-[10px] leading-relaxed text-muted-foreground">
          {marketHint}
        </p>
      </div>
    </div>
  );
}
