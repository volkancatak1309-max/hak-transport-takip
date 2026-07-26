import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";

/**
 * Rapor merkezi kartı — Resend "Metrics" KPI kartı dili (`ff328c72`).
 *
 * Referansın kartında hiyerarşi tersine çevrilmiştir: küçük etiket üstte, BÜYÜK
 * rakam altta. Burada da öyle — çünkü bu kartta karar verdiren şey rapor adı
 * değil, arkasındaki VERİ HACMİ. "2.104 olay" gören yönetici raporu açar,
 * "0 olay" gören açmaz. Eskiden hacim 11px'lik gri bir dipnottu ve kimse
 * okumadan tıklıyordu.
 *
 * `meta` iki parçaya ayrıldı: `metaValue` (rakam, mono) + `metaLabel` (birim).
 * Rakamın kendisi ölçümdür, birimi etikettir; ikisi aynı tipografiyi paylaşamaz.
 *
 * Kartın tamamı tek bağlantıdır — dar ekranda "doğru yere basma" sorunu olmasın.
 */
export function ReportCard({
  href,
  icon: Icon,
  title,
  description,
  contains,
  metaValue,
  metaLabel,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  contains: string[];
  /** Veri hacminin RAKAMI (ör. "2.104"). */
  metaValue: string;
  /** Rakamın birimi (ör. "olay"). */
  metaLabel: string;
  /** Rapora nasıl ulaşıldığı / sayının nasıl türediği — eski meta cümlesinin
   *  kaybolmaması için ayrı satır (ör. "araç seçip Rota sekmesine girin"). */
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className="group surface-card flex flex-col rounded-[16px] p-6 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex items-start gap-3">
        {/* Bordo ikon madalyonu — filo kimliğinin ikincil aksan rolü
            (DESIGN.md §2.2). "bg-accent-claret-soft" diye bir utility YOK;
            sınıf sessizce düşer ve zemin şeffaf kalırdı. */}
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-claret/12 text-accent-claret-text">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-tight">{title}</h3>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            {description}
          </p>
        </div>
        <ArrowUpRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>

      {/* HACİM — kartın kahraman rakamı. mt-auto: aynı satırdaki kartlar eşit
          yüksekliğe uzadığında rakamlar satır boyunca aynı hizada okunur. */}
      <div className="mt-auto flex items-baseline gap-1.5 pt-6">
        <span className="font-mono text-[28px] font-bold leading-none tracking-[-0.02em]">
          {metaValue}
        </span>
        <span className="text-[12px] text-muted-foreground">{metaLabel}</span>
      </div>
      {hint && (
        <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">{hint}</p>
      )}

      <ul className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/60 pt-3 text-[12px] text-muted-foreground">
        {contains.map((c) => (
          <li key={c} className="flex items-center gap-1.5">
            <span className="size-1 rounded-full bg-muted-foreground/50" aria-hidden />
            {c}
          </li>
        ))}
      </ul>
    </Link>
  );
}
