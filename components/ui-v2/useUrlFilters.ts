"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Filtre durumu DAİMA URL'de (DESIGN-SYSTEM §7 FilterBar): paylaşılabilir
 * link, yenilemeye dayanıklı, geri tuşu çalışır. Dashboard'daki mevcut
 * searchParams deseninin tüm sayfalara genelleşmiş hâli.
 *
 * Boş/varsayılan değerler URL'den SİLİNİR — temiz link ("?durum=&q=" değil).
 */
export function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const get = useCallback(
    (key: string, fallback = "") => searchParams.get(key) ?? fallback,
    [searchParams]
  );

  /** Birden çok anahtarı tek seferde yazar; null/""/undefined anahtarı siler. */
  const set = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  /** Tüm filtreleri temizler (korunacak anahtarlar hariç tutulabilir). */
  const clear = useCallback(
    (keep: string[] = []) => {
      const next = new URLSearchParams();
      for (const k of keep) {
        const v = searchParams.get(k);
        if (v) next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return { get, set, clear, searchParams };
}
