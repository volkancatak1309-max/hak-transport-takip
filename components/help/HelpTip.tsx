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
 * - Touch (no hover): a tap opens the hint as a small bubble pinned RIGHT NEXT
 *   to the tapped (i) — below it if there's room, otherwise above — clamped to
 *   the screen edges. Tap the X or outside to close.
 *
 * Visibility is controlled globally by the Help toggle (HelpProvider): when help
 * is off, nothing renders. Pure presentation — no data is read or changed.
 */
type Coords = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  place: "below" | "above";
  arrowLeft: number;
};

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
  const [coords, setCoords] = useState<Coords | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setCanHover(
      typeof window !== "undefined" &&
        window.matchMedia("(hover: hover) and (pointer: fine)").matches
    );
  }, []);

  const open = pinned || (canHover && hovering);

  // Touch popup: position the bubble next to the tapped (i). Uses viewport-fixed
  // coords so it never lands at the bottom of the screen. Anchors with `top`
  // (below) or `bottom` (above) so we don't need to know the bubble's height.
  useEffect(() => {
    if (!pinned || canHover) {
      setCoords(null);
      return;
    }
    const compute = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const MARGIN = 12;
      const GAP = 10;
      const width = Math.min(280, vw - MARGIN * 2);
      const centerX = r.left + r.width / 2;
      const left = Math.min(Math.max(centerX - width / 2, MARGIN), vw - width - MARGIN);
      const spaceBelow = vh - r.bottom;
      const place: "below" | "above" =
        spaceBelow >= 180 || spaceBelow >= r.top ? "below" : "above";
      const arrowLeft = Math.min(Math.max(centerX - left, 18), width - 18);
      setCoords({
        left,
        width,
        place,
        top: place === "below" ? r.bottom + GAP : undefined,
        bottom: place === "above" ? vh - r.top + GAP : undefined,
        arrowLeft,
      });
    };
    compute();
    // Stale fixed coords on scroll/resize → just close (short-lived hint).
    const close = () => setPinned(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pinned, canHover]);

  // Close the pinned hint on outside click or Escape.
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
        ref={btnRef}
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

      {/* Desktop: anchored hint bubble on hover (unchanged). */}
      {open && canHover && (
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
      )}

      {/* Touch: small bubble pinned next to the tapped (i). */}
      {open && !canHover && coords && (
        <>
          {/* Transparent catcher: tap outside to close (no dark dim). */}
          <span
            className="fixed inset-0 z-[90]"
            onClick={() => setPinned(false)}
          />
          <span
            role="dialog"
            style={{
              position: "fixed",
              left: coords.left,
              width: coords.width,
              top: coords.top,
              bottom: coords.bottom,
            }}
            className="z-[100] rounded-xl border border-border bg-card p-3 pr-9 text-left shadow-xl"
          >
            {/* caret pointing at the (i) */}
            <span
              aria-hidden
              style={{ left: coords.arrowLeft }}
              className={cn(
                "absolute size-2.5 -translate-x-1/2 rotate-45 bg-card",
                coords.place === "below"
                  ? "-top-[5px] border-l border-t border-border"
                  : "-bottom-[5px] border-b border-r border-border"
              )}
            />
            <button
              type="button"
              aria-label="Kapat"
              onClick={() => setPinned(false)}
              className="absolute right-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="size-4" />
            </button>
            <span className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0 text-accent-claret" />
              <span className="text-[13px] font-normal normal-case leading-relaxed tracking-normal text-foreground">
                {text}
              </span>
            </span>
          </span>
        </>
      )}
    </span>
  );
}
