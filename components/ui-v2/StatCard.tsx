import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Tek KPI kartı kaynağı (DESIGN-SYSTEM §7) — 5 kopyanın (SummaryCard, 2×Kpi,
 * inline Card'lar, WorkerDetail) yerini alır; FAZ 4'te sayfalar buna taşınır.
 *
 * Kurallar: kapsam etiketi ZORUNLU ("Bugün" / "Bu Ay" — '9 Saati Aşan' ikiliği
 * bir daha yaşanmasın); ⓘ ikonu yasak; tıklanabilirse filtrelenmiş listeye URL
 * ile gider; delta daima nötr renkte.
 */
export type StatTone = "neutral" | "critical" | "warning" | "info";

const VALUE_TONE: Record<StatTone, string> = {
  neutral: "text-foreground",
  critical: "text-status-critical",
  warning: "text-accent-gold",
  info: "text-accent-sky",
};

export function StatCard({
  label,
  value,
  scope,
  tone = "neutral",
  delta,
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
  /** Verilirse kart tıklanabilir → filtrelenmiş liste URL'i. */
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
          {label}
        </span>
        <span className="text-[11px] text-muted-foreground/80">{scope}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={cn("nums text-[28px] font-bold leading-none", VALUE_TONE[tone])}>
          {value}
        </span>
        {delta && (
          <span className="nums text-xs text-muted-foreground">{delta}</span>
        )}
      </div>
    </>
  );

  const surface = cn(
    "glass card-kpi block rounded-[16px] p-4",
    href && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className
  );

  if (href) {
    return (
      <Link href={href} className={surface}>
        {body}
      </Link>
    );
  }
  return <div className={surface}>{body}</div>;
}
