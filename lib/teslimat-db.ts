import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu, kolonYokMu } from "@/lib/fault-reports";
import { signedReceiptUrls } from "@/lib/storage";

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

/** Teslimatın sonucu (109). Panel yolu bunu GÖNDERMEZ → DB varsayılanı 'teslim'. */
export const TESLIMAT_SONUCLARI = ["teslim", "teslim_edilemedi"] as const;
export type TeslimatSonuc = (typeof TESLIMAT_SONUCLARI)[number];

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
  /** İmza, RASTER yedek yolu (Storage). `imzaSvg` ile BİRLİKTE gönderilemez. */
  imzaYol?: string | null;
  /**
   * SONUÇ (109) — VERİLMEZSE KOLON HİÇ GÖNDERİLMEZ.
   *
   * `durakId`in desenini izliyor: 109 uygulanmamış bir kurulumda `sonuc`
   * kolonu yoktur ve onu göndermek insert'i 42703 ile düşürürdü. Panelin
   * bugünkü akışı sonucu bilmiyor (yalnız başarılı teslimatı tanıyor) ve
   * göndermiyor — orada DB varsayılanı 'teslim' yazar.
   */
  sonuc?: TeslimatSonuc;
  /** Teslim EDİLEMEDİYSE sebebi. `sonuc` verilmeden gönderilemez. */
  sebep?: string | null;
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
  /**
   * 109 uygulanmamış kurulumda `null` — "ölçülmedi" demek, "teslim edildi"
   * DEĞİL. Varsayılanı burada uydurmak, kaydedilmemiş bir sonucu kaydedilmiş
   * gibi göstermek olurdu.
   */
  sonuc: TeslimatSonuc | null;
  sebep: string | null;
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
 * ⚠️ KOLON KADEMELERİ — 082/109 UYGULANMAMIŞ KURULUMLAR İÇİN.
 *
 * `durak_id` 082, `sonuc`/`sebep` 109 ile geliyor. Kolonları koşulsuz seçmek,
 * o migration'ı çalıştırmamış bir kiracıda TÜM ePOD okumasını 42703 ile
 * düşürürdü — yani 080 ile gelen çalışan bir özelliği yeni bir migration'a
 * rehin almak. Okuma en dolu listeyle başlar, kolon yoksa bir alt kademeye
 * düşer ve HANGİSİNİN eksik olduğu bir kez loglanır. Sessiz düşüş yok,
 * kırılma da yok.
 *
 * ⚠️ KADEME SIRASI KEYFİ DEĞİL: 109'un taslak tablosu `sefer_duraklari`ya
 * yabancı anahtarla bağlı, yani 109 çalıştıysa 082 de çalışmıştır. Bu yüzden
 * "durak_id yok ama sonuc var" kademesi YOKTUR — olamaz.
 */
const TABAN_COLS =
  "id, sefer_id, durak_no, worker_id, zone_id, alici_ad, notlar, imza_svg, imza_yol, teslim_at, latitude, longitude, konum_dogruluk_m, iptal_at, iptal_sebep";

const KOLON_KADEMELERI: { cols: string; eksik: string }[] = [
  { cols: `${TABAN_COLS}, durak_id, sonuc, sebep`, eksik: "" },
  { cols: `${TABAN_COLS}, durak_id`, eksik: "`sonuc`/`sebep` yok — migration 109 uygulanmamış. Teslimat sonucu OKUNAMIYOR." },
  { cols: TABAN_COLS, eksik: "`durak_id` yok — migration 082 uygulanmamış. Çok duraklı bağ KAPALI." },
];

const uyarilan = new Set<number>();

/**
 * Kademeli okuma: ilk kademeden başlar, `kolonYokMu` gördükçe iner.
 * Çağıranların hepsi aynı merdiveni kullansın diye tek yerde.
 */
