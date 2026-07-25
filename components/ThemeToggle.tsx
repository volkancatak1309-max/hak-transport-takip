"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useTranslations("common");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";

  return (
    // Üst bardaki diğer ikon düğmeleriyle AYNI ölçü (icon-sm + 18px ikon);
    // Yardım/dil/çıkış ile yan yana duruyor, biri küçük kalırsa ritim bozulur.
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t("theme")}
      title={t("theme")}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </Button>
  );
}
