import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu, kolonYokMu } from "@/lib/fault-reports";

/**
 * TESLİMAT KANITI (ePOD) — veri katmanı (migration 080).
 *
 * ═══ KANIT NEYE BAĞLI ═══
 *
 * Seferin BİR DURAĞINA, sefere değil. 082'den sonra bağ İKİ alanda duruyor:
 *   · `durak_id` — KALICI bağ (`sefer_duraklari` satırı). Yeniden sıralamada
 *     değişmez; kanıtın hangi teslimata ait olduğunu bu söyler.
 *   · `durak_no` — yazıldığı ANDAKİ sıra. Bilgi amaçlı bir anlık görüntü;
 *     durak listesi OLMAYAN seferlerde (082 öncesi ya da duraksız) tek bağdır
 *     ve orada 1'dir.
 * Tekillik de buna göre ikiye ayrıldı (082): duraklı seferde "bir durağın tek
 * GEÇERLİ kanıtı", duraksız seferde eski `(sefer_id, durak_no)` garantisi.
 *
 * ═══ YAZMA TEK YÖNLÜ ═══
 *
 * Bu dosyada GÜNCELLEME fonksiyonu YOKTUR — iptal dışında. Veritabanı da aynı
 * şeyi söylüyor (`trg_teslimat_degismez`), yani kural iki katmanda birden
 * duruyor: biri unutulursa diğeri tutar.
 *
 * ⚠️ KAPI BURADA YOK. Çağıran yetkiyi KENDİ denetler: şoför yalnız KENDİ
 * seferine kanıt bırakabilir, yönetici yalnız kapsamındaki seferi okur.
 * lib/sefer-db.ts ile aynı kural.
 */

/** Fotoğrafların gittiği özel kova (080'de yaratılıyor). */
export const TESLIMAT_KOVASI = "teslimat-kaniti";

export type TeslimatGirdi = {
  seferId: string;
  workerId: string;
  /** Kalıcı durak bağı (082). Duraksız seferde null. */
  durakId?: string | null;
  /** Yazıldığı andaki sıra — anlık görüntü. Duraksız seferde 1. */
  durakNo?: number;
  zoneId?: string | null;
  aliciAd?: string | null;
  notlar?: string | null;
  /** İmza, SVG yol verisi (vektör) — birincil biçim. */
  imzaSvg?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  dogrulukM?: number | null;
};

export type TeslimatFoto = {
  id: string;
  storagePath: string;
  takenAt: string;
  latitude: number | null;
  longitude: number | null;
};

export type Teslimat = {
  id: string;
  seferId: string;
  durakNo: number;
  durakId: string | null;
  workerId: string;
  zoneId: string | null;
  aliciAd: string | null;
  notlar: string | null;
  imzaSvg: string | null;
  imzaYol: string | null;
  teslimAt: string;
  latitude: number | null;
  longitude: number | null;
  dogrulukM: number | null;
  iptalAt: string | null;
  iptalSebep: string | null;
  fotograflar: TeslimatFoto[];
};

/**
 * ⚠️ İKİ KOLON LİSTESİ — 082 UYGULANMAMIŞ KURULUM İÇİN.
 *
 * `durak_id` 082 ile geliyor. Kolonu koşulsuz seçmek, 082'yi çalıştırmamış bir
 * kiracıda TÜM ePOD okumasını 42703 ile düşürürdü — yani 080 ile gelen
 * çalışan bir özelliği yeni bir migration'a rehin almak. Okuma önce yeni
 * listeyle denenir, kolon yoksa ESKİ listeye düşer ve durum bir kez loglanır.
 * Sessiz düşüş yok, kırılma da yok.
 */
const COLS =
  "id, sefer_id, durak_no, durak_id, worker_id, zone_id, alici_ad, notlar, imza_svg, imza_yol, teslim_at, latitude, longitude, konum_dogruluk_m, iptal_at, iptal_sebep";
const COLS_082_ONCESI =
  "id, sefer_id, durak_no, worker_id, zone_id, alici_ad, notlar, imza_svg, imza_yol, teslim_at, latitude, longitude, konum_dogruluk_m, iptal_at, iptal_sebep";

let durakKolonuUyarildi = false;
function durakKolonuYok(): string {
  if (!durakKolonuUyarildi) {
    durakKolonuUyarildi = true;
    console.warn(
      "[teslimat-db] `teslimatlar.durak_id` yok — migration 082 uygulanmamış. " +
        "Kanıt okuması eski kolon listesine düştü; çok duraklı bağ KAPALI."
    );
  }
  return COLS_082_ONCESI;
}
const FOTO_COLS = "id, teslimat_id, storage_path, taken_at, latitude, longitude";