async function kademeliOku<T>(
  calistir: (cols: string) => PromiseLike<{ data: T | null; error: { code?: string | null; message?: string | null } | null }>
): Promise<{ data: T | null; error: { code?: string | null; message?: string | null } | null }> {
  let son: Awaited<ReturnType<typeof calistir>> = { data: null, error: null };
  for (let i = 0; i < KOLON_KADEMELERI.length; i++) {
    son = await calistir(KOLON_KADEMELERI[i].cols);
    if (!son.error || !kolonYokMu(son.error)) return son;
    const sonraki = KOLON_KADEMELERI[i + 1];
    if (!sonraki) return son;
    if (!uyarilan.has(i + 1)) {
      uyarilan.add(i + 1);
      console.warn(`[teslimat-db] ${sonraki.eksik}`);
    }
  }
  return son;
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
    sonuc: r.sonuc === "teslim" || r.sonuc === "teslim_edilemedi" ? r.sonuc : null,
    sebep: r.sebep ? String(r.sebep) : null,
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
  | {
      ok: false;
      sebep: "tablo_yok" | "kolon_yok" | "durak_dolu" | "kanit_yok" | "hata";
      mesaj?: string;
    };

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
  const imzaYol = g.imzaYol?.trim() || null;
  const not = g.notlar?.trim() || null;
  const alici = g.aliciAd?.trim() || null;
  const sebep = g.sebep?.trim() || null;

  /**
   * ⚠️ BAŞARISIZ TESLİMATIN KANITI SEBEBİDİR (109).
   *
   * "En az bir kanıt" kuralı 080'den beri imza/fotoğraf/not/alıcı arıyordu ve
   * o kural YALNIZ başarılı teslimat için yazılmıştı. Teslim EDİLEMEDİYSE
   * imza alınacak kimse, çekilecek teslim fotoğrafı yoktur; kaydın taşıdığı
   * bilgi sebebin kendisidir — ve o zaten zorunlu (şemada `teslimat_sebep_butun`).
   * Sebebi kanıt saymasaydık, meşru bir "teslim edilemedi" kaydı `kanit_yok`
   * ile reddedilirdi.
   */
  const basarisiz = g.sonuc === "teslim_edilemedi";
  if (!imza && !imzaYol && !fotoVarMi && !not && !alici && !(basarisiz && sebep)) {
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
      /**
       * ⚠️ AYNI DESEN, 109 İÇİN: `sonuc` verilmediyse kolon HİÇ gönderilmez ve
       * 109 uygulanmamış kurulumda panelin yolu kırılmadan çalışmayı sürdürür
       * (orada DB varsayılanı 'teslim' yazar). Verildiyse gönderilir ve kolon
       * yoksa 42703 döner — SESSİZCE 'teslim'e düşmez: "teslim edilemedi"yi
       * sessizce "teslim edildi" diye kaydetmek, kanıdın kendisini tersine
       * çevirmek olurdu.
       */
      ...(g.sonuc ? { sonuc: g.sonuc, sebep: basarisiz ? sebep : null } : {}),
      worker_id: g.workerId,
      zone_id: g.zoneId ?? null,
      alici_ad: alici,
      notlar: not,
      imza_svg: imza,
      imza_yol: imzaYol,
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
        : error && kolonYokMu(error)
          ? "kolon_yok"
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
  const { data, error } = await kademeliOku((cols) =>
    supabaseAdmin.from("teslimatlar").select(cols).eq("sefer_id", seferId).order("durak_no")
  );
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
  const { data, error } = await kademeliOku((cols) =>
    supabaseAdmin.from("teslimatlar").select(cols).eq("id", id).maybeSingle()
  );
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

/**
 * Bir SEFERİN BELİRLİ DURAĞINDAKİ geçerli kanıt.
 *
 * Mobil fotoğraf ucu (`/sefer/[id]/duraklar/[durakId]/foto`) durak ekseninde
 * çalışıyor: şoför durakta duruyor, teslimat kimliğini bilmiyor. Bu fonksiyon
 * o çeviriyi yapar.
 *
 * `durak_id` ARANIR, `durak_no` DEĞİL: sıra değişebilir, kalıcı bağ id'dir
 * (dosya başındaki nota bakın). İPTAL EDİLMİŞ kanıt DÖNMEZ — iptal edilmiş bir
 * kanıta fotoğraf eklemek, geçersiz ilan edilmiş bir delili beslemek olurdu.
 *
 * Aynı durakta birden fazla geçerli kanıt olursa EN YENİSİ döner; şema bunu
 * yasaklamıyor ve "hangisi" sorusunun tek makul cevabı sonuncusudur.
 */
export async function getTeslimatByDurak(
  seferId: string,
  durakId: string
): Promise<{ teslimat: Teslimat | null; tabloYok: boolean; kolonYok: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("teslimatlar")
    .select("id")
    .eq("sefer_id", seferId)
    .eq("durak_id", durakId)
    .is("iptal_at", null)
    .order("teslim_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // 082 uygulanmamış kurulumda `durak_id` yok — durak ekseni HİÇ çalışmaz.
    // Bunu "kanıt yok" ile karıştırmamak gerekiyor: biri veri, öteki kurulum.
    if (kolonYokMu(error)) return { teslimat: null, tabloYok: false, kolonYok: true };
    return { teslimat: null, tabloYok: tabloYokMu(error), kolonYok: false };
  }
  if (!data) return { teslimat: null, tabloYok: false, kolonYok: false };
  return {
    teslimat: await getTeslimat(String((data as { id: string }).id)),
    tabloYok: false,
    kolonYok: false,
  };
}

// ── OKUMA GÖRÜNÜMÜ — PANEL VE MOBİL TEK YERDEN İMZALAR ─────────────────────

export type KanitFotoGorunum = TeslimatFoto & { url: string | null };
export type KanitGorunum = Omit<Teslimat, "fotograflar"> & {
  fotograflar: KanitFotoGorunum[];
  /** İmza RASTER ise onun kısa ömürlü URL'i; vektör imzada (imza_svg) null. */
  imzaUrl: string | null;
};

/**
 * Kanıt satırlarını GÖRÜNÜME çevirir: özel kovadaki her yol kısa ömürlü imzalı
 * URL olur.
 *
 * ⚠️ BU FONKSİYON İKİ YÜZEYİN ORTAK OKUMASIDIR — panel sunucu eylemi
 * (`app/actions/teslimat.ts`) ve mobil GET ucu aynı gövdeyi üretir. Eskiden
 * imzalama panelin action dosyasında ÖZEL bir yardımcıydı; mobil uç eklenirken
 * kopyalansaydı iki yüzey aynı kanıta farklı alanlarla bakardı ve TTL'i biri
 * değiştirdiğinde diğeri geride kalırdı. `lib/is-emri-db.ts`in kuralı burada
 * da geçerli: kural çekirdekte, yüzeyler çağırır.
 *
 * ⚠️ İMZA DA İMZALANIYOR (109): `imza_yol` 080'de RASTER YEDEK olarak
 * tanımlanmıştı ama bugüne dek ne yazılıyor ne okunuyordu (ölçüldü 21.09.2026).
 * Mobil "kanıt bırak" ucu PNG imza kabul ettiği an o yol dolmaya başlıyor ve
 * imzalanmadan gösterilemez — özel kova.
 *
 * Tek turda imzalanıyor: N kanıt × M fotoğraf için tek Storage isteği
 * (`signedReceiptUrls`), satır başına gidiş-dönüş değil.
 */
export async function imzaliKanitlar(teslimatlar: Teslimat[]): Promise<KanitGorunum[]> {
  const yollar = [
    ...teslimatlar.flatMap((t) => t.fotograflar.map((f) => f.storagePath)),
    ...teslimatlar.map((t) => t.imzaYol).filter((y): y is string => Boolean(y)),
  ];
  const harita = yollar.length
    ? await signedReceiptUrls(TESLIMAT_KOVASI, yollar)
    : new Map<string, string>();
  return teslimatlar.map((t) => ({
    ...t,
    fotograflar: t.fotograflar.map((f) => ({ ...f, url: harita.get(f.storagePath) ?? null })),
    imzaUrl: t.imzaYol ? (harita.get(t.imzaYol) ?? null) : null,
  }));
}

// ── KANIT TASLAĞI (109) ────────────────────────────────────────────────────

/**
 * TASLAK = kanıt AÇILMADAN önce yüklenmiş dosya. DELİL DEĞİLDİR.
 *
 * ═══ NEDEN VAR ═══
 *
 * Panelin akışı "önce kanıt kaydı, sonra fotoğraflar"; telefonunki TERSİ —
 * şoför kapıda önce fotoğrafı çeker, "teslim ettim" düğmesine bastığı an işin
 * SONUDUR. Panelin sırasını telefona dayatmak, fotoğraf yüklenmeden yarım bir
 * delil kaydı açmak demekti.
 *
 * ⚠️ Taslak DEĞİŞEBİLİR ve SİLİNEBİLİR; kanıt (`teslimatlar`,
 * `teslimat_fotograflari`) değişemez ve silinemez (080 HK080 tetikleyicileri).
 * Bağlama anında satır kanıt tablosuna INSERT edilir — kanıt tarafında tek bir
 * UPDATE yolu AÇILMADI. Migration 109 başlığı bu üç yolun neden (a) ve (b)
 * değil (c) olduğunu ölçümle anlatıyor.
 */
export const TASLAK_TABLO = "teslimat_taslak_dosyalari";
export type TaslakTur = "foto" | "imza";

export type TaslakDosya = {
  id: string;
  seferId: string;
  durakId: string;
  workerId: string;
  tur: TaslakTur;
  storagePath: string;
  takenAt: string;
  latitude: number | null;
  longitude: number | null;
  dogrulukM: number | null;
};

const TASLAK_COLS =
  "id, sefer_id, durak_id, worker_id, tur, storage_path, taken_at, latitude, longitude, konum_dogruluk_m";

function taslakCevir(r: Record<string, unknown>): TaslakDosya {
  return {
    id: String(r.id),
    seferId: String(r.sefer_id),
    durakId: String(r.durak_id),
    workerId: String(r.worker_id),
    tur: r.tur === "imza" ? "imza" : "foto",
    storagePath: String(r.storage_path),
    takenAt: String(r.taken_at),
    latitude: r.latitude == null ? null : Number(r.latitude),
    longitude: r.longitude == null ? null : Number(r.longitude),
    dogrulukM: r.konum_dogruluk_m == null ? null : Number(r.konum_dogruluk_m),
  };
}

/** Taslak satırı açar. Dosya yüklemesi çağıranda (`yukleVeYaz`). */
export async function createTaslak(
  g: {
    seferId: string;
    durakId: string;
    workerId: string;
    tur: TaslakTur;
    storagePath: string;
  },
  konum: { latitude?: number | null; longitude?: number | null; dogrulukM?: number | null }
): Promise<YazmaSonuc> {
  const { data, error } = await supabaseAdmin
    .from(TASLAK_TABLO)
    .insert({
      sefer_id: g.seferId,
      durak_id: g.durakId,
      worker_id: g.workerId,
      tur: g.tur,
      storage_path: g.storagePath,
      latitude: konum.latitude ?? null,
      longitude: konum.longitude ?? null,
      konum_dogruluk_m: konum.dogrulukM ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      sebep: error && tabloYokMu(error) ? "tablo_yok" : "hata",
      mesaj: error?.message,
    };
  }
  return { ok: true, id: String((data as { id: string }).id) };
}

/**
 * Kimliği verilen taslakları getirir — AMA yalnız SAHİBİNİN ve YALNIZ O DURAĞIN.
 *
 * ⚠️ Süzgeç sorguda, çağıranda değil: "sonra kontrol ederim" diye alınan bir
 * satır, unutulan bir `if` ile başkasının dosyasını kanıta bağlardı. Sorgu
 * eşleşmeyeni HİÇ GETİRMEZ, çağıran da sayıyı karşılaştırır (bkz. `tamamMi`).
 */
export async function getTaslaklar(
  ids: string[],
  sahip: { durakId: string; workerId: string }
): Promise<{ taslaklar: TaslakDosya[]; tabloYok: boolean; tamamMi: boolean }> {
  const benzersiz = [...new Set(ids.filter(Boolean))];
  if (benzersiz.length === 0) return { taslaklar: [], tabloYok: false, tamamMi: true };

  const { data, error } = await supabaseAdmin
    .from(TASLAK_TABLO)
    .select(TASLAK_COLS)
    .in("id", benzersiz)
    .eq("durak_id", sahip.durakId)
    .eq("worker_id", sahip.workerId)
    .order("taken_at");

  if (error) return { taslaklar: [], tabloYok: tabloYokMu(error), tamamMi: false };
  const taslaklar = ((data ?? []) as Record<string, unknown>[]).map(taslakCevir);
  return { taslaklar, tabloYok: false, tamamMi: taslaklar.length === benzersiz.length };
}

/**
 * Bağlanan taslak satırlarını siler.
 *
 * ⚠️ DOSYA SİLİNMEZ — yol artık `teslimat_fotograflari` (ya da
 * `teslimatlar.imza_yol`) tarafından tutuluyor. Dosyayı silmek delili silmek
 * olurdu.
 *
 * Düşerse kanıt YİNE DE geçerlidir: geride kalan taslak satırı zararsızdır,
 * çünkü aynı dosyanın ikinci kez kanıta bağlanmasını `teslimat_foto_yol_uq`
 * (080) 23505 ile zaten reddeder. Bu yüzden sonuç DÖNER ama çağıranı
 * düşürmez — yanıtta görünür, yutulmaz.
 */
export async function deleteTaslaklar(ids: string[]): Promise<{ ok: boolean; silinen: number }> {
  const benzersiz = [...new Set(ids.filter(Boolean))];
  if (benzersiz.length === 0) return { ok: true, silinen: 0 };
  const { data, error } = await supabaseAdmin
    .from(TASLAK_TABLO)
    .delete()
    .in("id", benzersiz)
    .select("id");
  if (error) return { ok: false, silinen: 0 };
  return { ok: true, silinen: (data ?? []).length };
}

/**
 * Bir durakta BEKLEYEN (henüz kanıta bağlanmamış) taslaklar — yalnız sahibinin.
 *
 * ⚠️ `workerId` ZORUNLU PARAMETRE, isteğe bağlı bir süzgeç değil: yöneticinin
 * şoförün yarım kalmış yüklemesini görmesi, bitmemiş bir işi delil sanmasına
 * yol açardı. Taslak sahibine aittir; kanıt herkese.
 */
export async function listTaslakByDurak(
  durakId: string,
  workerId: string
): Promise<{ taslaklar: TaslakDosya[]; tabloYok: boolean }> {
  const { data, error } = await supabaseAdmin
    .from(TASLAK_TABLO)
    .select(TASLAK_COLS)
    .eq("durak_id", durakId)
    .eq("worker_id", workerId)
    .order("taken_at");
  if (error) return { taslaklar: [], tabloYok: tabloYokMu(error) };
  return {
    taslaklar: ((data ?? []) as Record<string, unknown>[]).map(taslakCevir),
    tabloYok: false,
  };
}
