import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

/**
 * Rapor merkezi kartı. Tek bir rapora giden kapı: ne olduğu (başlık + bir
 * cümle), NE İÇERDİĞİ (madde listesi) ve verinin nereden geldiği tek bakışta
 * okunur. Kartın tamamı tek bir bağlantıdır — dar ekranda "doğru yere basma"
 * sorunu kalmasın diye ayrı bir buton yok.
 *
 * `meta` verinin GERÇEK hacmini yazar (ör. "2.104 olay"). Bu bilinçli: boş bir
 * raporu açıp "veri yok" görmek, kartta baştan görmekten daha kötüdür.
 */
export function ReportCard({
  href,
  icon: Icon,
  title,
  description,
  contains,
  meta,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  contains: string[];
  meta: string;
}) {
  return (
    <Link
      href={href}
      className="group glass flex flex-col gap-3 rounded-[10px] p-4 transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex items-start gap-3">
        {/* Bordo ikon kutusu — OpsSummary/AttentionList ile AYNI çift:
            `bg-accent-claret/12 + text-accent-claret-text`. "bg-accent-claret-soft"
            diye bir utility YOK (tema değişkeni --color-brand-soft'a bağlı),
            sınıf sessizce düşer ve zemin şeffaf kalırdı. */}
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-claret/12 text-accent-claret-text">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-tight">{title}</h3>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            {description}
          </p>
        </div>
        <ChevronRight
          className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>

      <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border/60 pt-2.5 text-[12px] text-muted-foreground">
        {contains.map((c) => (
          <li key={c} className="flex items-center gap-1.5">
            <span
              className="size-1 rounded-full bg-muted-foreground/50"
              aria-hidden
            />
            {c}
          </li>
        ))}
      </ul>

      {/* mt-auto: aynı satırdaki kartlar eşit yüksekliğe uzar (grid stretch);
          hacim satırı olmadan kart altında düzensiz boşluk kalırdı. Alta
          yaslanınca satır boyunca aynı hizada okunur. */}
      <p className="nums mt-auto text-[11px] font-medium text-text-tertiary">{meta}</p>
    </Link>
  );
}
