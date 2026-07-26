"use client";

import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ENODE DETAY DİLİ — enode.com geliştirici konsolu klonu
 * (Refero `77cf19d7` / `5b7b3988`, DESIGN.md §0 DESTEK D).
 *
 * Referansın taşıdığımız üç özelliği:
 *   1. **Sessiz künye satırı** — etiket SOLDA ikincil tonda, değer SAĞDA
 *      birincil tonda, aralarında yalnız ince ayraç. Kutu içinde kutu yok.
 *   2. **Mikro bölüm etiketi** — 12px uppercase, geniş harf aralığı; bölüm
 *      başlığı büyük tipografiyle değil, küçük ve sabit bir işaretle kurulur.
 *   3. **Yoğunluk** — satır 44px, dikey ayraç YOK, gruplar arası boşluk grubun
 *      kendi iç boşluğundan büyük (grup sınırı boşlukla okunur).
 *
 * Detay ekranında sayı bloğu (KPI kartı) KULLANILMAZ: Enode'un künye ekranında
 * her ölçüm aynı satır dilinde yaşar. Ölçüm ile kimlik aynı gramerle okunur,
 * göz iki ayrı düzen öğrenmek zorunda kalmaz.
 */

/**
 * ÜÇ KOLON — nav (DashboardShell) · orta künye · sağ olay rayı.
 *
 * Nav rayı bu bileşenin İÇİNDE değil: kabuk (yüzen koyu ray) korunur, burada
 * yalnız içerik alanı ikiye bölünür. Dar ekranda tek kolona iner ve olay rayı
 * künyenin ALTINA geçer — olaylar künyeden önce gelirse mobilde araç kimliğini
 * görmek için kaydırmak gerekirdi.
 */
export function DetailColumns({
  children,
  rail,
  className,
}: {
  /** Orta kolon — künye ve ölçüm grupları. */
  children: React.ReactNode;
  /** Sağ kolon — olay rayı. */
  rail: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-5 xl:flex-row xl:items-start", className)}>
      <div className="min-w-0 flex-1 space-y-5">{children}</div>
      {/* Ray YAPIŞKAN DEĞİL: olay sayısı önceden bilinmiyor ve uzun bir ray
          sticky yapıldığında viewport'tan taşıp kendi içinde kilitleniyor —
          alttaki olaylara ulaşılamaz hâle geliyordu. */}
      <aside className="w-full shrink-0 space-y-3 xl:w-[340px]">{rail}</aside>
    </div>
  );
}

/**
 * KÜNYE GRUBU — mikro başlık + ayraçlı satır yığını.
 *
 * Başlığın solundaki 3px çubuk, referanstaki bölüm işaretinin karşılığı: grup
 * sınırını büyük tipografiyle değil küçük sabit bir işaretle kurar.
 *
 * İşaret VARSAYILAN OLARAK NÖTRDÜR. Mercan yalnız `accent` verilen TEK grupta
 * yanar — dört grubun dördünde de mercan çubuk olsaydı, tek başına ekranın
 * mercan bütçesini (DESIGN.md §2.2: 3-6 dokunuş) tüketirdi.
 */
