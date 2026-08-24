"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  CalendarClock,
  Coffee,
  ShieldAlert,
  PackageX,
  Receipt,
  CheckCircle2,
  IdCard,
  FileBadge,
  SatelliteDish,
  Navigation,
  UserX,
  MapPinOff,
  ClockAlert,
  Link2Off,
  CircleParking,
  Pencil,
  PlayCircle,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { OpsGroup } from "@/components/ui-v2";
import { HelpTip } from "@/components/help/HelpTip";
import { formatDate, formatTime, formatDurationShort } from "@/lib/format";
import type { AttentionItem } from "@/lib/admin-dashboard";

export function AttentionList({
  items,
  onEditEntry,
}: {
  items: AttentionItem[];
  /** Verilirse hatalı paket uyarısında "Düzelt" kısayolu çıkar. */
  onEditEntry?: (entryId: string) => void;
}) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const nf = locale === "de" ? "de-AT" : "tr-TR";

  function render(item: AttentionItem): {
    icon: LucideIcon;
    text: string;
    meta: string;
    overdue: boolean;
  } {
    switch (item.kind) {
      // § 9 Abs. 1 / § 14 Abs. 2 — yasal tavan aşıldı. Gerçek ihlal (bordo).
      case "overLimit":
        return {
          icon: AlertTriangle,
          text: t(
            item.night ? "dash.attn_over_limit_night" : "dash.attn_over_limit",
            { name: item.worker_name, cap: Math.round(item.capMs / 3_600_000) }
          ),
          meta: formatDurationShort(item.ms, locale),
          overdue: true,
        };
      // § 13c Abs. 1 — 9 saati aştı, molası eksik. Uyarı (gold), ihlal DEĞİL.
      case "break45":
        return {
          icon: Coffee,
          text: t("dash.attn_break45", {
            name: item.worker_name,
            required: item.requiredMin,
          }),
          meta: t("dash.attn_break45_meta", {
            worked: formatDurationShort(item.ms, locale),
            min: item.breakMin,
          }),
          overdue: false,
        };
      case "license": {
        const expired = item.days < 0;
        return {
          icon: IdCard,
          text: t(expired ? "dash.attn_license_expired" : "dash.attn_license", {
            name: item.worker_name,
            date: formatDate(item.due, locale),
          }),
          meta: expired
            ? t("dash.attn_overdue_days", { days: Math.abs(item.days) })
            : t("dash.attn_in_days", { days: item.days }),
          overdue: expired,
        };
      }
      // ŞOFÖR BELGESİ (078). Ehliyet kaleminin ikizi ama TÜR ADI taşıyor ve o
      // ad kiracının verisi — `t()` içinden GEÇMEZ, doğrudan basılır.
      case "document": {
        const expired = item.days < 0;
        return {
          icon: FileBadge,
          text: t(expired ? "dash.attn_doc_expired" : "dash.attn_doc", {
            name: item.worker_name,
            doc: item.type_label,
            date: formatDate(item.due, locale),
          }),
          meta: expired
            ? t("dash.attn_overdue_days", { days: Math.abs(item.days) })
            : t("dash.attn_in_days", { days: item.days }),
          overdue: expired,
        };
      }
      case "silent": {
        // 48 saati aşan sessizlik saat cinsinden okunaksız ("116 saattir") →
        // gün. Eşiğin (24s) hemen üstünde ise saat daha bilgilendirici.
        const days = Math.floor(item.hours / 24);
        return {
          icon: SatelliteDish,
          text: t("dash.attn_silent", { plate: item.plate }),
          meta:
            item.hours >= 48
              ? t("dash.attn_silent_days", { days })
              : t("dash.attn_silent_hours", { hours: item.hours }),
          overdue: item.hours >= 48,
        };
      }
      // KM ÖLÇÜLEMEDİ — vardiya boyunca araçtan hiç telemetri gelmemiş.
      // İhlal DEĞİL, veri boşluğu: "0 km" yazmak yerine yöneticiye km'nin
      // ölçülemediğini söyler ki elle düzeltebilsin.
      case "kmUnmeasured":
        return {
          icon: SatelliteDish,
          text: t("dash.attn_km_unmeasured", {
            name: item.worker_name,
            plate: item.plate,
          }),
          meta:
            item.hours === null
              ? t("dash.attn_km_unmeasured_never")
              : item.hours >= 48
                ? t("dash.attn_silent_days", { days: Math.floor(item.hours / 24) })
                : t("dash.attn_silent_hours", { hours: item.hours }),
          overdue: false,
        };
      case "movingNoShift":
        return {
          icon: Navigation,
          text: t("dash.attn_moving_no_shift", { plate: item.plate }),
          meta: t("dash.attn_moving_no_shift_meta"),
          overdue: false,
        };
      case "driverless":
        return {
          icon: UserX,
          text: t("dash.attn_driverless", { plate: item.plate }),
          meta: t("dash.attn_driverless_meta"),
          overdue: false,
        };
      // Atamasız araç sahada — eylem "şoför ata", movingNoShift'ten farklı.
      case "unassignedMoving":
        return {
          icon: Link2Off,
          text: t("dash.attn_unassigned_moving", { plate: item.plate }),
          meta: t("dash.attn_unassigned_moving_meta"),
          overdue: false,
        };
      // Araçtan sinyal yok — konum GERÇEKTEN doğrulanamadı (cihaz sessiz/ölü).
      case "locationUnverified":
        return {
          icon: MapPinOff,
          text: t("dash.attn_no_signal", { name: item.worker_name }),
          meta: t("dash.attn_no_signal_meta"),
          overdue: false,
        };
      // Saat tahmini — araç depodaydı, yalnız başlangıç anı kestirim (038).
      case "startEstimated":
        return {
          icon: ClockAlert,
          text: t("dash.attn_start_estimated", { name: item.worker_name }),
          meta: t("dash.attn_start_estimated_meta"),
          overdue: false,
        };
      case "vehicleIdle":
        return {
          icon: CircleParking,
          text: t("dash.attn_vehicle_idle", { name: item.worker_name }),
          meta: t("dash.attn_vehicle_idle_meta"),
          overdue: false,
        };
      case "manualStart":
        return {
          icon: PlayCircle,
          text: t("dash.attn_manual_start", {
            by: item.by_name,
            name: item.worker_name,
          }),
          meta: formatTime(item.started_at, locale),
          overdue: false,
        };
      case "secondShift":
        // İHLAL DEĞİL → overdue:false, bordo yok. Meta gün TOPLAMINI taşır:
        // yöneticinin ilk sorusu "kaç saat oldu", "saat kaçta başladı" değil.
        return {
          icon: PlayCircle,
          text: t("dash.attn_second_shift", {
            name: item.worker_name,
            count: item.count,
          }),
          meta: t("dash.attn_second_shift_meta", {
            total: formatDurationShort(item.totalMs, locale),
          }),
          overdue: false,
        };
      case "inspection":
      case "insurance": {
        const overdue = item.days < 0;
        const labelKey =
          item.kind === "inspection" ? "dash.attn_inspection" : "dash.attn_insurance";
        return {
          icon: item.kind === "inspection" ? CalendarClock : ShieldAlert,
          text: t(labelKey, { plate: item.plate }),
          meta: overdue
            ? t("dash.attn_overdue_days", { days: Math.abs(item.days) })
            : t("dash.attn_in_days", { days: item.days }),
          overdue,
        };
      }
      case "undelivered":
        return {
          icon: PackageX,
          text: t("dash.attn_undelivered", {
            name: item.worker_name,
            count: item.count,
          }),
          meta: formatDate(item.date, locale),
          overdue: false,
        };
      // AÇIK İŞ EMRİ (081) — yalnız yüksek/kritik buraya düşer.
      // `aciklama` kiracının/şoförün kendi metni: `t()` içinden GEÇMEZ.
      case "workOrder":
        return {
          icon: Wrench,
          text: t(
            item.oncelik === "kritik" ? "dash.attn_wo_critical" : "dash.attn_wo",
            { plate: item.plate, what: item.aciklama }
          ),
          meta:
            item.days === 0
              ? t("dash.attn_wo_today")
              : t("dash.attn_wo_days", { days: item.days }),
          // Kritik emir her zaman sert; yüksek öncelikli emir bir günden
          // uzun süredir açıksa sertleşir — "bugün açıldı" henüz gecikme değil.
          overdue: item.oncelik === "kritik" || item.days >= 1,
        };
      // PERİYODİK BAKIM (081). Tetikleyen eksen hangisiyse o basılır;
      // `tip` kiracının verisi, çevrilmez.
      case "maintenanceDue": {
        const kalan =
          item.eksen === "km" && item.kalanKm !== null
            ? t("dash.attn_maint_km", { km: Math.abs(item.kalanKm) })
            : item.kalanGun !== null
              ? t("dash.attn_maint_days", { days: Math.abs(item.kalanGun) })
              : "";
        return {
          icon: CalendarClock,
          text: t(item.gecti ? "dash.attn_maint_over" : "dash.attn_maint", {
            plate: item.plate,
            type: item.tip,
          }),
          meta: item.gecti ? t("dash.attn_maint_late", { kalan }) : kalan,
          overdue: item.gecti,
        };
      }
      case "penalty":
        return {
          icon: Receipt,
          text: t("dash.attn_penalty", { plate: item.plate, count: item.count }),
          meta:
            item.amount !== null
              ? `${item.amount.toLocaleString(nf, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} €`
              : "",
          overdue: true,
        };
    }
  }

  return (
    // Stellate gruplu blok gövdesi (OpsGroup): başlık + sayaç rozeti + satırlar.
    // Kart kabuğu (CardHeader/CardTitle) kaldırıldı — üç blok da aynı iskeleti
    // paylaşsın diye tek gövde var.
    <OpsGroup
      title={t("dash.attn_title")}
      count={items.length}
      icon={<AlertTriangle className="size-4 text-accent-coral" />}
      action={<HelpTip tkey="attention" />}
    >
      <div className="flex flex-1 flex-col">
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
            <CheckCircle2 className="size-7 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("dash.attn_empty")}</p>
          </div>
        ) : (
          <ul className="-mx-1 max-h-[320px] space-y-1 overflow-y-auto">
            {items.map((item) => {
              const r = render(item);
              const Icon = r.icon;
              // ŞİDDET RENGİ (26.07.2026): gecikmiş kalem bordoydu; bordo artık FİLO
              // rengi (DESIGN.md §2.3). Şiddet için kritik token'ı — bordo/mavi
              // yalnız filo ayrımında anlam taşır.
              const tone = r.overdue ? "text-status-critical-text" : "text-accent-gold-text";
              const bg = r.overdue ? "bg-status-critical-soft" : "bg-accent-gold/15";
              return (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-lg px-1.5 py-2 transition-colors hover:bg-surface-2/60"
                >
                  <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${bg} ${tone}`}>
                    <Icon className="size-4" />
                  </span>
                  {/* Uyarı metni HER ZAMAN sarar (24.07.2026). Eskiden masaüstünde
                      `sm:truncate` ile tek satıra kırpılıyordu ve kesilen kısım
                      hiçbir etkileşimle okunamıyordu (satır tıklanabilir değil,
                      çekmece yok, title yok). Panonun kritik uyarıları burada
                      yaşıyor — kırpmak yerine satır kaydır. `break-words` uzun
                      kelimeleri (plaka/isim) de sardırır. */}
                  <span className="flex-1 text-sm break-words">{r.text}</span>
                  {/* DÜZELTME KISAYOLU (22.07.2026) — yanlış paket sayısı
                      uyarısından doğrudan düzenleme dialoguna. Yönetici uyarıyı
                      görüp kaydı arşivde aramak zorunda kalmasın. */}
                  {item.kind === "undelivered" && onEditEntry && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={() => onEditEntry(item.entry_id)}
                    >
                      <Pencil className="size-3.5" />
                      <span className="hidden sm:inline">{t("attnFix")}</span>
                    </Button>
                  )}
                  <span className={`nums shrink-0 text-xs font-medium ${r.overdue ? tone : "text-muted-foreground"}`}>
                    {r.meta}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </OpsGroup>
  );
}
