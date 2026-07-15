import "server-only";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    "Supabase env vars eksik. NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY .env.local içinde olmalı."
  );
}

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Supabase (PostgREST) her sorguyu sunucu tarafında max-rows=1000 ile keser —
 * `.limit()` verilmese bile. Rapor/toplam üreten bir sorgu bu tavana takılınca
 * veri SESSİZCE eksilir (Excel/PDF eksik basar). Bu yardımcı, sorguyu 1000'lik
 * sayfalarla sonuna kadar okur.
 *
 * `build(from, to)` her çağrıda AYNI filtre + DETERMİNİSTİK sıralamayla yeni
 * bir builder dönmeli ve `.range(from, to)` uygulanmış olmalı. Eşit sıralama
 * anahtarlarında sayfalar arası kayma olmaması için sorguya ikincil
 * `.order("id")` eklenmelidir.
 */
export async function fetchAllRows<Row>(
  build: (
    from: number,
    to: number
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ data: Row[]; error: { message: string } | null }> {
  const PAGE = 1000;
  const all: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) return { data: all, error };
    const rows = (data ?? []) as Row[];
    all.push(...rows);
    if (rows.length < PAGE) return { data: all, error: null };
  }
}

/** `.in()` sorgularının URL uzunluk sınırına takılmaması için id listesini böler. */
export function chunkIds<T>(ids: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
