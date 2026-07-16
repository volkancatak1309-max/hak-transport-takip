"use client";

import { useEffect } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Sağdan açılan detay paneli (DESIGN-SYSTEM §7). Satır→detay için varsayılan;
 * kayıt detayı MODAL değil drawer (§12). Masaüstü 480px / mobil tam genişlik,
 * .glass-pop yüzey, Esc + overlay kapatır. Açıkken ↑/↓ komşu kayda geçer
 * (Linear peek). Sayfa ?panel=<id> ile URL'e yazarsa derin link olur.
 */
export function DetailDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  onPrev,
  onNext,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** ↑ / önceki kayıt. null = devre dışı. */
  onPrev?: (() => void) | null;
  /** ↓ / sonraki kayıt. null = devre dışı. */
  onNext?: (() => void) | null;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  // Klavye: açıkken ↑/↓ komşu kayda geçer. Form alanında değilken çalışır.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === "ArrowDown" && onNext) {
        e.preventDefault();
        onNext();
      } else if (e.key === "ArrowUp" && onPrev) {
        e.preventDefault();
        onPrev();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onPrev, onNext]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 z-50 bg-black/30 duration-200 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <DialogPrimitive.Popup
          className={cn(
            "glass-pop fixed inset-y-0 right-0 z-50 flex w-full flex-col outline-none sm:w-[480px]",
            "duration-200 data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right"
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="nums text-base font-semibold uppercase tracking-wide">
                {title}
              </DialogPrimitive.Title>
              {subtitle && (
                <DialogPrimitive.Description className="mt-0.5 text-sm text-muted-foreground">
                  {subtitle}
                </DialogPrimitive.Description>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {(onPrev || onNext) && (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Önceki kayıt"
                    disabled={!onPrev}
                    onClick={() => onPrev?.()}
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Sonraki kayıt"
                    disabled={!onNext}
                    onClick={() => onNext?.()}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                </>
              )}
              <DialogPrimitive.Close
                render={<Button variant="ghost" size="icon-sm" aria-label="Kapat" />}
              >
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer && (
            <div className="border-t border-border/60 px-5 py-3">{footer}</div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
