"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDensity } from "./useDensity";
import { EmptyState } from "./EmptyState";

/**
 * Tek tablo kaynağı (DESIGN-SYSTEM §6). Sticky uppercase başlık, sıralama
 * (kontrollü → sayfa URL'e yazar; kontrolsüz → yerel), 50'lik sayfalama +
 * zorunlu "X / Y" sayacı, yoğunluk modları (rahat 48 / sıkı 40), sol durum
 * şeridi, satır tıklama → drawer, olay-fırtınası gruplama ("Sert Viraj ×3").
 * Zebra yok; silme ikonu satırda yaşayamaz (üç-nokta menü slotu kullanılır).
 */
export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Sayısal kolonlar sağa hizalı + .nums (DESIGN-SYSTEM §3). */
  align?: "left" | "right";
  nums?: boolean;
  sortable?: boolean;
  /** Sıralama anahtarı; verilmezse cell metni kullanılamaz → sortable şart koşar. */
  sortValue?: (row: T) => number | string;
  /** Mobil kolon önceliklendirme: bu kırılımın ALTINDA gizlenir. */
  hideBelow?: "sm" | "md" | "lg";
  className?: string;
};

export type SortState = { key: string; dir: "asc" | "desc" } | null;

export type GroupingConfig<T> = {
  /** Aynı anahtar + pencere içi ardışık satırlar tek satıra katlanır. */
  getKey: (row: T) => string;
  getTime: (row: T) => number;
  windowMs: number;
  /** Katlanmış satırın etiketi (ör. "Sert Viraj ×3"). */
  renderLabel: (rows: T[]) => React.ReactNode;
};

const HIDE: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

type DisplayItem<T> = { type: "row"; row: T } | { type: "group"; key: string; rows: T[] };

