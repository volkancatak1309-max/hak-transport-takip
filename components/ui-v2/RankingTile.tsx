import { cn } from "@/lib/utils";

/**
 * Reveal dashboard ranking-tile klonu (REVEAL-CLONE-SPEC B2). Yatay bar
 * leaderboard: her satır etiket + oransal bar + değer. Reveal'ın 6-tile
 * ızgarasının yapı taşı. Bar renkleri Reveal'ın yeşil/kırmızısı yerine bizim
 * palet (sky / iki-tonlu sky+gold / kritik).
 */
export type RankRow = {
  key: string;
  label: React.ReactNode;
  value: number;
  /** Gösterilecek biçimlenmiş değer (yoksa value). */
  display?: string;
  /** İkincil (aşan/kötü) kısım — iki-tonlu bar için, ör. 9h+ saat. */
  secondary?: number;
  color?: string;
  secondaryColor?: string;
};

export function RankingTile({
  title,
  icon,
  rows,
  scope,
  emptyLabel = "Veri yok",
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  rows: RankRow[];
  /** Alt scope etiketi (Reveal "Vehicles: Average per day..."). */
  scope?: string;
  emptyLabel?: string;
  className?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className={cn("glass flex h-[230px] flex-col rounded-[10px] p-3.5", className)}>
      {/* h2: tile ızgarası sayfanın ilk içerik bölümü — h1'den sonra gelir.
          h3 olduğunda başlık sırası h1'den h3'e atlıyordu (Lighthouse
          heading-order). Kardeş bölümler (OpsSummary, FleetDtcCard) da h2. */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold leading-none">{title}</h2>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto pr-1">
          {rows.map((r) => {
            const pct = Math.round((r.value / max) * 100);
            const secPct = r.secondary ? Math.round((r.secondary / max) * 100) : 0;
            const basePct = Math.max(0, pct - secPct);
            return (
              <li key={r.key} className="flex items-center gap-2 text-[12px] sm:text-[11px]">
                <span className="w-[78px] shrink-0 truncate text-right text-muted-foreground">
                  {r.label}
                </span>
                <span className="relative h-3.5 flex-1 overflow-hidden rounded-[2px] bg-surface-2">
                  <span
                    className="absolute inset-y-0 left-0 rounded-l-[2px]"
                    style={{ width: `${basePct}%`, background: r.color ?? "var(--accent-sky)" }}
                  />
                  {secPct > 0 && (
                    <span
                      className="absolute inset-y-0"
                      style={{
                        left: `${basePct}%`,
                        width: `${secPct}%`,
                        background: r.secondaryColor ?? "var(--accent-gold)",
                      }}
                    />
                  )}
                </span>
                <span className="nums w-[62px] shrink-0 text-right font-semibold tabular-nums">
                  {r.display ?? r.value.toLocaleString("tr-TR")}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {scope && (
        <div className="mt-2 border-t border-border/60 pt-1.5 text-[12px] sm:text-[11px] text-muted-foreground">
          {scope}
        </div>
      )}
    </div>
  );
}
