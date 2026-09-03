/**
 * SUPABASE ŞİMİ — kuru koşum için (`scripts/ts-server-kuru.mjs`).
 *
 * ═══ NEDEN VAR ═══
 *
 * Yeni uçların davranışı (hangi kapı hangi durumda kapanıyor, hangi kolonlar
 * yazılıyor, kilit sayacı ilerliyor mu) ancak KODUN KENDİSİ koşturularak
 * ölçülebilir. Ama bu depoda elde yalnız İKİ CANLI MÜŞTERİ anahtarı var
 * (HAK61, Sendigo) ve ikisine de yazma YASAK.
 *
 * Bu şim `supabaseAdmin`in yerine geçer: PostgREST zincirini taklit eder,
 * HER ÇAĞRIYI KAYDEDER ve cevabı senaryodan alır. Böylece gerçek route
 * handler'lar, gerçek çekirdekler ve gerçek şemalar koşar; yalnız veritabanı
 * yerini bir kayıt cihazı alır.
 *
 * ⚠️ BU BİR TEST ÇİFTİ, KANIT DEĞİL. Ne ispatlar: kodun KARAR AKIŞI ve
 * ÜRETTİĞİ YÜK. Ne ispatlamaz: veritabanının o yükü kabul edeceği (kolon
 * varlığı, CHECK kısıtları, unique indeks). O ayrı ölçülüyor —
 * `scripts/measure-mobil-uc1-zemin.mjs` şemayı CANLI kiracılarda okuyor.
 *
 * Senaryo `globalThis.__SENARYO__(durum)` ile verilir; `{data, error}` döner.
 * Kayıtlar `globalThis.__CAGRILAR__` dizisinde birikir.
 */

/** Şim gerçekten devrede mi — betikler bunu KONTROL ETMELİ (yanlışlıkla canlıya yazma). */
export const __MOCK__ = true;

/**
 * SAF YARDIMCILAR — GERÇEK dosyadan yeniden ihraç edilir, KOPYALANMAZ.
 *
 * `fetchAllRows` / `fetchPagesUntil` / `chunkIds` veritabanına dokunmuyor:
 * üçü de aldıkları `build` geri çağrısını sayfalıyor. Kopyalasaydık
 * PostgREST'in 1000 satır tavanına karşı yazılmış o sayfalama mantığı
 * ölçümde farklı davranabilirdi — tam da ölçmek istediğimiz şeyin dışında
 * kalan bir fark. Yükleyici bu içe aktarmayı (ve YALNIZ bunu) şime geri
 * yönlendirmiyor; `supabaseAdmin` yine aşağıdaki sahte olan.
 */
export { fetchAllRows, fetchPagesUntil, chunkIds } from "../lib/supabase.ts";

function zincir(table) {
  const durum = { table, op: null, payload: null, opts: null, filters: [], secim: null };

  const kaydet = () => {
    const kopya = { ...durum, filters: [...durum.filters] };
    (globalThis.__CAGRILAR__ ??= []).push(kopya);
    const cevap = globalThis.__SENARYO__?.(kopya);
    return Promise.resolve(cevap ?? { data: null, error: null });
  };

  const c = {
    // `select` insert/update'ten SONRA da çağrılıyor (`.insert(x).select("id")`),
    // o yüzden mevcut op'u EZMEZ.
    select(s) {
      durum.secim = s ?? "*";
      durum.op ??= "select";
      return c;
    },
    insert(p) {
      durum.op = "insert";
      durum.payload = p;
      return c;
    },
    update(p) {
      durum.op = "update";
      durum.payload = p;
      return c;
    },
    upsert(p, o) {
      durum.op = "upsert";
      durum.payload = p;
      durum.opts = o;
      return c;
    },
    delete() {
      durum.op = "delete";
      return c;
    },
    maybeSingle: kaydet,
    single: kaydet,
    // await edilen zincir (terminal metod olmadan): `.update(x).eq(...)`
    then(res, rej) {
      return kaydet().then(res, rej);
    },
    catch(rej) {
      return kaydet().catch(rej);
    },
  };

  // Filtre/sıra metodlarının hepsi zinciri döndürür ve durumu kaydeder.
  for (const m of [
    "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "contains",
  ]) {
    c[m] = (a, b) => {
      durum.filters.push([m, a, b]);
      return c;
    };
  }
  c.is = (a, b) => {
    durum.filters.push(["is", a, b]);
    return c;
  };
  c.not = (a, b, d) => {
    durum.filters.push(["not", a, b, d]);
    return c;
  };
  c.order = (a, o) => {
    durum.filters.push(["order", a, o]);
    return c;
  };
  c.limit = (n) => {
    durum.filters.push(["limit", n]);
    return c;
  };
  c.range = (a, b) => {
    durum.filters.push(["range", a, b]);
    return c;
  };

  return c;
}

export const supabaseAdmin = {
  __MOCK__: true,
  from: (t) => zincir(t),
  rpc: (ad, args) => {
    const kopya = { table: `rpc:${ad}`, op: "rpc", payload: args, filters: [] };
    (globalThis.__CAGRILAR__ ??= []).push(kopya);
    return Promise.resolve(globalThis.__SENARYO__?.(kopya) ?? { data: null, error: null });
  },
  storage: {
    from: () => ({
      upload: async () => ({ data: null, error: null }),
      download: async () => ({ data: null, error: null }),
      createSignedUrl: async () => ({ data: null, error: null }),
      createSignedUrls: async () => ({ data: [], error: null }),
    }),
  },
};

export default supabaseAdmin;
