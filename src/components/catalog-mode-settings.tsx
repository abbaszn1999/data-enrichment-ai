"use client";

import { useState } from "react";
import { Globe, PenLine, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MAX_DOMAIN_RULES, parseDomainList } from "@/lib/enrich/domains";

const MAX_INSTRUCTION_CHARS = 2000;

const SET_STYLE =
  "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50";
const EMPTY_STYLE =
  "border-dashed border-border bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-foreground";

const TEXTAREA_CLASS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50 resize-none";

function SettingButton(props: {
  isSet: boolean;
  disabled?: boolean;
  onClick: () => void;
  emptyIcon: typeof PenLine;
  emptyLabel: string;
  setLabel: string;
  summary?: string;
}) {
  const Icon = props.isSet ? Pin : props.emptyIcon;
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors disabled:pointer-events-none disabled:opacity-50 ${
        props.isSet ? SET_STYLE : EMPTY_STYLE
      }`}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {props.isSet ? props.setLabel : props.emptyLabel}
        {props.isSet && (
          <span className="ml-auto text-[10px] font-normal opacity-70">Edit</span>
        )}
      </span>
      {props.isSet && props.summary && (
        <span className="mt-1 block truncate text-[10px] opacity-80">{props.summary}</span>
      )}
    </button>
  );
}

export function CustomInstructionButton(props: {
  value: string | undefined;
  onSave: (value: string) => void;
  disabled?: boolean;
  placeholder: string;
  helpText: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const saved = props.value?.trim() ?? "";

  const openDialog = () => {
    setDraft(saved);
    setOpen(true);
  };
  const save = (value: string) => {
    props.onSave(value.trim());
    setOpen(false);
  };

  return (
    <>
      <SettingButton
        isSet={saved.length > 0}
        disabled={props.disabled}
        onClick={openDialog}
        emptyIcon={PenLine}
        emptyLabel="Set custom instruction"
        setLabel="Custom instruction set"
        summary={saved}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Custom instruction</DialogTitle>
            <DialogDescription>{props.helpText}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <textarea
              autoFocus
              rows={7}
              value={draft}
              maxLength={MAX_INSTRUCTION_CHARS}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  save(draft);
                }
              }}
              placeholder={props.placeholder}
              className={TEXTAREA_CLASS}
            />
            <p className="text-right text-[10px] text-muted-foreground">
              {draft.length} / {MAX_INSTRUCTION_CHARS}
            </p>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {saved ? (
              <Button type="button" variant="ghost" onClick={() => save("")}>
                Remove
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => save(draft)}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WebsiteRulesButton(props: {
  allowedDomains: string[] | undefined;
  blockedDomains: string[] | undefined;
  onSave: (rules: { allowedDomains: string[]; blockedDomains: string[] }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [allowedText, setAllowedText] = useState("");
  const [blockedText, setBlockedText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const allowed = props.allowedDomains ?? [];
  const blocked = props.blockedDomains ?? [];
  const isSet = allowed.length > 0 || blocked.length > 0;
  const summary = [
    allowed.length > 0 ? `${allowed.length} allowed` : "",
    blocked.length > 0 ? `${blocked.length} excluded` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const openDialog = () => {
    setAllowedText(allowed.join("\n"));
    setBlockedText(blocked.join("\n"));
    setError(null);
    setOpen(true);
  };

  const save = () => {
    const allowedParsed = parseDomainList(allowedText);
    const blockedParsed = parseDomainList(blockedText);
    const invalid = [...allowedParsed.invalid, ...blockedParsed.invalid];
    if (invalid.length > 0) {
      setError(`Not a valid website: ${invalid.slice(0, 5).join(", ")}`);
      return;
    }
    if (
      allowedParsed.domains.length > MAX_DOMAIN_RULES ||
      blockedParsed.domains.length > MAX_DOMAIN_RULES
    ) {
      setError(`Each list can hold up to ${MAX_DOMAIN_RULES} websites.`);
      return;
    }
    const blockedSet = new Set(blockedParsed.domains);
    const conflicts = allowedParsed.domains.filter((d) => blockedSet.has(d));
    if (conflicts.length > 0) {
      setError(`In both lists: ${conflicts.slice(0, 5).join(", ")}`);
      return;
    }
    props.onSave({
      allowedDomains: allowedParsed.domains,
      blockedDomains: blockedParsed.domains,
    });
    setOpen(false);
  };

  return (
    <>
      <SettingButton
        isSet={isSet}
        disabled={props.disabled}
        onClick={openDialog}
        emptyIcon={Globe}
        emptyLabel="Set website rules"
        setLabel="Website rules set"
        summary={summary}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Website rules</DialogTitle>
            <DialogDescription>
              Control which websites the image search may use. One website per
              line, without https://. Subdomains are included, and each list
              holds up to {MAX_DOMAIN_RULES} websites.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Only search these websites</label>
              <textarea
                rows={4}
                value={allowedText}
                onChange={(e) => {
                  setAllowedText(e.target.value);
                  setError(null);
                }}
                placeholder={"lego.com\nhasbro.com"}
                className={TEXTAREA_CLASS}
              />
              <p className="text-[10px] text-muted-foreground">
                Leave empty to allow every website. When set, images from any
                other website are rejected.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Never use these websites</label>
              <textarea
                rows={4}
                value={blockedText}
                onChange={(e) => {
                  setBlockedText(e.target.value);
                  setError(null);
                }}
                placeholder={"pinterest.com\naliexpress.com"}
                className={TEXTAREA_CLASS}
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {isSet ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  props.onSave({ allowedDomains: [], blockedDomains: [] });
                  setOpen(false);
                }}
              >
                Remove all
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={save}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
