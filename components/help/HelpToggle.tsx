"use client";

import { useTranslations } from "next-intl";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHelp } from "./HelpProvider";

/**
 * Apple-style sliding switch in the topbar that shows/hides the whole help
 * layer. Label: "Yardım" / "Hilfe". The choice is persisted by HelpProvider.
 */
export function HelpToggle() {
  const t = useTranslations("help");
  const { enabled, toggle, ready } = useHelp();
  // Before the persisted value is read, show the default (ON) so the control
  // never flips visibly on load.
  const on = ready ? enabled : true;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={t("toggle")}
      onClick={toggle}
      className="group inline-flex items-center gap-2 rounded-full px-1.5 py-1 transition-colors hover:bg-surface-2"
    >
      <HelpCircle
        className={cn(
          "size-[18px] transition-colors",
          on ? "text-accent-claret-text" : "text-muted-foreground"
        )}
      />
      <span className="hidden text-sm font-medium text-muted-foreground sm:inline">
        {t("toggle")}
      </span>
      <span
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200",
          on ? "bg-accent-claret" : "bg-muted-foreground/35"
        )}
      >
        <span
          className={cn(
            "inline-block size-4 transform rounded-full bg-white shadow-sm transition-transform duration-200",
            on ? "translate-x-[18px]" : "translate-x-[2px]"
          )}
        />
      </span>
    </button>
  );
}
