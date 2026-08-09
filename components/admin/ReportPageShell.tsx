"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LoadingState, SegmentedControl, useUrlFilters } from "@/components/ui-v2";
import { HelpTip } from "@/components/help/HelpTip";
import { Input } from "@/components/ui/input";
import type { AnalyticsRangeKey } from "@/lib/analytics-shared";

/**
 * RAPOR SAYFASI KABUĞU — Resend "Metrics" ekranının iskeleti (`ff328c72`).
 *
 * Referansın taşıdığı tek fikir: **başlık solda, dönem SAĞ ÜSTTE, aynı satırda.**
 * Filtre içeriğin üstünde tam genişlik bir kutu değil; başlığın hizasında duran
 * bir hap. Böylece sayfanın ilk satırı "ne bakıyorum + hangi aralık" sorusunun
 * ikisini birden cevaplar, gövde doğrudan ölçümle başlar.
 *
 * Bu bileşen eski `ReportRangeFilter`'ın yerine geçti: o yalnız çubuktu, başlık
 * ve uyarı sayfalarda ayrı ayrı diziliyordu — dört rapor sayfası dört farklı
 * dikey ritim üretiyordu. Artık ritim tek yerde.
 *
 * URL sözleşmesi DEĞİŞMEDİ: ?aralik / ?baslangic / ?bitis — Analiz sayfasıyla
 * aynı anahtarlar, aynı ön-ayarlar. Geçişte `isPending` gövdeyi soluklaştırır,
 * çubuk tıklanabilir kalır.
 */
export function ReportPageShell({
  title,
  description,
  notice,
  rangeKey,
  customFrom,
  customTo,
  children,
}: {
  title: string;
  description?: string;
  /** Başlık ile gövde arasına giren uyarı (ör. EpochWarning). */
  notice?: React.ReactNode;
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
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {/* HAP FİLTRE — Resend'in sağ üst açılırları. Paylaşılan
            SegmentedControl'e dokunmadan (seferler/yakıt/masraf da kullanıyor)
            yalnız bu bağlamda yuvarlatılır. */}
        {/* Aralık seçicinin yanında (i): pencerenin KAYAN olduğunu (takvim
            haftası/ayı olmadığını) yalnız etiket anlatamıyor. */}
        <div className="flex items-center gap-1">
          <SegmentedControl
            value={optimistic}
            onChange={onChange}
            options={options}
            ariaLabel={t("range_label")}
            className="rounded-full p-1 [&>button]:rounded-full [&>button]:px-3 [&>button]:py-1.5"
          />
          <HelpTip tkey="range_window" />
        </div>
      </div>

      {optimistic === "ozel" && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              startTransition(() =>
                set({ aralik: "ozel", baslangic: e.target.value, bitis: to })
              );
            }}
            className="h-9 w-[150px] rounded-full"
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
            className="h-9 w-[150px] rounded-full"
            aria-label={t("range_ozel_to")}
          />
        </div>
      )}

      {notice}

      {/* SEKME DEĞİŞİMİNDE GÖSTERGE (09.08.2026, Volkan).
          loading.tsx yalnız İLK açılışta (route segmenti mount olurken) çıkar;
          tarih sekmesi tıklandığında sunucu yeniden hesaplarken hiçbir işaret
          yoktu — 30 günlük yakıt raporu 8 sn sürerken ekran sadece soluklaşıyor,
          kullanıcı donmuş sanıyordu. isPending zaten vardı, EKSİK OLAN görünür
          göstergeydi. Katman gövdenin ÜSTÜNDE yüzer: tablo yerinde kalır
          (yükseklik zıplamaz), üstü soluklaşır, halka ortada döner. */}
      <div className="relative">
        {isPending && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-6">
            <div className="glass-pop rounded-full px-4 py-1.5 shadow-sm">
              <LoadingState />
            </div>
          </div>
        )}
        <div
          aria-busy={isPending}
          className={
            isPending ? "opacity-40 transition-opacity" : "transition-opacity"
          }
        >
          {children}
        </div>
      </div>
    </>
  );
}
