"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EventDensityCell } from "@/lib/telemetry";

/**
 * GENEL BAKIŞ ŞERİDİ — Zendesk status sayfası klonu (`7957c520`).
 *
 * Araç başına son N günün alarm yoğunluğu, gün başına bir ince hücre.
 * Referansın asıl fikri: **sayı okumadan** hangi aracın sorunlu olduğunu
 * görmek. Zendesk'te bir servisin 90 günü tek bakışta okunur; bizde bir aracın.
 *
 * ÖNEMLİ SAPMA — "sorunsuz gün" YEŞİL DEĞİL, nötr gri. Kilitte yeşil yalnız
 * donanım kontak sinyaline ayrılmış (DESIGN.md §2.3); burada yeşil kullanmak
 * "araç çalışıyor" ile "alarm yok"u aynı renge bindirirdi. Yoğunluk skalası:
 * nötr → mercan-soft → mercan → kritik.
 *
 * ═══ 27.07.2026 — ŞERİT KOMPAKTLAŞTI (Volkan onayı) ═══
 *
 * Ölçüm: 28 araç satırı × 32 px + iç boşluk = **1.176 px**, yani 1440×900'de
 * görünümün %131'i, mobilde %139'u. Sayfanın %68'i şeritti; asıl içerik
 * (gruplu liste) ilk ekranda SIFIR piksel görünüyor, ona ulaşmak 1,58 ekran
 * kaydırma istiyordu. Zendesk deseni 5-10 servis için tasarlanmış; 28 araçta
 * ölçek değiştirmiş.
 *
 * Üç değişiklik:
 *  1. VARSAYILAN KATLI — tek özet satırı (en yoğun üç araç). Şerit artık
 *     sayfanın ALTINDA ve kapalı; isteyen açar.
 *  2. AÇILINCA İLK 10 — yoğunluk sırası zaten var, katlama eşiği "ilk 10".
 *     Gerisi "N aracın tümünü göster" ardında.
 *  3. SATIR YARIYA — hücre h-5(20px) → h-2.5(10px), py-1.5 → py-0.5;
 *     satır 32 px → ~16 px.
 *
 * "SORUNSUZ" KAVRAMI KALDIRILDI: 90 günde ≥1 olay (rölanti dahil) pratikte
 * her aracı "sorunlu" yapıyordu — 29 aracın 28'i. Ayrım bilgi taşımıyordu.
 * Artık tek liste, yoğunluğa göre sıralı; alarmı olmayan araç bir alarm
 * yoğunluk listesinde zaten yer almaz.
 *
 * MOBİLDE HÜCRE GRAFİĞİ YOK: 90 hücre 55 px'e sığınca hücre genişliği
 * **0,61 px** oluyordu — okunabilir bir yoğunluk grafiği değil, gri bir şerit.
 * `sm` altında grafik yerine plaka + sayı listesi gösterilir.
 */

type Props = {
  cells: EventDensityCell[];
  days: number;
  vehicles: { id: string; plate: string; fleet: string }[];
  /** Şeride tıklanınca o araç listede filtrelenir. */
  onPick: (plate: string) => void;
  activePlate: string;
};

/** Katlı görünümün özetinde adı geçen araç sayısı. */
const TOP_SUMMARY = 3;
/** Şerit açıldığında ilk anda gösterilen araç satırı sayısı. */
const TOP_ROWS = 10;

/** Gün anahtarı üretimi — Vienna gününü istemcide tekrar hesaplamadan,
 *  sunucunun ürettiği anahtar biçimiyle (YYYY-MM-DD) aynı sırayı kurar. */
