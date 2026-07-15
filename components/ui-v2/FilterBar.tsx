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
import { useUrlFilters } from "./useUrlFilters";

/**
 * Tek filtre çubuğu kaynağı (DESIGN-SYSTEM §7). Durum DAİMA URL'de
 * (useUrlFilters). 26-28 araçlık listede canlı filtreleme — "Uygula" yok.
 * Sonuç sayacı zorunlu; "Temizle" aktif filtre varken görünür.
 */
export type FilterSelect = {
  /** URL anahtarı (ör. "durum"). */
  key: string;
  /** Erişilebilir etiket. */
  label: string;
  options: { value: string; label: string }[];
  /** "Tümü" seçeneğinin etiketi (değeri boş string = URL'den silinir). */
  allLabel?: string;
};

export function FilterBar({
  searchKey = "q",
  searchPlaceholder = "Ara…",
  selects = [],
  resultCount,
  totalCount,
  countLabel = "kayıt",
  clearLabel = "Temizle",
  children,
  className,
}: {
  /** Arama kutusunun URL anahtarı; null = arama yok. */
  searchKey?: string | null;
  searchPlaceholder?: string;
  selects?: FilterSelect[];
  /** Filtre sonrası görünen kayıt sayısı (zorunlu sayaç). */
  resultCount: number;
  /** Filtresiz toplam — farklıysa "X / Y" gösterilir. */
  totalCount?: number;
  countLabel?: string;
  clearLabel?: string;
  /** Ek filtre öğeleri (tarih aralığı ön-ayarları vb.) — URL'e kendisi yazar. */
  children?: React.ReactNode;
  className?: string;
}) {
  const { get, set, clear } = useUrlFilters();

  const q = searchKey ? get(searchKey) : "";
  const hasActive =
    (searchKey && q !== "") || selects.some((s) => get(s.key) !== "");

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-[12px] border border-border/60 px-3 py-2",
        className
      )}
    >
      {searchKey && (
        <div className="relative min-w-40 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={q}
            onChange={(e) => set({ [searchKey]: e.target.value })}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-9 pl-8"
          />
        </div>
      )}

      {selects.map((s) => {
        const val = get(s.key);
        return (
          <Select
            key={s.key}
            value={val === "" ? "__all__" : val}
            onValueChange={(v) => set({ [s.key]: v === "__all__" ? null : v })}
          >
            <SelectTrigger className="h-9 w-auto min-w-32" aria-label={s.label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{s.allLabel ?? s.label}</SelectItem>
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
        {hasActive && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            onClick={() => clear()}
          >
            <X aria-hidden className="size-3.5" />
            {clearLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
