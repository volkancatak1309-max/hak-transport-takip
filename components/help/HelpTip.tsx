"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHelp } from "./HelpProvider";

/**
 * Small (i) info button shown next to a section/card title.
 *
 * The hint bubble is ALWAYS rendered through a portal into <body> with
 * viewport-fixed coordinates computed from the (i) button's bounding rect. This
 * is deliberate: cards use `overflow-hidden` (see components/ui/card.tsx), so a
 * bubble positioned `absolute` inside the card gets clipped — it looked crammed
 * inside the card with the text cut in half. A body portal escapes every
 * ancestor's overflow/clip/stacking/transform context, so the bubble can never
 * be squeezed inside a card or hidden behind it.
 *
 * - Desktop (hover-capable pointer): the hint shows on hover/focus as a bubble
 *   anchored just below (or above) the (i); a click "pins" it open until you
 *   click elsewhere or press Escape.
 * - Touch (no hover): a tap opens the hint as a bubble pinned RIGHT NEXT to the
 *   tapped (i) — below it if there's room, otherwise above — clamped to the
 *   screen edges, with an X to close. Tap outside to close.
 *
 * Visibility is controlled globally by the Help toggle (HelpProvider): when help
 * is off, nothing renders. Pure presentation — no data is read or changed.
 */
type Coords = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
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
  const bubbleRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setCanHover(
      typeof window !== "undefined" &&
        window.matchMedia("(hover: hover) and (pointer: fine)").matches
    );
  }, []);

  const open = pinned || (canHover && hovering);

  // Position the bubble in viewport-fixed coords from the (i) button's rect, for
  // BOTH desktop and touch. Re-runs on scroll/resize so the bubble stays glued
  // to the (i); if the (i) scrolls out of view we just close (short-lived hint).
  useEffect(() => {
    // While closed we leave the last coords untouched (the bubble is gated on
    // `open`, so they're never shown); avoids a constant-value setState here.
    if (!open) return;
    const compute = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // (i) scrolled out of view → close instead of floating in a wrong place.
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
        setPinned(false);
        setHovering(false);
        return;
      }
      const MARGIN = 12;
      const GAP = 8;
      const width = Math.min(300, vw - MARGIN * 2);
      const centerX = r.left + r.width / 2;
      const left = Math.min(
        Math.max(centerX - width / 2, MARGIN),
        vw - width - MARGIN
      );
      const spaceBelow = vh - r.bottom;
      const spaceAbove = r.top;
      const place: "below" | "above" =
        spaceBelow >= 160 || spaceBelow >= spaceAbove ? "below" : "above";
      // Cap height to the room available in the chosen direction so a long hint
      // scrolls inside the bubble rather than spilling off-screen.
      const maxHeight =
        (place === "below" ? spaceBelow : spaceAbove) - GAP - MARGIN;
      const arrowLeft = Math.min(Math.max(centerX - left, 18), width - 18);
      setCoords({
        left,
        width,
        place,
        maxHeight: Math.max(80, maxHeight),
        top: place === "below" ? r.bottom + GAP : undefined,
        bottom: place === "above" ? vh - r.top + GAP : undefined,
        arrowLeft,
      });
    };
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [open]);

  // Close the pinned hint on outside click or Escape. The bubble is portaled
  // OUTSIDE this wrapper, so clicks inside the bubble must also count as "inside".
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      const inWrap = wrapRef.current?.contains(tgt);
      const inBubble = bubbleRef.current?.contains(tgt);
      if (!inWrap && !inBubble) setPinned(false);
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
  const surface = canHover ? "bg-popover" : "bg-card";

  const bubble =
    open && coords && typeof document !== "undefined"
      ? createPortal(
          <>
            {/* Touch only: transparent catcher to close on tap-outside (no dark
                dim). Desktop relies on hover-out / outside-mousedown instead. */}
            {!canHover && (
              <span
                className="fixed inset-0 z-[90]"
                onClick={() => setPinned(false)}
              />
            )}
            <span
              ref={bubbleRef}
              role={canHover ? "tooltip" : "dialog"}
              style={{
                position: "fixed",
                left: coords.left,
                width: coords.width,
                top: coords.top,
                bottom: coords.bottom,
                maxHeight: coords.maxHeight,
              }}
              className={cn(
                "z-[100] overflow-y-auto rounded-xl border border-border text-left shadow-xl elevate",
                surface,
                canHover ? "px-3 py-2" : "p-3 pr-9"
              )}
            >
              {/* caret pointing at the (i) */}
              <span
                aria-hidden
                style={{ left: coords.arrowLeft }}
                className={cn(
                  "absolute size-2.5 -translate-x-1/2 rotate-45",
                  surface,
                  coords.place === "below"
                    ? "-top-[5px] border-l border-t border-border"
                    : "-bottom-[5px] border-b border-r border-border"
                )}
              />
              {canHover ? (
                <span className="block text-xs font-normal normal-case leading-relaxed tracking-normal text-popover-foreground">
                  {text}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label="Kapat"
                    onClick={() => setPinned(false)}
                    className="absolute right-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                  <span className="flex items-start gap-2">
                    <Info className="mt-0.5 size-4 shrink-0 text-accent-claret-text" />
                    <span className="text-[13px] font-normal normal-case leading-relaxed tracking-normal text-foreground">
                      {text}
                    </span>
                  </span>
                </>
              )}
            </span>
          </>,
          document.body
        )
      : null;

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
          // WCAG 2.2 AA 2.5.8: dokunma hedefi en az 24x24 CSS px.
          // Önce ::before ile görünmez genişletme denendi ve tıklama testinde
          // ÇALIŞTI — ama axe/Lighthouse hedefi elemanın KUTUSUNDAN ölçüyor ve
          // 18x18 görüp haklı olarak uyarıyor. Denetim aracının göremediği
          // uyum, uyum sayılmaz: buton gerçekten 24x24 yapıldı. İkon 13px
          // kaldığı için görsel ağırlık aynı, yalnız hover dairesi büyüdü.
          "inline-flex size-6 items-center justify-center rounded-full",
          "text-muted-foreground/60 transition-colors",
          "hover:bg-surface-2 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky/40",
          open && "bg-surface-2 text-foreground"
        )}
      >
        <Info className="size-[13px]" strokeWidth={2.25} />
      </button>

      {bubble}
    </span>
  );
}
