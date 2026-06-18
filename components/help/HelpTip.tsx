"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHelp } from "./HelpProvider";

/**
 * Small (i) info button shown next to a section/card title.
 *
 * - Desktop (hover-capable pointer): the hint shows on hover/focus as an
 *   anchored bubble; a click "pins" it open until you click elsewhere.
 * - Touch (no hover): a tap opens the hint as a centered pop-up with a large X;
 *   tapping the backdrop or X closes it.
 *
 * Visibility is controlled globally by the Help toggle (HelpProvider): when help
 * is off, nothing renders. Pure presentation — no data is read or changed.
 */
export function HelpTip({
  tkey,
  className,
}: {
  /** Key under the "help" i18n namespace. */
  tkey: string;
  className?: string;
}) {
  const t = useTranslations("help");
  const { enabled, ready } = useHelp();

  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [canHover, setCanHover] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setCanHover(
      typeof window !== "undefined" &&
        window.matchMedia("(hover: hover) and (pointer: fine)").matches
    );
  }, []);

  const open = pinned || (canHover && hovering);

  // Close the pinned/mobile hint on outside click or Escape.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPinned(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  // Render nothing until we know the persisted choice, and nothing when off.
  if (!ready || !enabled) return null;

  const text = t(tkey);

  return (
    <span
      ref={wrapRef}
      className={cn("relative inline-flex align-middle", className)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <button
        type="button"
        aria-label={text}
        aria-expanded={open}
        onClick={() => setPinned((p) => !p)}
        onFocus={() => canHover && setHovering(true)}
        onBlur={() => canHover && setHovering(false)}
        className={cn(
          "inline-flex size-[18px] items-center justify-center rounded-full",
          "text-muted-foreground/60 transition-colors",
          "hover:bg-surface-2 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky/40",
          open && "bg-surface-2 text-foreground"
        )}
      >
        <Info className="size-[13px]" strokeWidth={2.25} />
      </button>

      {open &&
        (canHover ? (
          /* Desktop: anchored hint bubble */
          <span
            role="tooltip"
            className={cn(
              "absolute left-1/2 top-[calc(100%+6px)] z-50 w-max max-w-[260px] -translate-x-1/2",
              "rounded-xl border border-border bg-popover px-3 py-2",
              "text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-popover-foreground",
              "shadow-lg elevate"
            )}
          >
            {text}
          </span>
        ) : (
          /* Touch: centered pop-up with a large close button */
          <span
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
            onClick={() => setPinned(false)}
          >
            <span
              className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-5 pr-12 text-left shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Kapat"
                onClick={() => setPinned(false)}
                className="absolute right-3 top-3 inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <X className="size-5" />
              </button>
              <span className="flex items-start gap-2.5">
                <Info className="mt-0.5 size-[18px] shrink-0 text-accent-claret" />
                <span className="text-sm font-normal normal-case leading-relaxed tracking-normal text-foreground">
                  {text}
                </span>
              </span>
            </span>
          </span>
        ))}
    </span>
  );
}
