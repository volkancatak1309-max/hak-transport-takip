import { cn } from "@/lib/utils";
import type { StatTone } from "@/components/ui-v2";

/**
 * ÖLÇÜM BANDI — Resend "Metrics" KPI ızgarasının tek-kart hâli (`ff328c72`).
 *
 * Referansta rakamlar ayrı ayrı kutucuklarda değil, tek bir yüzeyde yan yana
 * durur; ayırıcı kart boşluğu değil ince bir çizgidir. Kazanç görsel değil
 * anlamsal: bu 3–4 sayı AYNI aralığın parçalarıdır, ayrı kartlar onları
 * birbirinden bağımsız ölçümler gibi gösteriyordu.
 *
 * ÇİZGİ TEKNİĞİ: kenarlık değil `gap-px` + zemin. Kenarlıkla yapılırsa hangi
 * hücrenin sol, hangisinin üst çizgi alacağı kırılım başına indeks matematiği
 * ister ve 2/3/4 kolonda sessizce yanlış çizer. Boşluk-çizgisi her kolon
 * sayısında kendiliğinden doğru düşer.
 *
 * `scope` ZORUNLU kalır (StatCard kuralı): kapsamsız bir sayı hangi aralığa ait
 * olduğunu söylemez ve iki ekran sessizce çelişir.
 */
export type ReportStat = {
  label: string;
  value: React.ReactNode;
  scope: string;
  tone?: StatTone;
};

const VALUE_TONE: Record<StatTone, string> = {
  neutral: "text-foreground",
  critical: "text-status-critical-text",
  warning: "text-accent-gold-text",
  info: "text-accent-sky-text",
};

export function ReportStatBand({
  stats,
  className,
}: {
  stats: ReportStat[];
  className?: string;
}) {
  if (stats.length === 0) return null;
  return (
    <section className={cn("surface-card overflow-hidden rounded-[16px]", className)}>
      <div
        className={cn(
          "grid gap-px bg-border/60 sm:grid-cols-2",
          stats.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"
        )}
      >
        {stats.map((s) => (
          <div key={s.label} className="min-w-0 bg-card px-6 py-5">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {s.label}
            </span>
            {/* DEĞER = ÖLÇÜM → mono. Resend'de KPI rakamı sayfanın en büyük
                tipografisidir; burada 30px, sayfa başlığından da büyük.
                TRUNCATE YOK (ölçüldü): `truncate` bu hücrelerde hem "1194s 18dk"
                gibi uzun değerleri hem de leading-none yüzünden harf gövdesinin
                altını kırpıyordu. Ölçüm kırpılamaz — sığmayan değer satır atlar,
                üç noktaya dönüşmez. */}
            <div
              className={cn(
                "mt-2 break-words font-mono text-[30px] font-bold leading-[1.05] tracking-[-0.02em]",
                VALUE_TONE[s.tone ?? "neutral"]
              )}
            >
              {s.value}
            </div>
            <p className="mt-2 text-[12px] leading-snug text-muted-foreground">{s.scope}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
