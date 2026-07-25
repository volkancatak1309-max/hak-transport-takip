import { cn } from "@/lib/utils";

/**
 * Sıralama kartı — STRIPE HÜCRE-İÇİ BAR dili (DESIGN.md §0/§5, destek referans
 * Stripe "Revenue recognition": sayısal satırda barın METNİN ARKASINDA olması).
 *
 * 26.07.2026'da yeniden örüldü. Eski desen etiketi 78px'lik sabit bir sütuna
 * sıkıştırıp `truncate` ile kesiyordu — "Mohamed İbr…" gibi okunamayan isimler
 * çıkıyordu ve sıralama kartının tek işi zaten İSİM göstermek. Yeni desende bar
 * satırın tamamını kaplayan zemindir; isim onun üstünde, KIRPILMADAN, gerekirse
 * iki satıra sararak durur. Değer sağda mono ile hizalı.
 *
 * Renk: tek aksan mercan (DESIGN.md §2.2). İki-tonlu satırda ikincil (aşan)
 * kısım nötr gri kalır — iki güçlü renk yan yana gelmez.
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
    // YÜKSEKLİK İÇERİKTEN (26.07.2026). Eskiden h-[230px] sabitti: 10 satırlık
    // bir kartta son satır yarım kalıyor ve iç kaydırma çubuğu çıkıyordu —
    // "Top-10" diyen bir kartta 10'uncuyu görmek için kaydırmak tasarım hatası.
    // Kartlar ızgarada zaten birbirine hizalanıyor (grid stretch).
    <div className={cn("surface-card flex flex-col rounded-[16px] p-5", className)}>
      {/* h2: tile ızgarası sayfanın ilk içerik bölümü — h1'den sonra gelir.
          h3 olduğunda başlık sırası h1'den h3'e atlıyordu (Lighthouse
          heading-order). Kardeş bölümler (OpsSummary, FleetDtcCard) da h2. */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold leading-none">{title}</h2>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <ul className="-mx-1 flex-1 space-y-0.5 px-1">
          {rows.map((r) => {
            const pct = Math.round((r.value / max) * 100);
            const secPct = r.secondary ? Math.round((r.secondary / max) * 100) : 0;
            const basePct = Math.max(0, pct - secPct);
            return (
              <li
                key={r.key}
                className="relative overflow-hidden rounded-[8px]"
              >
                {/* HÜCRE-İÇİ BAR: satırın arkasında, metni okunur bırakacak
                    düşük yoğunlukta. Sıralamayı gözle görünür kılar ama sayının
                    kendisiyle yarışmaz (Stripe deseni). */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 rounded-[8px]"
                  style={{
                    width: `${basePct}%`,
                    background: r.color ?? "var(--accent-coral)",
                    opacity: 0.16,
                  }}
                />
                {secPct > 0 && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0"
                    style={{
                      left: `${basePct}%`,
                      width: `${secPct}%`,
                      background: r.secondaryColor ?? "var(--muted-foreground)",
                      opacity: 0.22,
                    }}
                  />
                )}
                <div className="relative flex items-center justify-between gap-3 px-2 py-[7px]">
                  {/* KIRPMA YOK: uzun isim ikinci satıra sarar, kesilmez. */}
                  <span className="min-w-0 flex-1 text-[13px] leading-tight">{r.label}</span>
                  <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums">
                    {r.display ?? r.value.toLocaleString("tr-TR")}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {scope && (
        <div className="mt-3 border-t border-border pt-2 text-[12px] text-muted-foreground">
          {scope}
        </div>
      )}
    </div>
  );
}