function buildItems<T>(rows: T[], grouping?: GroupingConfig<T>): DisplayItem<T>[] {
  if (!grouping) return rows.map((row) => ({ type: "row", row }));
  const items: DisplayItem<T>[] = [];
  let bucket: T[] = [];
  const flush = () => {
    if (bucket.length === 0) return;
    if (bucket.length === 1) items.push({ type: "row", row: bucket[0] });
    else
      items.push({
        type: "group",
        key: `${grouping.getKey(bucket[0])}:${grouping.getTime(bucket[0])}`,
        rows: bucket,
      });
    bucket = [];
  };
  for (const row of rows) {
    if (bucket.length === 0) {
      bucket.push(row);
      continue;
    }
    const prev = bucket[bucket.length - 1];
    const sameKey = grouping.getKey(prev) === grouping.getKey(row);
    const inWindow =
      Math.abs(grouping.getTime(row) - grouping.getTime(prev)) <= grouping.windowMs;
    if (sameKey && inWindow) bucket.push(row);
    else {
      flush();
      bucket.push(row);
    }
  }
  flush();
  return items;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  stripe,
  grouping,
  sort,
  onSortChange,
  pageSize = 50,
  totalLabel = "kayıt",
  moreLabel = "Daha fazla göster",
  empty,
  rowMenu,
  className,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Satır tıklama → DetailDrawer açar (yeni sayfa değil). */
  onRowClick?: (row: T) => void;
  /** Sol 3px durum şeridi rengi (CSS değeri, token: "var(--status-active)"). */
  stripe?: (row: T) => string | null;
  grouping?: GroupingConfig<T>;
  /** Kontrollü sıralama (sayfa URL'e yazar); verilmezse yerel state. */
  sort?: SortState;
  onSortChange?: (s: SortState) => void;
  pageSize?: number;
  totalLabel?: string;
  moreLabel?: string;
  /** Boş durum — EmptyState bekler; verilmezse jenerik. */
  empty?: React.ReactNode;
  /** Satır sonu üç-nokta menüsü (silme/ikincil eylemler burada yaşar). */
  rowMenu?: (row: T) => React.ReactNode;
  className?: string;
}) {
  const [density] = useDensity();
  const [localSort, setLocalSort] = useState<SortState>(null);
  const [visible, setVisible] = useState(pageSize);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const activeSort = sort !== undefined ? sort : localSort;
  const applySort = onSortChange ?? setLocalSort;

  const sorted = useMemo(() => {
    if (!activeSort) return rows;
    const col = columns.find((c) => c.key === activeSort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    const dir = activeSort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = sv(a), vb = sv(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  }, [rows, activeSort, columns]);

  const items = useMemo(() => buildItems(sorted, grouping), [sorted, grouping]);
  const shown = items.slice(0, visible);
  const cellPad = density === "compact" ? "py-2" : "py-3";

  function toggleSort(col: Column<T>) {
    if (!col.sortable) return;
    if (activeSort?.key !== col.key) applySort({ key: col.key, dir: "asc" });
    else if (activeSort.dir === "asc") applySort({ key: col.key, dir: "desc" });
    else applySort(null);
  }

  if (rows.length === 0)
    return <>{empty ?? <EmptyState title="Kayıt yok" />}</>;

  const renderCells = (row: T) =>
    columns.map((col) => (
      <td
        key={col.key}
        className={cn(
          "px-3 text-sm",
          cellPad,
          col.align === "right" && "text-right",
          col.nums && "nums",
          col.hideBelow && HIDE[col.hideBelow],
          col.className
        )}
      >
        {col.cell(row)}
      </td>
    ));

  return (
    <div className={cn("surface-card overflow-hidden rounded-[14px]", className)}>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border/60">
              <th className="w-[3px] p-0" aria-hidden />
              {columns.map((col) => {
                const isSorted = activeSort?.key === col.key;
                return (
                  <th
                    key={col.key}
                    aria-sort={
                      isSorted ? (activeSort!.dir === "asc" ? "ascending" : "descending") : undefined
                    }
                    className={cn(
                      "px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground",
                      col.align === "right" && "text-right",
                      col.hideBelow && HIDE[col.hideBelow]
                    )}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className="inline-flex items-center gap-1 uppercase tracking-[0.04em] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      >
                        {col.header}
                        {isSorted &&
                          (activeSort!.dir === "asc" ? (
                            <ChevronUp aria-hidden className="size-3" />
                          ) : (
                            <ChevronDown aria-hidden className="size-3" />
                          ))}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
              {rowMenu && <th className="w-10 px-2" aria-label="Eylemler" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {shown.map((item) => {
              if (item.type === "row") {
                const row = item.row;
                const stripeColor = stripe?.(row) ?? null;
                return (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      "group",
                      onRowClick && "cursor-pointer transition-colors hover:bg-surface-2 active:bg-surface-3"
                    )}
                  >
                    <td className="w-[3px] p-0" aria-hidden>
                      {stripeColor && (
                        <div className="h-full min-h-6 w-[3px]" style={{ background: stripeColor }} />
                      )}
                    </td>
                    {renderCells(row)}
                    {rowMenu && (
                      <td className={cn("px-2", cellPad)} onClick={(e) => e.stopPropagation()}>
                        <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          {rowMenu(row)}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              }
              // Katlanmış olay-fırtınası grubu
              const open = openGroups.has(item.key);
              const first = item.rows[0];
              const stripeColor = stripe?.(first) ?? null;
              return (
                <GroupRows
                  key={item.key}
                  open={open}
                  onToggle={() =>
                    setOpenGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.key)) next.delete(item.key);
                      else next.add(item.key);
                      return next;
                    })
                  }
                  label={grouping!.renderLabel(item.rows)}
                  colSpan={columns.length + (rowMenu ? 2 : 1)}
                  stripeColor={stripeColor}
                  cellPad={cellPad}
                >
                  {item.rows.map((row) => (
                    <tr
                      key={rowKey(row)}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn(
                        "bg-surface-2/40",
                        onRowClick && "cursor-pointer transition-colors hover:bg-surface-2"
                      )}
                    >
                      <td className="w-[3px] p-0" aria-hidden />
                      {renderCells(row)}
                      {rowMenu && <td className="px-2" />}
                    </tr>
                  ))}
                </GroupRows>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border/60 px-4 py-2.5">
        <span className="nums text-xs text-muted-foreground">
          {Math.min(visible, items.length)} / {items.length} {totalLabel}
        </span>
        {items.length > visible && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setVisible((v) => v + pageSize)}>
            {moreLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

function GroupRows({
  open,
  onToggle,
  label,
  colSpan,
  stripeColor,
  cellPad,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: React.ReactNode;
  colSpan: number;
  stripeColor: string | null;
  cellPad: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer transition-colors hover:bg-surface-2 active:bg-surface-3"
      >
        <td className="w-[3px] p-0" aria-hidden>
          {stripeColor && <div className="h-full min-h-6 w-[3px]" style={{ background: stripeColor }} />}
        </td>
        <td colSpan={colSpan - 1} className={cn("px-3 text-sm", cellPad)}>
          <span className="inline-flex items-center gap-1.5">
            {open ? (
              <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
            )}
            {label}
          </span>
        </td>
      </tr>
      {open && children}
    </>
  );
}

/** Satır sonu üç-nokta tetikleyicisi — silme/ikincil eylemler menüde yaşar. */
export function RowMenuTrigger(props: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label="Eylemler"
      {...props}
    >
      <MoreHorizontal aria-hidden className="size-4" />
    </Button>
  );
}