export function SpecGroup({
  title,
  accent,
  action,
  children,
  footer,
  className,
}: {
  title: string;
  /** Sayfanın "canlı" grubu — işaret mercan yanar. Ekranda tek grupta kullan. */
  accent?: boolean;
  /** Başlık satırının sağındaki küçük eylem/rozet. */
  action?: React.ReactNode;
  /** <dl> — SpecRow satırları. */
  children: React.ReactNode;
  /** Satırlardan SONRA, ayracın altında yaşayan blok (mini harita, buton). */
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface-card overflow-hidden rounded-[14px]", className)}>
      <header className="flex items-center gap-2 px-5 pb-1 pt-4">
        <span
          aria-hidden
          className={cn(
            "h-3.5 w-[3px] shrink-0 rounded-full",
            accent ? "bg-accent-coral" : "bg-border"
          )}
        />
        <h2 className="text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          {title}
        </h2>
        {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
      </header>
      <dl className="px-5 pb-2">{children}</dl>
      {footer}
    </section>
  );
}

/**
 * TEK KÜNYE SATIRI — etiket solda, değer sağda.
 *
 * `onEdit` verilen satır düzenlenebilirdir ve sağında "Düzenle" taşır. Eylem
 * GİZLENMEZ (hover'da belirmez): görünmeyen eylem, olmayan eylemdir. Sessiz
 * kalması için üçüncül tonda durur, yalnız hover'da mercana döner.
 */
export function SpecRow({
  label,
  children,
  mono,
  onEdit,
  editLabel,
  muted,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  /** Alfanumerik kimlik ve ölçüm (plaka, VIN, IMEI, km, saat) — DESIGN.md §3. */
  mono?: boolean;
  onEdit?: () => void;
  editLabel?: string;
  /** Değer "kayıtlı değil" gibi bir yokluk ise soluk yazılır. */
  muted?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[44px] items-center gap-3 border-b border-border/60 py-2 last:border-0",
        className
      )}
    >
      <dt className="w-[38%] shrink-0 text-[13px] leading-snug text-muted-foreground">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {/* Değer kırpılmaz: uzun künye alanları (VIN, IMEI) sarar. Plaka ve
            benzeri kısa kimlikler zaten tek satıra sığar. */}
        <span
          className={cn(
            "min-w-0 break-words text-right text-[13px] leading-snug",
            mono && "font-mono tabular-nums",
            muted ? "text-text-tertiary" : "text-foreground"
          )}
        >
          {children}
        </span>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[8px] px-1.5 text-[12px] font-medium text-text-tertiary transition-colors hover:bg-surface-hover hover:text-accent-coral-text"
          >
            <Pencil className="size-3.5" aria-hidden />
            {editLabel}
          </button>
        )}
      </dd>
    </div>
  );
}

/**
 * OLAY RAYI BÖLÜMÜ — sağ kolonun başlığı + sayacı.
 *
 * Sayaç rozeti mercandır (DESIGN.md §2.2 "önemli sayı"); kritik sayılar kendi
 * durum rengini kart üstünde taşır, başlıkta yarışmazlar.
 */
export function RailSection({
  title,
  count,
  action,
  children,
  className,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)}>
      <header className="flex items-center gap-2 px-1">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          {title}
        </h2>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-accent-coral-soft px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-accent-coral-text">
            {count}
          </span>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}

export type RailTone = "neutral" | "critical" | "warning" | "info";

const RAIL_TONE: Record<RailTone, string> = {
  neutral: "bg-surface-panel text-text-tertiary",
  critical: "bg-status-critical-soft text-status-critical",
  warning: "bg-accent-gold/15 text-accent-gold-text",
  info: "bg-accent-sky/15 text-accent-sky-text",
};

/**
 * OLAY KARTI — rayda tek olay: ikon, başlık, zaman, kendi eylemi.
 *
 * Her kart kendi eylemini TAŞIR (haritada göster / şoförü aç / detayı aç).
 * Referansın kuralı: ray bir liste değil, karar verilebilir kartlar yığınıdır.
 *
 * Olayın ağırlığı YALNIZ ikon madalyonunda yaşar: renk + ikon şekli iki ayrı
 * kanal (DESIGN.md §7 — renk tek anlam taşıyıcısı olamaz). Kart kenarına renkli
 * şerit ÇEKİLMEZ; ne Enode ne Clay referansında böyle bir şerit var ve kartın
 * kendisi zaten nötr yüzey olarak kalmalı.
 */
export function RailCard({
  icon,
  tone = "neutral",
  title,
  time,
  action,
  children,
  className,
}: {
  icon: React.ReactNode;
  tone?: RailTone;
  title: React.ReactNode;
  /** Sağ üstte küçük zaman/ölçü etiketi. */
  time?: React.ReactNode;
  /** Kartın kendi eylemi — alt satırda. */
  action?: React.ReactNode;
  /** Ek gövde (açılan detay). */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <article className={cn("surface-card rounded-[12px] px-3 py-2.5", className)}>
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full",
            RAIL_TONE[tone]
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 break-words text-[13px] font-medium leading-snug">
              {title}
            </span>
            {time && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-tertiary">
                {time}
              </span>
            )}
          </div>
          {children}
          {action && <div className="mt-1.5">{action}</div>}
        </div>
      </div>
    </article>
  );
}
