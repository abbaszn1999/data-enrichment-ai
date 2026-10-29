"use client";

import { useId } from "react";
import { MapPin } from "lucide-react";
import { MARKET_ANY, resolveSearchMarket, SEARCH_MARKETS } from "@/lib/enrich/source-urls/markets";

const FIELD_LABEL = "text-[10px] font-medium text-muted-foreground";
const FIELD_BASE =
  "w-full h-8 rounded-md border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50";

/**
 * The one setting that narrows a Source URLs search outside the instruction: the
 * market, i.e. the country the search runs from (a list). It is optional; with
 * "Any country" no location is sent. Websites are named in the custom
 * instruction, not here.
 */
export function SourceUrlsMarketSettings(props: {
  market: string | undefined;
  disabled?: boolean;
  onMarketChange: (market: string) => void;
}) {
  const marketId = useId();
  // Empty and the older "auto" setting both mean: no location.
  const resolved = resolveSearchMarket(props.market);
  const marketValue = resolved ? resolved.code : MARKET_ANY;

  const marketHint = resolved
    ? `The search runs as a shopper in ${resolved.name} would see it.`
    : "No location is sent. Google uses its default. Pick a country if the shops sell in one.";

  return (
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
          <option value={MARKET_ANY}>Any country (no location)</option>
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
  );
}
