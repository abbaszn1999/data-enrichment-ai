"use client";

import { useEffect, useId, useState } from "react";
import { useTheme } from "next-themes";

/**
 * A ```mermaid block the agent wrote (plans often have one), drawn as a diagram.
 * Mermaid is loaded only when a diagram is on screen. In strict mode it
 * sanitizes labels and allows no scripts or click handlers. If the diagram
 * does not parse, its source is shown instead.
 */
export function MermaidDiagram({ code }: { code: string }) {
  const { resolvedTheme } = useTheme();
  const id = `mmd-${useId().replace(/[^\w-]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: resolvedTheme === "dark" ? "dark" : "default",
          fontFamily: "inherit",
        });
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(svg);
          setFailed(false);
        }
      } catch {
        // A diagram mermaid cannot draw leaves an error element behind.
        document.getElementById(`d${id}`)?.remove();
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id, resolvedTheme]);

  if (failed) {
    return (
      <pre dir="ltr" className="not-prose my-2 overflow-x-auto rounded-lg bg-muted p-3 text-start text-[12px] text-foreground">
        <code>{code}</code>
      </pre>
    );
  }
  if (!svg) return <div className="not-prose my-3 h-24 animate-pulse rounded-lg border bg-muted/40" />;
  return (
    <div
      className="not-prose my-3 flex justify-center overflow-x-auto rounded-lg border bg-background p-3 [&_svg]:h-auto [&_svg]:max-w-full"
      // Mermaid output in strict mode: sanitized SVG.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