function cevir(r: Record<string, unknown>, fotolar: TeslimatFoto[]): Teslimat {
  return {
    id: String(r.id),
    seferId: String(r.sefer_id),
    durakNo: Number(r.durak_no ?? 1),
    durakId: r.durak_id ? String(r.durak_id) : null,
    workerId: String(r.worker_id),
    zoneId: r.zone_id ? String(r.zone_id) : null,
    aliciAd: r.alici_ad ? String(r.alici_ad) : null,
    notlar: r.notlar ? String(r.notlar) : null,
    imzaSvg: r.imza_svg ? String(r.imza_svg) : null,
    imzaYol: r.imza_yol ? String(r.imza_yol) : null,
    teslimAt: String(r.teslim_at),
    latitude: r.latitude == null ? null : Number(r.latitude),
    longitude: r.longitude == null ? null : Number(r.longitude),
    dogrulukM: r.konum_dogruluk_m == null ? null : Number(r.konum_dogruluk_m),
    iptalAt: r.iptal_at ? String(r.iptal_at) : null,
    iptalSebep: r.iptal_sebep ? String(r.iptal_sebep) : null,
    fotograflar: fotolar,
  };
}

export type YazmaSonuc =
  | { ok: true; id: string }
  | { ok: false; sebep: "tablo_yok" | "durak_dolu" | "kanit_yok" | "hata"; mesaj?: string };

/** PostgREST tekil kısıt ihlali. */
function cakismaMi(e: { code?: string | null }): boolean {
  return (e.code ?? "") === "23505";
}

/**
 * Kanıt kaydı açar.
 *
 * ⚠️ EN AZ BİR KANIT ŞART. İmzasız, fotoğrafsız, notsuz bir "teslimat" kaydı
 * hiçbir şeyi kanıtlamaz; yalnız zaman/konum damgası taşıyan boş bir satır
 * olurdu ve anlaşmazlıkta işe yaramazdı. Fotoğraf AYRI tabloda olduğu için bu
 * kural şemada CHECK ile ifade edilemiyor — burada duruyor.
 *
 * ⚠️ `teslim_at` GÖNDERİLMİYOR: veritabanının `now()` varsayılanı yazıyor.
 * İstemciden gelen bir zaman damgası, telefonun saati kadar güvenilirdir.
 */
export async function createTeslimat(
  g: TeslimatGirdi,
  fotoVarMi: boolean
): Promise<YazmaSonuc> {
  const imza = g.imzaSvg?.trim() || null;
  const not = g.notlar?.trim() || null;
  const alici = g.aliciAd?.trim() || null;
  if (!imza && !fotoVarMi && !not && !alici) {
    return { ok: false, sebep: "kanit_yok" };
  }

  const { data, error } = await supabaseAdmin
    .from("teslimatlar")
    .insert({
      sefer_id: g.seferId,
      durak_no: g.durakNo ?? 1,
      // ⚠️ Yalnız DOLUYSA gönderiliyor: 082 uygulanmamış kurulumda `durak_id`
      // kolonu yoktur ve null göndermek insert'i 42703 ile düşürürdü.
      ...(g.durakId ? { durak_id: g.durakId } : {}),
      worker_id: g.workerId,
      zone_id: g.zoneId ?? null,
      alici_ad: alici,
      notlar: not,
      imza_svg: imza,
      latitude: g.latitude ?? null,
      longitude: g.longitude ?? null,
      konum_dogruluk_m: g.dogrulukM ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      sebep: error && tabloYokMu(error)
        ? "tablo_yok"
        : error && cakismaMi(error)
          ? "durak_dolu"
          : "hata",
      mesaj: error?.message,
    };
  }
  return { ok: true, id: String((data as { id: string }).id) };
}

/** Kanıta fotoğraf bağlar. Yükleme çağıranda (lib/storage.ts uploadReceipt). */
export async function addTeslimatFoto(
  teslimatId: string,
  storagePath: string,
  konum: { latitude?: number | null; longitude?: number | null; dogrulukM?: number | null }
): Promise<YazmaSonuc> {
  const { data, error } = await supabaseAdmin
    .from("teslimat_fotograflari")
    .insert({
      teslimat_id: teslimatId,
      storage_path: storagePath,
      latitude: konum.latitude ?? null,
      longitude: konum.longitude ?? null,
      konum_dogruluk_m: konum.dogrulukM ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, sebep: error && tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error?.message };
  }
  return { ok: true, id: String((data as { id: string }).id) };
}

