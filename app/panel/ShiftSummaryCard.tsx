"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Package, Route, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmShiftSummaryAction } from "@/app/actions/driver-panel";
import { formatDate, formatDurationShort, kmDiff, workedMs } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

type Props = {
  entry: TimeEntry;
  week: { ms: number; km: number; shifts: number };
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
        <h1 className="text-2xl font-bold text-foreground">
          {t("v2SummaryTitle")}
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
        <SummaryStat
          icon={<Route className="size-7" aria-hidden />}
          value={km !== null ? `${km.toLocaleString(numLocale)} km` : "—"}
          label={t("totalKm")}
        />
        <SummaryStat
          icon={<Package className="size-7" aria-hidden />}
          value={String(packages)}
          label={t("v2TodayPackages")}
        />
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
        {week.km.toLocaleString(numLocale)} km · {week.shifts} {t("shiftCount")}
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
    <div className="glass flex items-center gap-4 rounded-2xl px-5 py-4">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-sky/12 text-accent-sky">
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
