"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Tek filtre çubuğu kaynağı (DESIGN-SYSTEM §7) — KONTROLLÜ/presentational.
 * Ebeveyn state'i tutar (anlık filtreleme; her tuşta RSC refetch YOK). Ebeveyn
 * dilerse durumu URL'e mirror'lar (useUrlFilters ile) — 28 araçlık listede
 * varsayılan olarak client-state daha doğru. Sonuç sayacı zorunlu; "Temizle"
 * aktif filtre varken görünür.
 */
export type FilterSelect = {
  /** Erişilebilir etiket + trigger üzerinde görünen değer. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  /** "Tümü" seçeneğinin etiketi (değeri boş string). */
  allLabel?: string;
};

const ALL = "__all__";

export function FilterBar({
  search,
  selects = [],
  resultCount,
  totalCount,
  countLabel = "kayıt",
  clearLabel = "Temizle",
  onClear,
  children,
  className,
}: {
  /** Arama kutusu; verilmezse yok. */
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  selects?: FilterSelect[];
  /** Filtre sonrası görünen kayıt sayısı (zorunlu sayaç). */
  resultCount: number;
  /** Filtresiz toplam — farklıysa "X / Y" gösterilir. */
  totalCount?: number;
  countLabel?: string;
  clearLabel?: string;
  /** Tüm filtreleri sıfırlar; verilmezse "Temizle" gösterilmez. */
  onClear?: () => void;
  /** Ek öğeler (tarih aralığı ön-ayarları vb.). */
  children?: React.ReactNode;
  className?: string;
}) {
  const hasActive =
    (search && search.value !== "") || selects.some((s) => s.value !== "");

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-[12px] border border-border/60 px-3 py-2",
        className
      )}
    >
      {search && (
        <div className="relative min-w-40 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder ?? "Ara…"}
            aria-label={search.placeholder ?? "Ara"}
            className="h-9 pl-8"
          />
        </div>
      )}

      {selects.map((s, i) => {
        const display =
          s.value === ""
            ? s.allLabel ?? s.label
            : s.options.find((o) => o.value === s.value)?.label ?? s.value;
        return (
        <Select
          key={i}
          value={s.value === "" ? ALL : s.value}
          onValueChange={(v) => s.onChange(v == null || v === ALL ? "" : String(v))}
        >
          <SelectTrigger className="h-9 w-auto min-w-32" aria-label={s.label}>
            <SelectValue>{display}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{s.allLabel ?? s.label}</SelectItem>
            {s.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        );
      })}

      {children}

      <div className="ml-auto flex items-center gap-2">
        <span className="nums text-xs text-muted-foreground">
          {totalCount !== undefined && totalCount !== resultCount
            ? `${resultCount} / ${totalCount} ${countLabel}`
            : `${resultCount} ${countLabel}`}
        </span>
        {hasActive && onClear && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            onClick={onClear}
          >
            <X aria-hidden className="size-3.5" />
            {clearLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
