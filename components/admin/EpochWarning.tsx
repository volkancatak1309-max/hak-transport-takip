"use client";

import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";

/**
 * EŞİK SINIRI UYARISI — `vehicle_events`'ten beslenen HER ekranda aynı cümle.
 *
 * Alarm eşikleri filoya toplu değiştiğinde (device_config_epochs) sınırdan
 * önceki ve sonraki olaylar farklı bir cetvelle ölçülmüş olur. Sayıları yan
 * yana koymak "şoförler düzeldi" yanılgısı üretir — oysa yalnız cetvel
 * değişmiştir.
 *
 * Tek bileşen, üç ekran (Alarmlar, Analiz olay tabloları, Hız raporu): cümle
 * ve görünüm üç yerde de aynı kalsın diye. Metin `common.epoch_warning`'de tek
 * kaynakta; tarih VERİDEN gelir (`epochISO`), hiçbir yere sabit tarih yazılmaz.
 *
 * Renk: mevcut `accent-gold` uyarı tonu — Analiz'deki eşik notu zaten bunu
 * kullanıyordu, yeni renk katılmadı.
 */
export function EpochWarning({
  epochISO,
  show,
  className = "",
}: {
  /** Eşiklerin değiştiği an (ISO). Kayıt/tablo yoksa null → hiç render edilmez. */
  epochISO: string | null;
  /** Görüntülenen aralık sınırdan ÖNCE başlıyor mu? */
  show: boolean;
  className?: string;
}) {
  const t = useTranslations("common");
  const locale = useLocale();

  if (!epochISO || !show) return null;

  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-xl bg-accent-gold/12 px-4 py-3 text-xs text-accent-gold ${className}`}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p>{t("epoch_warning", { date: formatDate(epochISO, locale) })}</p>
    </div>
  );
}