/**
 * Seferin kanıtları — yönetici ve şoför ekranlarının ortak okuması.
 *
 * İki sorgu, tek `in()`: N teslimat için N fotoğraf sorgusu atmak (N+1) aynı
 * ekranı onlarca gidiş-dönüşe böler.
 */
export async function listTeslimatBySefer(
  seferId: string
): Promise<{ teslimatlar: Teslimat[]; tabloYok: boolean }> {
  const oku = (cols: string) =>
    supabaseAdmin.from("teslimatlar").select(cols).eq("sefer_id", seferId).order("durak_no");

  let { data, error } = await oku(COLS);
  if (error && kolonYokMu(error)) ({ data, error } = await oku(durakKolonuYok()));
  if (error) return { teslimatlar: [], tabloYok: tabloYokMu(error) };

  const satirlar = (data ?? []) as unknown as Record<string, unknown>[];
  if (satirlar.length === 0) return { teslimatlar: [], tabloYok: false };

  const idler = satirlar.map((r) => String(r.id));
  const { data: fotoData } = await supabaseAdmin
    .from("teslimat_fotograflari")
    .select(FOTO_COLS)
    .in("teslimat_id", idler)
    .order("taken_at");

  const fotoMap = new Map<string, TeslimatFoto[]>();
  for (const f of (fotoData ?? []) as Record<string, unknown>[]) {
    const k = String(f.teslimat_id);
    const arr = fotoMap.get(k) ?? [];
    arr.push({
      id: String(f.id),
      storagePath: String(f.storage_path),
      takenAt: String(f.taken_at),
      latitude: f.latitude == null ? null : Number(f.latitude),
      longitude: f.longitude == null ? null : Number(f.longitude),
    });
    fotoMap.set(k, arr);
  }

  return {
    teslimatlar: satirlar.map((r) => cevir(r, fotoMap.get(String(r.id)) ?? [])),
    tabloYok: false,
  };
}

/** Tek kanıt — sahiplik denetimi için (çağıran karşılaştırır). */
export async function getTeslimat(id: string): Promise<Teslimat | null> {
  const oku = (cols: string) =>
    supabaseAdmin.from("teslimatlar").select(cols).eq("id", id).maybeSingle();

  let { data, error } = await oku(COLS);
  if (error && kolonYokMu(error)) ({ data, error } = await oku(durakKolonuYok()));
  if (error || !data) return null;
  const { data: fotoData } = await supabaseAdmin
    .from("teslimat_fotograflari")
    .select(FOTO_COLS)
    .eq("teslimat_id", id)
    .order("taken_at");
  const fotolar = ((fotoData ?? []) as Record<string, unknown>[]).map((f) => ({
    id: String(f.id),
    storagePath: String(f.storage_path),
    takenAt: String(f.taken_at),
    latitude: f.latitude == null ? null : Number(f.latitude),
    longitude: f.longitude == null ? null : Number(f.longitude),
  }));
  return cevir(data as unknown as Record<string, unknown>, fotolar);
}

/**
 * Kanıtı GEÇERSİZ İLAN ET — silme değil.
 *
 * Silmek delili yok etmektir; iptal, "bu kanıt geçersiz ve sebebi şu" demektir
 * ve kaydın kendisi yerinde kalır. Veritabanı da yalnız bu üç alanın
 * değişmesine izin veriyor (080 tetikleyicisi).
 *
 * İdempotent: zaten iptalliyse damga TAZELENMEZ.
 */
export async function iptalTeslimat(
  id: string,
  sebep: string,
  actorWorkerId: string | null
): Promise<YazmaSonuc> {
  const temiz = sebep.trim();
  if (temiz.length < 3) return { ok: false, sebep: "hata", mesaj: "sebep_kisa" };
  const { data, error } = await supabaseAdmin
    .from("teslimatlar")
    .update({
      iptal_at: new Date().toISOString(),
      iptal_sebep: temiz.slice(0, 300),
      iptal_eden: actorWorkerId,
    })
    .eq("id", id)
    .is("iptal_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error.message };
  }
  return { ok: true, id: data ? String((data as { id: string }).id) : id };
}
