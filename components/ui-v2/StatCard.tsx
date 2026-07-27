"use client";

import Link from "next/link";
import { HelpTip } from "@/components/help/HelpTip";
import { cn } from "@/lib/utils";

/**
 * Tek KPI kartı kaynağı (DESIGN-SYSTEM §7) — 5 kopyanın (SummaryCard, 2×Kpi,
 * inline Card'lar, WorkerDetail) yerini alır; FAZ 4'te sayfalar buna taşınır.
 *
 * Kurallar: kapsam etiketi ZORUNLU ("Bugün" / "Bu Ay" — '9 Saati Aşan' ikiliği
 * bir daha yaşanmasın); tıklanabilirse filtrelenmiş listeye URL ile gider;
 * delta daima nötr renkte.
 *
 * ⚠️ "ⓘ ikonu YASAK" kuralı KALDIRILDI (27.07.2026, Volkan): kartın etiketi
 * neyin sayıldığını anlatmaya yetmiyordu ("Yüklenen" ile "Teslim" farkı, hangi
 * aralık, hangi kişi kümesi). Yasak, ekranı okunur yapmak yerine öğrenilmesi
 * imkânsız hâle getiriyordu. Artık `help` verilen kartta (i) çıkar.
 */
export type StatTone = "neutral" | "critical" | "warning" | "info";

const VALUE_TONE: Record<StatTone, string> = {
  neutral: "text-foreground",
  critical: "text-status-critical-text",
  warning: "text-accent-gold-text",
  info: "text-accent-sky-text",
};

export function StatCard({
  label,
  value,
  scope,
  tone = "neutral",
  delta,
  help,
  href,
  className,
}: {
  /** 11px uppercase mikro-etiket. */
  label: string;
  /** 28px .nums değer — string ("07:23", "46.019") veya sayı. */
  value: React.ReactNode;
  /** Zorunlu kapsam etiketi: "Bugün", "Bu Ay", "Seçili aralık"… */
  scope: string;
  /** Yalnız değeri >0 olan istisna metriği renk alır; nötr metrik renksiz. */
  tone?: StatTone;
  /** "▲ 4" / "▼ 12" — daima nötr renkte (trend rengi yanıltır). */
  delta?: string;
  /** "help" i18n uzayındaki anahtar; verilirse etiketin yanında (i) çıkar. */
  help?: string;
  /** Verilirse kart tıklanabilir → filtrelenmiş liste URL'i. */
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-0.5 text-[12px] sm:text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
          {label}
          {/* Tıklanabilir kartta gövde pointer-events-none; (i) geri açılır ki
              balon çalışsın ama karta tıklamak yine linke gitsin. */}
          {help && (
            <span className="pointer-events-auto">
              <HelpTip tkey={help} />
            </span>
          )}
        </span>
        {/* Kapsam etiketi tam opaklıkta (26.07.2026). /80 ile zaten soluk olan
            ikincil metin 11px'te AA sınırının altına düşüyordu — bu etiket
            "hangi aralık" sorusunun tek cevabı, okunmazsa sayı da anlamsız. */}
        <span className="text-[12px] sm:text-[11px] text-muted-foreground">{scope}</span>
      </div>
      {/* DEĞER = ÖLÇÜM → mono (DESIGN.md §3 "mono font ROLÜ"). Rakamlar kartlar
          arasında dikey hizalanır; 24–28px, 700 (Runey KPI ölçüsü). */}
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono tabular-nums text-[26px] font-bold leading-none tracking-[-0.01em]",
            VALUE_TONE[tone]
          )}
        >
          {value}
        </span>
        {delta && (
          <span className="font-mono tabular-nums text-xs text-muted-foreground">{delta}</span>
        )}
      </div>
    </>
  );

  const surface = cn(
    "surface-card card-kpi block rounded-[14px] p-5",
    href && "relative cursor-pointer",
    className
  );

  // TIKLANABİLİR KART + (i) BİRLİKTE (27.07.2026): eskiden kartın TAMAMI <Link>
  // idi; içine (i) butonu koymak geçersiz HTML (a içinde button) olurdu ve
  // balona dokunmak sayfayı değiştirirdi. Çözüm "gerilmiş bağlantı": link
  // mutlak konumla kartı kaplar, gövde pointer-events-none, yalnız (i) tıklama
  // alır. Kartın tıklanabilirliği ve odak halkası aynen korunur.
  if (href) {
    return (
      <div className={surface}>
        <Link
          href={href}
          aria-label={label}
          className="absolute inset-0 rounded-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="pointer-events-none relative">{body}</div>
      </div>
    );
  }
  return <div className={surface}>{body}</div>;
}
