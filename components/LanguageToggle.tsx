"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setLocaleAction } from "@/app/actions/preferences";
import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";

export function LanguageToggle() {
  const locale = useLocale();
  const t = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = locale === "tr" ? "de" : "tr";
    startTransition(async () => {
      await setLocaleAction(next);
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={t("language")}
      onClick={toggle}
      className="gap-1.5"
    >
      <Globe className="size-4" />
      <span className="nums text-xs font-semibold">{locale.toUpperCase()}</span>
    </Button>
  );
}
