"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setLocaleAction } from "@/app/actions/preferences";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";

const FLAG: Record<string, string> = { tr: "🇹🇷", de: "🇩🇪" };
const LABEL: Record<string, string> = { tr: "TR", de: "DE" };

export function LanguageToggle() {
  const locale = useLocale();
  const t = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function pick(l: "tr" | "de") {
    if (l === locale) return;
    startTransition(async () => {
      await setLocaleAction(l);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-label={t("language")}
            className="gap-1.5"
          />
        }
      >
        <Globe className="size-4" />
        <span className="nums text-xs font-semibold">{LABEL[locale] ?? "TR"}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        <DropdownMenuItem onClick={() => pick("tr")} className="gap-2">
          <span>{FLAG.tr}</span> Türkçe
          {locale === "tr" && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => pick("de")} className="gap-2">
          <span>{FLAG.de}</span> Deutsch
          {locale === "de" && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
