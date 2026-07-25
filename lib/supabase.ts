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

/** PostgREST'in sunucu tarafı sayfa boyu. Sorgudaki `.limit()` bunu AŞAMAZ. */
const PAGE_SIZE = 1000;
/**
 * Sayfa üst sınırı (= 100.000 satır). Kaçak bir döngüye karşı emniyet; normal
 * bir sorgu buna asla dayanmaz. Dayanırsa sonuç EKSİKTİR ve log'a düşer.
 */
const PAGE_LIMIT = 100;

/**
 * Kırpma SESSİZ kalmasın (25.07.2026). Kırpmanın tehlikesi hata vermemesidir:
 * sorgu başarılı görünür, dizi kısa gelir, rapor eksik basar. 14 günlük telemetri
 * ortalamasının tek kısmi günden hesaplandığı canlı hata tam olarak böyle
 * yakalandı — ekranda hiçbir belirti yoktu.
 */
function warnTruncated(label: string, count: number): void {
  console.warn(
    `[supabase] ${label}: ${PAGE_LIMIT} sayfa (${count} satır) sonrasında durdu — ` +
      `SONUÇ EKSİK OLABİLİR. Sorgunun aralığını daralt ya da toplamayı SQL tarafına taşı.`
  );
}

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
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label = "fetchAllRows"
): Promise<{ data: Row[]; error: { message: string } | null }> {
  const all: Row[] = [];
  for (let page = 0; page < PAGE_LIMIT; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) return { data: all, error };
    const rows = (data ?? []) as Row[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return { data: all, error: null };
  }
  // Backstop'a dayandık: sonuç EKSİK olabilir. Sessiz kalmak, bu dosyanın
  // varlık sebebinin tam tersi olurdu.
  warnTruncated(label, all.length);
  return { data: all, error: null };
}

/**
 * Sayfalı okuma + ERKEN ÇIKIŞ: her sayfadan sonra `probe` denenir, ilk
 * `null`/`undefined` OLMAYAN sonuç döner ve kalan sayfalar hiç okunmaz.
 *
 * `fetchAllRows`'tan farkı, aranan şeyin serinin BAŞINDA olduğu durumlar için
 * olması: "bugün depoya ilk giriş" gibi. Tüm günü belleğe almadan, ama gerekirse
 * tamamını tarayarak cevabı bulur — tipik olarak tek sayfayla biter.
 *
 * `probe` BİRİKMİŞ satırların tamamını alır (yalnız son sayfayı değil): aranan
 * olgu iki sayfaya bölünmüş olabilir (ör. depo girişi sayfa sonunda, 3 dakikalık
 * histerezis sonraki sayfada).
 */
export async function fetchPagesUntil<Row, Result>(
  build: (
    from: number,
    to: number
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  probe: (rows: Row[]) => Result | null | undefined,
  label = "fetchPagesUntil"
): Promise<{ result: Result | null; rows: Row[]; error: { message: string } | null }> {
  const all: Row[] = [];
  for (let page = 0; page < PAGE_LIMIT; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) return { result: null, rows: all, error };
    const rows = (data ?? []) as Row[];
    all.push(...rows);
    const hit = probe(all);
    if (hit !== null && hit !== undefined) {
      return { result: hit, rows: all, error: null };
    }
    if (rows.length < PAGE_SIZE) return { result: null, rows: all, error: null };
  }
  warnTruncated(label, all.length);
  return { result: null, rows: all, error: null };
}

/** `.in()` sorgularının URL uzunluk sınırına takılmaması için id listesini böler. */
export function chunkIds<T>(ids: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
