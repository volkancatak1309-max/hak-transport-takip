"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  CalendarClock,
  ShieldAlert,
  PackageX,
  Receipt,
  CheckCircle2,
  IdCard,
  SatelliteDish,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpTip } from "@/components/help/HelpTip";
import { formatDate, formatDurationShort } from "@/lib/format";
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
      case "over9h":
        return {
          icon: AlertTriangle,
          text: t("dash.attn_over9h", { name: item.worker_name }),
          meta: formatDurationShort(item.ms, locale),
          overdue: true,
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
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-muted-foreground" />
            {t("dash.attn_title")}
            <HelpTip tkey="attention" />
          </span>
          {items.length > 0 && (
            <span className="nums rounded-full bg-accent-gold/15 px-2 py-0.5 text-[11px] font-semibold text-accent-gold">
              {items.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
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
              const tone = r.overdue ? "text-accent-claret-text" : "text-accent-gold";
              const bg = r.overdue ? "bg-accent-claret/12" : "bg-accent-gold/15";
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg px-1.5 py-2 transition-colors hover:bg-surface-2/60"
                >
                  <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${bg} ${tone}`}>
                    <Icon className="size-4" />
                  </span>
                  {/* Uyarı metni mobilde SARAR. Masaüstünde tek satırda kırpılır
                      ama burada `title` bile yoktu — dar ekranda kesilen kısım
                      hiçbir etkileşimle okunamıyordu (satır tıklanabilir değil,
                      çekmece yok). Panonun kritik uyarıları burada yaşıyor. */}
                  <span className="flex-1 text-sm sm:truncate">{r.text}</span>
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
      </CardContent>
    </Card>
  );
}
