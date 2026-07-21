"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { SegmentedControl, useUrlFilters } from "@/components/ui-v2";
import { Input } from "@/components/ui/input";
import type { AnalyticsRangeKey } from "@/lib/analytics-shared";

/**
 * Rapor sayfalarının ORTAK dönem filtresi — Analiz sayfasındaki çubuğun
 * birebir aynısı (aynı anahtarlar: ?aralik / ?baslangic / ?bitis, aynı
 * SegmentedControl). Üç rapor kendi filtresini kurmasın diye tek bileşen:
 * yoksa "Analiz'de hafta, raporda son 7 gün" gibi sessiz uyuşmazlık doğar.
 *
 * Filtre URL'e yazar → sunucu bileşeni yeniden çalışır. Geçiş sırasında
 * `isPending` içeriği soluklaştırır, çubuk tıklanabilir kalır.
 */
export function ReportRangeFilter({
  rangeKey,
  customFrom,
  customTo,
  children,
}: {
  rangeKey: AnalyticsRangeKey;
  customFrom: string | null;
  customTo: string | null;
  children: React.ReactNode;
}) {
  const t = useTranslations("analiz");
  const { set } = useUrlFilters();
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<AnalyticsRangeKey>(rangeKey);
  const [from, setFrom] = useState(customFrom ?? "");
  const [to, setTo] = useState(customTo ?? "");

  const options = [
    { value: "gun", label: t("range_gun") },
    { value: "hafta", label: t("range_hafta") },
    { value: "ay", label: t("range_ay") },
    { value: "ozel", label: t("range_ozel") },
    { value: "tumzaman", label: t("range_tumzaman") },
  ];

  function onChange(v: string) {
    setOptimistic(v as AnalyticsRangeKey);
    startTransition(() =>
      set({
        aralik: v,
        baslangic: v === "ozel" ? from : null,
        bitis: v === "ozel" ? to : null,
      })
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-border/60 px-3 py-2.5">
        <SegmentedControl
          value={optimistic}
          onChange={onChange}
          options={options}
          ariaLabel={t("range_label")}
        />
        {optimistic === "ozel" && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                startTransition(() =>
                  set({ aralik: "ozel", baslangic: e.target.value, bitis: to })
                );
              }}
              className="h-8 w-[140px]"
              aria-label={t("range_ozel_from")}
            />
            <span className="text-xs text-muted-foreground">—</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                startTransition(() =>
                  set({ aralik: "ozel", baslangic: from, bitis: e.target.value })
                );
              }}
              className="h-8 w-[140px]"
              aria-label={t("range_ozel_to")}
            />
          </div>
        )}
      </div>
      <div className={isPending ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {children}
      </div>
    </>
  );
}
