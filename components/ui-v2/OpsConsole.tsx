"use client";

import { cn } from "@/lib/utils";
import { HelpTip } from "@/components/help/HelpTip";

/**
 * OPERASYON KONSOLU İSKELETİ — Stellate "Operations metrics" klonu
 * (Refero `e8b04517`, DESIGN.md §0 DESTEK C).
 *
 * Referansın yapısı birebir: SOL dar KALICI filtre sütunu + SAĞ geniş içerik.
 * Filtreler tablonun üstünde dağınık durmaz; kendi sütununda yaşar ve sayfa
 * kaydırılırken yerinde kalır (sticky). Yönetici filtreyi görmek için yukarı
 * kaydırmak zorunda kalmaz — Stellate'in bu ekranı kontrol odası gibi
 * okutmasının asıl sebebi budur.
 *
 * Nav rayının İÇİNE girer: DashboardShell (yüzen koyu ray) korunur, bu bileşen
 * yalnız içerik alanını ikiye böler.
 *
 * Dar ekranda tek kolona iner ve filtre sütunu içeriğin ÜSTÜNE geçer — mobilde
 * yan yana iki sütun okunmaz.
 */
export function OpsConsole({
  filters,
  children,
  className,
}: {
  /** Sol sütun — filtre yığını. */
  filters: React.ReactNode;
  /** Sağ sütun — sayı ızgarası, gruplu listeler, tablo. */
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-5 lg:flex-row lg:items-start", className)}>
      <aside
        className={cn(
          "w-full shrink-0 lg:sticky lg:top-4 lg:w-[240px]",
          "rounded-[14px] border border-border bg-surface-panel p-4"
        )}
      >
        {filters}
      </aside>
      <div className="min-w-0 flex-1 space-y-5">{children}</div>
    </div>
  );
}

/** Filtre sütunu içinde tek bir alan — etiket + kontrol. */
export function OpsFilter({
  label,
  help,
  children,
}: {
  label: string;
  /** "help" i18n uzayındaki anahtar; verilirse etiketin yanında (i) çıkar. */
  help?: string;
  children: React.ReactNode;
}) {
  // Etiket ikincil tonda: üçüncül ton (#909096) panel grisi üstünde 2.8:1
  // kalıyordu — filtre etiketi okunmazsa filtre de yok demektir.
  const labelSpan = (
    <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
      {label}
    </span>
  );

  // (i) VARSA <label> SARMALAYICISI KULLANILMAZ: HelpTip bir <button> render
  // ediyor ve <label> içindeki butona tıklamak etiketin kontrolünü de tetikler
  // (balonu açarken açılır menü de açılırdı). Bu dalda etiket ile alan
  // görsel olarak aynı kalır; bağ, alanın kendi aria-label'ıyla kurulu.
  if (help) {
    return (
      <div className="mb-3 last:mb-0">
        <span className="mb-1.5 flex items-center gap-1">
          {labelSpan}
          <HelpTip tkey={help} className="mb-1.5" />
        </span>
        {children}
      </div>
    );
  }

  return (
    <label className="mb-3 block last:mb-0">
      {labelSpan}
      {children}
    </label>
  );
}

/**
 * GRUPLU METRİK LİSTESİ — Stellate'in "Most Used / Highest latency / Highest
 * error rate" blokları. Başlık + satırlar; satırda etiket, opsiyonel yatay
 * mercan bar ve sağda mono değer.
 *
 * Referansta bar YALNIZ homojen sıralamada var (istek sayısı). Bizde de öyle:
 * `pct` verilmeyen satır barsız çizilir — karışık birimli metrikleri (km, adet,
 * saat) bar ile göstermek yanıltıcı olurdu.
 */
export function OpsGroup({
  title,
  count,
  icon,
  action,
  children,
  className,
}: {
  title: string;
  /** Başlığın yanındaki sayaç rozeti. */
  count?: number;
  icon?: React.ReactNode;
  /** Sağ üstte küçük eylem/etiket. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface-card flex flex-col rounded-[12px] p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          {icon}
          {title}
          {count !== undefined && count > 0 && (
            <span className="rounded-full bg-accent-coral-soft px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-accent-coral-text">
              {count}
            </span>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Gruplu listede tek satır. `pct` verilirse arkasına mercan oran barı çizilir. */
export function OpsGroupRow({
  label,
  help,
  value,
  meta,
  pct,
  tone = "neutral",
  icon,
  className,
}: {
  label: React.ReactNode;
  /** "help" i18n uzayındaki anahtar; verilirse etiketin yanında (i) çıkar. */
  help?: string;
  value: React.ReactNode;
  /** Değerin altındaki küçük açıklama. */
  meta?: React.ReactNode;
  /** 0-100. Verilirse hücre-içi oran barı çizilir (Stripe deseni). */
  pct?: number;
  tone?: "neutral" | "critical" | "warning";
  icon?: React.ReactNode;
  className?: string;
}) {
  const TONE = {
    neutral: "text-foreground",
    critical: "text-status-critical-text",
    warning: "text-accent-gold-text",
  } as const;
  return (
    <li className={cn("relative overflow-hidden rounded-[8px]", className)}>
      {pct !== undefined && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-[8px] bg-accent-coral opacity-[0.14]"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      )}
      <div className="relative flex items-start justify-between gap-3 px-2 py-2">
        <span className="flex min-w-0 flex-1 items-start gap-2 text-[13px] leading-tight">
          {icon}
          <span className="min-w-0">{label}</span>
          {help && <HelpTip tkey={help} />}
        </span>
        <span className="shrink-0 text-right">
          <span className={cn("font-mono text-[13px] font-semibold tabular-nums", TONE[tone])}>
            {value}
          </span>
          {meta && (
            <span className="mt-0.5 block text-[11px] text-text-tertiary">{meta}</span>
          )}
        </span>
      </div>
    </li>
  );
}

/**
 * SAYI IZGARASI — Stellate'in "Operations / Types / Fields" üçlüsü.
 * Büyük mono sayı + altında etiket. Kart YOK: sayılar panelin içinde yaşar,
 * aralarında dikey ayraç vardır (referansın birebir davranışı).
 */
export function OpsStatGrid({
  items,
  className,
}: {
  items: { key: string; label: string; value: React.ReactNode; accent?: boolean }[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "glass-panel grid grid-cols-2 gap-px overflow-hidden rounded-[16px] sm:grid-cols-3",
        className
      )}
    >
      {items.map((it) => (
        <div key={it.key} className="bg-card px-5 py-4">
          <div
            className={cn(
              "font-mono text-[28px] font-bold leading-none tabular-nums tracking-[-0.01em]",
              it.accent ? "text-accent-coral" : "text-foreground"
            )}
          >
            {it.value}
          </div>
          <div className="mt-2 text-[12px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
            {it.label}
          </div>
        </div>
      ))}
    </div>
  );
}
