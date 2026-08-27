"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Package, Route, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmShiftSummaryAction } from "@/app/actions/driver-panel";
import {
  formatDate,
  formatDurationShort,
  formatTime,
  kmDiff,
  workedMs,
} from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { HelpTip } from "@/components/help/HelpTip";
import { PACKAGES_ENABLED } from "@/lib/tenant";

type Props = {
  entry: TimeEntry;
  week: {
    ms: number;
    km: { km: number; olculen: number; sinyalsiz: number; acik: number };
    shifts: number;
  };
  onLater: () => void;
};

/**
 * İş 3 — Vardiya sonu tam ekran özeti: "Bugün: Xs Ydk · Z km · N paket".
 * Dev yeşil ONAYLA = şoförün günlük çalışma kaydına dijital imzası
 * (summary_confirmed_at + summary_confirmed_by). Onaylanmadan kapatılırsa
 * bir sonraki girişte tekrar çıkar (sunucu summary_confirmed_at null gördükçe).
 *
 * ONAYLA artık TEK KAYIT değil, şoförün 72 saatteki tüm imzasız vardiyalarını
 * imzalar (confirmShiftSummaryAction) — ekran tek dokunuşta kapanır. Katman
 * yalnız AÇIK VARDİYA YOKKEN gösterilir (app/panel/page.tsx), yani "Vardiyayı
 * Bitir" yolunu asla kapatmaz.
 */
export function ShiftSummaryCard({ entry, week, onLater }: Props) {
  const t = useTranslations("panel");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const worked = workedMs(entry);
  const km = kmDiff(entry);
  const packages = entry.cargo_count ?? 0;
  const numLocale = locale === "de" ? "de-AT" : "tr-TR";

  function confirm() {
    startTransition(async () => {
      // Ağ/sunucu hatası transition'dan kaçıp paneli hata ekranına düşürmesin;
      // şoför için sonuç aynı: "yazılamadı, tekrar dene".
      let r;
      try {
        r = await confirmShiftSummaryAction();
      } catch {
        toast.error(t("v2ConfirmErrRetry"));
        return;
      }
      if (r.ok) {
        toast.success(t("v2SummaryConfirmedToast"));
        router.refresh();
      } else {
        // Sunucu imzayı YAZAMADI. Sessiz "başarılı" yok (22.07.2026): şoför
        // hatayı görür, ekran açık kalır, tekrar deneyebilir.
        toast.error(t("v2ConfirmErrRetry"));
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 overflow-y-auto bg-[#0a0d16]/90 px-6 py-10 backdrop-blur-md page-enter">
      <div className="space-y-1 text-center">
        {/* Balon başlığın YANINDA: imza anı, şoförün "bunu neden imzalıyorum"
            diye durduğu tek yer. HelpTip portala çiziliyor (z-100) — bu tam
            ekran katmanın (z-50) altında kalmaz. */}
        <h1 className="flex items-center justify-center gap-1.5 text-2xl font-bold text-foreground">
          {t("v2SummaryTitle")}
          <HelpTip tkey="drv_summary" />
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("v2SummaryToday")} · {formatDate(entry.started_at, locale)}
        </p>
      </div>

      <div className="w-full max-w-md space-y-4">
        <SummaryStat
          icon={<Timer className="size-7" aria-hidden />}
          value={formatDurationShort(worked, locale)}
          label={t("workedHours")}
        />
        {/* HESAPLANAMAYAN METRİK GÖSTERİLMEZ (03.08.2026). Eskiden km yokken
            dev bir "—" basılıyordu: şoför bunu "0 km" ya da "ekran bozuk" diye
            okuyordu. Kilometre cihaz odometresinden/GPS'ten türetilir; aracın
            telemetrisi yoksa hesaplanamaz. O durumda kutu HİÇ çizilmez, yerine
            SEBEBİ yazılır. Uydurma sayı yazmayız. */}
        {km !== null ? (
          <SummaryStat
            icon={<Route className="size-7" aria-hidden />}
            value={`${km.toLocaleString(numLocale)} km`}
            label={t("totalKm")}
          />
        ) : (
          <p className="rounded-[14px] border border-dashed border-border/70 px-5 py-4 text-center text-sm text-muted-foreground">
            {t("v2SummaryKmUnavailable")}
          </p>
        )}
        {/* Sürüş bilgisi — başlangıç/bitiş saati ve varsa mola. Hepsi kayıtta
            duran gerçek değerler; türetme yok. */}
        <p className="text-center text-sm text-muted-foreground">
          {formatTime(entry.started_at, locale)}
          {entry.ended_at ? ` – ${formatTime(entry.ended_at, locale)}` : ""}
          {(entry.break_minutes ?? 0) > 0
            ? ` · ${t("v2BreakTotal", { min: entry.break_minutes ?? 0 })}`
            : ""}
        </p>
        {PACKAGES_ENABLED && (
          <SummaryStat
            icon={<Package className="size-7" aria-hidden />}
            value={String(packages)}
            label={t("v2TodayPackages")}
          />
        )}
      </div>

      <div className="w-full max-w-md space-y-4">
        <Button
          onClick={confirm}
          disabled={pending}
          className="h-24 w-full rounded-2xl bg-accent-green text-2xl font-bold tracking-wide text-white shadow-lg hover:bg-accent-green/90 active:scale-[0.98]"
        >
          {pending ? (
            <Loader2 className="size-8 animate-spin" aria-hidden />
          ) : (
            <CheckCircle2 className="size-8" aria-hidden />
          )}
          {t("v2SummaryConfirm")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {t("v2SummaryConfirmHint")}
        </p>
        <Button
          variant="ghost"
          onClick={onLater}
          disabled={pending}
          className="h-12 w-full text-base text-muted-foreground"
        >
          {t("v2SummaryLater")}
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        {t("thisWeek")}: {formatDurationShort(week.ms, locale)} ·{" "}
        {week.km.km.toLocaleString(numLocale)} km · {week.shifts} {t("shiftCount")}
        {week.km.sinyalsiz > 0 && (
          /* Eksik toplamı SESSİZCE göstermeyiz: cihazı sessiz vardiyalar
             toplama girmez ve kaç tanesi olduğu burada yazar. */
          <>
            {" · "}
            <span className="text-amber-800 dark:text-amber-200">
              {t("kmUnmeasuredShifts", { count: week.km.sinyalsiz })}
            </span>
          </>
        )}
      </p>
    </div>
  );
}

function SummaryStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="surface-card flex items-center gap-4 rounded-[14px] px-5 py-4">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-sky/12 text-accent-sky-text">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="nums text-4xl font-bold text-foreground">{value}</div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}
