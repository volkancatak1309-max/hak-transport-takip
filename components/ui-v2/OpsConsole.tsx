"use client";

import { cn } from "@/lib/utils";

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
          "rounded-[16px] border border-border bg-surface-panel p-4"
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
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3 block last:mb-0">
      <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
        {label}
      </span>
      {children}
    </label>
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
        "surface-card grid grid-cols-2 gap-px overflow-hidden rounded-[16px] bg-border sm:grid-cols-3",
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