function dayKeys(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`
    );
  }
  return out;
}

export function AlarmStrip({ cells, days, vehicles, onPick, activePlate }: Props) {
  const t = useTranslations("alarms");
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const keys = useMemo(() => dayKeys(days), [days]);

  /** araç → gün → hücre */
  const byVehicle = useMemo(() => {
    const m = new Map<string, Map<string, EventDensityCell>>();
    for (const c of cells) {
      let inner = m.get(c.vehicle_id);
      if (!inner) m.set(c.vehicle_id, (inner = new Map()));
      inner.set(c.day, c);
    }
    return m;
  }, [cells]);

  // Yalnız alarmı OLAN araçlar, yoğunluğa göre. "Sorunsuz" kovası yok.
  const rows = useMemo(() => {
    const arr = vehicles.map((v) => {
      const inner = byVehicle.get(v.id);
      let total = 0;
      let crit = 0;
      if (inner) {
        for (const c of inner.values()) {
          total += c.count;
          if (c.worst === "critical") crit += c.count;
        }
      }
      return { ...v, total, crit, inner };
    });
    return arr
      .filter((r) => r.total > 0)
      .sort((a, b) => b.crit - a.crit || b.total - a.total || a.plate.localeCompare(b.plate));
  }, [vehicles, byVehicle]);

  if (rows.length === 0) return null;

  const shown = showAll ? rows : rows.slice(0, TOP_ROWS);
  // Katlı özet: en yoğun üç araç "PLAKA sayı" biçiminde.
  const lead = rows
    .slice(0, TOP_SUMMARY)
    .map((r) => `${r.plate} ${r.total}`)
    .join(" · ");

  return (
    <section className="glass-panel rounded-[16px] px-4 py-3 sm:px-6">
      {/* KATLI ÖZET — sayfanın altında duran şeridin tek satırlık yüzü. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 rounded-[10px] px-1 py-1.5 text-left transition-colors hover:bg-surface-panel"
      >
        <ChevronRight
          className={cn(
            "mt-0.5 size-3.5 shrink-0 text-text-tertiary transition-transform",
            open && "rotate-90"
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[13px] font-medium">{t("strip_title", { days })}</span>
            <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
              {lead}
            </span>
          </span>
          <span className="mt-0.5 block text-[12px] leading-snug text-text-tertiary">
            {open ? t("strip_collapse") : t("strip_expand", { n: rows.length })}
          </span>
        </span>
      </button>

      {open && (
        <>
          <p className="mt-2 px-1 text-[12px] text-muted-foreground">{t("strip_legend")}</p>
          <ul className="mt-1.5 space-y-0.5">
            {shown.map((r) => {
              const on = activePlate === r.plate;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onPick(on ? "" : r.plate)}
                    aria-pressed={on}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[8px] px-2 py-0.5 text-left transition-colors",
                      on ? "bg-surface-hover" : "hover:bg-surface-panel"
                    )}
                  >
                    {/* MOBİLDE plaka satırı doldurur (hücre grafiği yok);
                        sm'den itibaren sabit sütuna döner. */}
                    <span className="min-w-0 flex-1 font-mono text-[11px] font-semibold uppercase tabular-nums sm:w-[92px] sm:flex-none sm:text-[12px]">
                      {r.plate}
                    </span>
                    {/* ŞERİT — gün başına 1 hücre. Renk tek taşıyıcı değil:
                        her hücrenin title'ında gün + sayı yazar. `sm` altında
                        gizli: 90 hücre 55 px'e sığınca hücre 0,61 px oluyor. */}
                    <span className="hidden min-w-0 flex-1 gap-[2px] sm:flex">
                      {keys.map((k) => {
                        const c = r.inner?.get(k);
                        const tone = !c
                          ? "bg-surface-panel"
                          : c.worst === "critical"
                            ? "bg-status-critical"
                            : c.count >= 3
                              ? "bg-accent-coral"
                              : "bg-accent-coral-soft";
                        return (
                          <span
                            key={k}
                            title={c ? `${k} · ${c.count}` : `${k} · 0`}
                            // min-w YOK: 90 hücre dar ekranda 1px altına inebilmeli, yoksa satır taşar
                            className={cn("h-2.5 min-w-0 flex-1 rounded-[2px]", tone)}
                          />
                        );
                      })}
                    </span>
                    <span className="w-[40px] shrink-0 text-right font-mono text-[12px] tabular-nums sm:w-[54px]">
                      {r.crit > 0 ? (
                        <span className="text-status-critical-text">{r.total}</span>
                      ) : (
                        <span className="text-muted-foreground">{r.total}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {rows.length > TOP_ROWS && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 px-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {showAll ? t("strip_show_top", { n: TOP_ROWS }) : t("strip_show_all", { n: rows.length })}
            </button>
          )}
        </>
      )}
    </section>
  );
}
