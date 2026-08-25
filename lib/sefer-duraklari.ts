import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu } from "@/lib/fault-reports";
import { kullanimdaMi, type SilmeSonucu } from "@/lib/silme-sonucu";

/**
 * SEFER DURAKLARI — veri katmanı (migration 082).
 *
 * ═══ TEK CÜMLELİK KURAL ═══
 *
 * **Durak listesi varsa duraklar konuşur; yoksa eski tek hedef.**
 * `seferler.zone_id` düşürülmedi ama artık hiçbir yüzey onu doğrudan
 * okumuyor — hedef çözümü YALNIZ buradaki `seferHedefi()` üzerinden yapılıyor.
 * İki gerçek doğmasın diye çözüm tek fonksiyonda.
 *
 * ═══ KAPI BURADA YOK ═══
 *
 * Çağıran yetkiyi KENDİ denetler: yönetici/şef kapsamındaki seferin durağını
 * yazar, şoför YALNIZ kendi seferinin durağını ilerletir. lib/sefer-db.ts ve
 * lib/teslimat-db.ts ile aynı kural.
 *
 * ═══ 082 YOKSA ÖZELLİK KAPALI, EKRAN ÇALIŞIR ═══
 *
 * Her okuma `tabloYok` döndürüyor. Migration uygulanmamış kurulumda sefer eski
 * TEK hedefli davranışını sürdürür ve ekran "bu kurulumda kapalı" der —
 * 056/058/077/078/079/080'in kademeli düşüş deseni.
 */

export const DURAK_DURUMLARI = ["bekliyor", "varildi", "tamamlandi", "atlandi"] as const;
export type DurakDurum = (typeof DURAK_DURUMLARI)[number];

/** İş HÂLÂ süren duraklar — "sıradaki durak" bunlardan seçilir. */
export const DURAK_ACIK: DurakDurum[] = ["bekliyor", "varildi"];

/**
 * DURUM ÇİZGİSİ — ileri yönlü, tek kaynak.
 *
 * bekliyor → varildi → tamamlandi
 * bekliyor | varildi → atlandi (SEBEBİYLE)
 *
 * ⚠️ `bekliyor → tamamlandi` DE MEŞRU: şoför durakta "vardım" demeden işi
 * bitirip "tamam"a basabilir. O zaman `varildi_at` BOŞ kalır ve bu doğrudur —
 * varışı gözlemlemedik. Damgayı uydurmak, ölçülmemiş bir anı ölçülmüş gibi
 * göstermek olurdu.
 *
 * ⚠️ GERİ DÖNÜŞ YOK. Atlanan durağa yeniden gidilirse YENİ BİR DURAK açılır —
 * 080'in "yeniden teslim denemesi YENİ BİR DURAK numarasıdır" kuralının aynısı.
 * Yanlış basılan bir düğmenin düzeltme yolu YÖNETİCİDEDİR (`durumSifirla`),
 * şoförde değil: kendi damgasını silebilen bir kayıt kanıt olmaktan çıkar.
 */
const GECERLI_GECIS: Record<DurakDurum, DurakDurum[]> = {
  bekliyor: ["varildi", "tamamlandi", "atlandi"],
  varildi: ["tamamlandi", "atlandi"],
  tamamlandi: [],
  atlandi: [],
};

/** Her geçişin kendi damgası — geçiş onu yazar, başkasını değil (066 deseni). */
const DAMGA: Record<DurakDurum, string | null> = {
  bekliyor: null,
  varildi: "varildi_at",
  tamamlandi: "tamamlandi_at",
  atlandi: "atlandi_at",
};

export type DurakRow = {
  id: string;
  sefer_id: string;
  sira: number;
  ad: string;
  zone_id: string | null;
  adres: string | null;
  latitude: number | null;
  longitude: number | null;
  yaricap_m: number;
  pencere_bas: string | null;
  pencere_bit: string | null;
  tahmini_sure_dk: number | null;
  notlar: string | null;
  durum: DurakDurum;
  atlama_sebep: string | null;
  varildi_at: string | null;
  tamamlandi_at: string | null;
  atlandi_at: string | null;
  varis_kaynak: "sofor" | "otomatik" | null;
  created_at: string;
};

const COLS =
  "id, sefer_id, sira, ad, zone_id, adres, latitude, longitude, yaricap_m, pencere_bas, pencere_bit, " +
  "tahmini_sure_dk, notlar, durum, atlama_sebep, varildi_at, tamamlandi_at, atlandi_at, varis_kaynak, created_at";

// ══════════════════════════════════════════════════════════════════════════
// OKUMA
// ══════════════════════════════════════════════════════════════════════════

export async function listDuraklar(
  seferId: string
): Promise<{ duraklar: DurakRow[]; tabloYok: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("sefer_duraklari")
    .select(COLS)
    .eq("sefer_id", seferId)
    .order("sira");
  if (error) return { duraklar: [], tabloYok: tabloYokMu(error) };
  return { duraklar: (data ?? []) as unknown as DurakRow[], tabloYok: false };
}

/**
 * ÇOK SEFERİN DURAKLARI — TEK SORGU.
 *
 * Liste ekranları sefer başına bir sorgu atarsa 30 seferlik bir gün 30 gidiş
 * dönüş demek (N+1). Sefer kimlikleriyle anahtarlı tek `in()` yeterli.
 *
 * ⚠️ PostgREST 1000 SATIR TAVANI: 30 sefer × 80 durak = 2400 satır tavanı
 * SESSİZCE keserdi. `.range()` ile sayfalanıyor ve eksik kalırsa YÜKSEK SESLE
 * loglanıyor — bu depoda sessiz kırpma daha önce canlı hataya yol açtı.
 */
export async function listDuraklarBatch(
  seferIds: string[]
): Promise<{ harita: Map<string, DurakRow[]>; tabloYok: boolean }> {
  const harita = new Map<string, DurakRow[]>();
  if (seferIds.length === 0) return { harita, tabloYok: false };

  const SAYFA = 1000;
  let baslangic = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from("sefer_duraklari")
      .select(COLS)
      .in("sefer_id", seferIds)
      .order("sefer_id")
      .order("sira")
      .range(baslangic, baslangic + SAYFA - 1);
    if (error) return { harita: new Map(), tabloYok: tabloYokMu(error) };
    const satirlar = (data ?? []) as unknown as DurakRow[];
    for (const d of satirlar) {
      const liste = harita.get(d.sefer_id);
      if (liste) liste.push(d);
      else harita.set(d.sefer_id, [d]);
    }
    if (satirlar.length < SAYFA) break;
    baslangic += SAYFA;
    if (baslangic >= 20_000) {
      console.error(
        `[sefer-duraklari] ⚠️ toplu okuma 20.000 satırda durduruldu (${seferIds.length} sefer) — liste EKSİK olabilir.`
      );
      break;
    }
  }
  return { harita, tabloYok: false };
}

export async function getDurak(id: string): Promise<DurakRow | null> {
  const { data, error } = await supabaseAdmin
    .from("sefer_duraklari")
    .select(COLS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as DurakRow;
}

// ══════════════════════════════════════════════════════════════════════════
// TÜRETME — ilerleme ve hedef
// ══════════════════════════════════════════════════════════════════════════

export type DurakOzeti = {
  toplam: number;
  bekleyen: number;
  varilan: number;
  tamamlanan: number;
  atlanan: number;
  /** Kapanmış (tamamlandi + atlandi) — "12 duraktan 7'si bitti"nin paydası. */
  biten: number;
  /** Sıradaki durak — açık duraklardan sırası EN KÜÇÜK olan. */
  sonraki: DurakRow | null;
};

/**
 * İLERLEME — SAF HESAP, SORGU YOK.
 *
 * ⚠️ `biten` hem tamamlananı hem atlananı sayar: atlanan durak da KAPANMIŞTIR,
 * şoför oraya bir daha gitmeyecek. "7/12" derken 12'den düşmemiş bir durağın
 * hâlâ yapılacak iş olduğunu göstermek zorundayız; atlananı bekleyen saymak
 * günü hiç bitmeyen bir listeye çevirirdi. Sayı ayrıca AYRI da taşınıyor
 * (`atlanan`) — ekran "7 tamam · 2 atlandı · 3 bekliyor" diyebilsin.
 */
export function durakOzeti(duraklar: DurakRow[]): DurakOzeti {
  const say = (d: DurakDurum) => duraklar.filter((x) => x.durum === d).length;
  const acik = duraklar
    .filter((d) => DURAK_ACIK.includes(d.durum))
    .sort((a, b) => a.sira - b.sira);
  const tamamlanan = say("tamamlandi");
  const atlanan = say("atlandi");
  return {
    toplam: duraklar.length,
    bekleyen: say("bekliyor"),
    varilan: say("varildi"),
    tamamlanan,
    atlanan,
    biten: tamamlanan + atlanan,
    sonraki: acik[0] ?? null,
  };
}

/** Bir durağın ÇÖZÜLMÜŞ hedefi — bölge geometrisi ya da serbest koordinat. */
export type DurakHedefi = {
  lat: number;
  lng: number;
  yaricapM: number;
  /** Geometri nereden geldi: kayıtlı bölge mi, durağın kendi koordinatı mı. */
  kaynak: "bolge" | "koordinat";
};

/**
 * DURAKLARIN HEDEF GEOMETRİSİ — bölgeler TEK sorguda.
 *
 * `zone_id` dolu duraklar bölgenin merkez/yarıçapını kullanır (durağın kendi
 * `yaricap_m`si YOK SAYILIR — bölgenin yarıçapı zaten o bölgenin kuralıdır ve
 * ziyaret motoru da onu kullanıyor; ikinci bir yarıçap iki farklı "varış"
 * tanımı doğururdu).
 */
export async function durakHedefleri(
  duraklar: DurakRow[]
): Promise<Map<string, DurakHedefi>> {
  const out = new Map<string, DurakHedefi>();
  const zoneIds = [...new Set(duraklar.map((d) => d.zone_id).filter(Boolean))] as string[];

  const bolge = new Map<string, { lat: number; lng: number; r: number }>();
  if (zoneIds.length > 0) {
    const { data } = await supabaseAdmin
      .from("geofences")
      .select("id, center_lat, center_lng, radius_m")
      .in("id", zoneIds);
    for (const z of (data ?? []) as {
      id: string;
      center_lat: number;
      center_lng: number;
      radius_m: number;
    }[]) {
      bolge.set(z.id, { lat: Number(z.center_lat), lng: Number(z.center_lng), r: Number(z.radius_m) });
    }
  }

  for (const d of duraklar) {
    if (d.zone_id) {
      const z = bolge.get(d.zone_id);
      if (z) {
        out.set(d.id, { lat: z.lat, lng: z.lng, yaricapM: z.r, kaynak: "bolge" });
        continue;
      }
      // Bölge silinmiş: durak yaşar ama hedefi yoktur. Koordinatına düşmüyoruz
      // çünkü zone_id'li durakta koordinat zaten yazılmaz.
    }
    if (d.latitude !== null && d.longitude !== null) {
      out.set(d.id, {
        lat: Number(d.latitude),
        lng: Number(d.longitude),
        yaricapM: d.yaricap_m,
        kaynak: "koordinat",
      });
    }
  }
  return out;
}

/**
 * SEFERİN GÜNCEL HEDEFİ — takip linki ve ETA'nın TEK kaynağı.
 *
 * Sıra: sıradaki AÇIK durak → yoksa SON durak → yoksa eski `seferler.zone_id`.
 *
 * ── NEDEN "SIRADAKİ", "İLK" DEĞİL ─────────────────────────────────────────
 * Müşteri takip sayfası aracın ŞU AN nereye gittiğini gösterir. Bitmiş bir
 * durağı hedef göstermek, aracı çoktan geçtiği bir noktaya yaklaşıyormuş gibi
 * gösterirdi.
 *
 * ⚠️ BİLİNEN SINIR (kayda geçiyor): takip linki SEFERE bağlı, durağa değil
 * (migration 079). Çok duraklı bir seferde müşteri, kendi durağının değil
 * ARACIN SIRADAKİ durağının ETA'sını görür. Onfleet/Track-POD linkleri göreve
 * (=durağa) bağlıdır; bu farkı kapatmak 079'a `durak_id` eklemeyi gerektirir
 * ve bu turun kapsamında DEĞİL. Bugünkü davranış yanlış değil, DAR: araç
 * yaklaştıkça sıradaki durak müşterininki olur.
 */
export async function seferHedefi(
  sefer: { id: string; zone_id: string | null },
  duraklar?: DurakRow[]
): Promise<(DurakHedefi & { ad: string | null; durakId: string | null }) | null> {
  const liste = duraklar ?? (await listDuraklar(sefer.id)).duraklar;

  if (liste.length > 0) {
    const ozet = durakOzeti(liste);
    const hedefDurak = ozet.sonraki ?? [...liste].sort((a, b) => b.sira - a.sira)[0];
    const geo = await durakHedefleri([hedefDurak]);
    const h = geo.get(hedefDurak.id);
    return h ? { ...h, ad: hedefDurak.ad, durakId: hedefDurak.id } : null;
  }

  // ── ESKİ TEK HEDEF (066). Durak listesi olmayan seferler için.
  if (!sefer.zone_id) return null;
  const { data } = await supabaseAdmin
    .from("geofences")
    .select("center_lat, center_lng, radius_m, name")
    .eq("id", sefer.zone_id)
    .maybeSingle();
  if (!data) return null;
  const z = data as { center_lat: number; center_lng: number; radius_m: number; name: string };
  return {
    lat: Number(z.center_lat),
    lng: Number(z.center_lng),
    yaricapM: Number(z.radius_m),
    kaynak: "bolge",
    ad: z.name,
    durakId: null,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// YAZMA
// ══════════════════════════════════════════════════════════════════════════

export type DurakGirdi = {
  ad: string;
  zoneId?: string | null;
  adres?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  yaricapM?: number | null;
  pencereBas?: string | null;
  pencereBit?: string | null;
  tahminiSureDk?: number | null;
  notlar?: string | null;
};

export type DurakYazmaSonuc =
  | { ok: true; durak: DurakRow }
  | { ok: false; sebep: "tablo_yok" | "sira_cakismasi" | "gecersiz" | "hata"; mesaj?: string };

const kirp = (s: string | null | undefined, n: number): string | null => {
  const t = (s ?? "").trim();
  return t ? t.slice(0, n) : null;
};

/**
 * Girdiyi satıra çevirir — İKİ BİÇİM BİRDEN OLAMAZ.
 *
 * `zoneId` verilmişse serbest hedef alanları (adres/koordinat) YAZILMAZ.
 * Samsara'nın Address ↔ singleUseLocation ayrımı: hangisinin gerçek hedef
 * olduğu belirsiz kalamaz. Bölge seçildiğinde adres kutusuna yazılmış bir metin
 * sessizce saklanırsa, bölge silindiği gün ortaya "hangisi doğruydu" sorusu
 * çıkar.
 */
function satiraCevir(g: DurakGirdi): Record<string, unknown> {
  const bolgeli = Boolean(g.zoneId);
  return {
    ad: (g.ad ?? "").trim().slice(0, 120),
    zone_id: g.zoneId ?? null,
    adres: bolgeli ? null : kirp(g.adres, 300),
    latitude: bolgeli ? null : (g.latitude ?? null),
    longitude: bolgeli ? null : (g.longitude ?? null),
    yaricap_m: bolgeli ? 150 : (g.yaricapM ?? 150),
    pencere_bas: g.pencereBas || null,
    pencere_bit: g.pencereBit || null,
    tahmini_sure_dk: g.tahminiSureDk ?? null,
    notlar: kirp(g.notlar, 500),
  };
}

/** PostgreSQL tekil kısıt ihlali (ertelenmiş kısıt COMMIT'te de bunu verir). */
const cakismaMi = (e: { code?: string | null }) => (e.code ?? "") === "23505";

/**
 * YENİ DURAK — sonuncunun ardına eklenir.
 *
 * ⚠️ SIRA UYGULAMADA HESAPLANIYOR (max+1), veritabanında değil. Bir dizi
 * (`sequence`) sefer başına olamaz; tetikleyici ise her eklemede tabloyu
 * kilitlerdi. Yarış penceresi kabul edildi: iki yönetici aynı anda aynı sefere
 * durak eklerse ikinci `23505` alır ve çağıran `sira_cakismasi` görür — ekran
 * bir kez yeniden dener. Gerçek kullanımda seferin duraklarını tek kişi kurar.
 */
export async function insertDurak(
  seferId: string,
  g: DurakGirdi
): Promise<DurakYazmaSonuc> {
  if (!(g.ad ?? "").trim()) return { ok: false, sebep: "gecersiz", mesaj: "ad" };

  const { data: sonuncu, error: eOku } = await supabaseAdmin
    .from("sefer_duraklari")
    .select("sira")
    .eq("sefer_id", seferId)
    .order("sira", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (eOku && tabloYokMu(eOku)) return { ok: false, sebep: "tablo_yok" };

  const sira = ((sonuncu as { sira: number } | null)?.sira ?? 0) + 1;
  if (sira > 999) return { ok: false, sebep: "gecersiz", mesaj: "durak_tavani" };

  const { data, error } = await supabaseAdmin
    .from("sefer_duraklari")
    .insert({ sefer_id: seferId, sira, ...satiraCevir(g) })
    .select(COLS)
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      sebep: error && tabloYokMu(error)
        ? "tablo_yok"
        : error && cakismaMi(error)
          ? "sira_cakismasi"
          : "hata",
      mesaj: error?.message,
    };
  }
  return { ok: true, durak: data as unknown as DurakRow };
}

/**
 * DURAK DÜZENLEME — plan alanları. DURUM BURADAN DEĞİŞMEZ.
 *
 * Durum çizgisini `ilerletDurak` (şoför) ve `durumSifirla` (yönetici düzeltmesi)
 * yürütür; ikisi de kendi kuralını taşıyor. Yamaya durum sızdırmak, geçiş
 * haritasını atlamanın yolu olurdu.
 */
export async function patchDurak(id: string, g: DurakGirdi): Promise<DurakYazmaSonuc> {
  if (!(g.ad ?? "").trim()) return { ok: false, sebep: "gecersiz", mesaj: "ad" };
  const { data, error } = await supabaseAdmin
    .from("sefer_duraklari")
    .update(satiraCevir(g))
    .eq("id", id)
    .select(COLS)
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      sebep: error && tabloYokMu(error) ? "tablo_yok" : "hata",
      mesaj: error?.message,
    };
  }
  return { ok: true, durak: data as unknown as DurakRow };
}

/**
 * DURAK SİLME — sonra BOŞLUKSUZ yeniden numaralama.
 *
 * ⚠️ SİLİNEBİLİR, ÇÜNKÜ DURAK BİR PLANDIR — kanıt değil. Teslimat kanıtı
 * bırakılmış bir durak silinse bile kanıt DURUR (`teslimatlar.durak_id` FK'si
 * `on delete set null`): delil, plan satırından uzun yaşar. Yine de ekran
 * kanıtı olan durakta uyarıyor — bağı koparmak bilinçli bir karar olmalı.
 *
 * `kullanimdaMi` (FK ihlali) yolu KORUNUYOR: ileride durağa `on delete restrict`
 * bir bağ eklenirse ekran otomatik olarak doğru cümleyi söyler
 * (lib/silme-sonucu.ts sözleşmesi).
 */
export async function deleteDurak(id: string): Promise<SilmeSonucu> {
  const mevcut = await getDurak(id);
  if (!mevcut) return { ok: false, sebep: "yok" };

  const { error } = await supabaseAdmin.from("sefer_duraklari").delete().eq("id", id);
  if (error) {
    if (tabloYokMu(error)) return { ok: false, sebep: "tablo_yok" };
    if (kullanimdaMi(error)) return { ok: false, sebep: "kullanimda" };
    return { ok: false, sebep: "hata", mesaj: error.message };
  }
  await yenidenNumarala(mevcut.sefer_id);
  return { ok: true };
}

/**
 * BOŞLUKSUZ NUMARALAMA — 1..N.
 *
 * 3 duraktan ortadaki silinince 1 ve 3 kalırdı; şoför "2. durak nerede" diye
 * sorar. Numara bir KİMLİK değil DÜZENDİR (kimlik `id`) — yeniden yazmak
 * hiçbir bağı koparmaz, çünkü teslimat kanıtı `durak_id` ile bağlı (082).
 *
 * ⚠️ TEK İFADE = TEK TRANSACTION: ertelenmiş tekil kısıt
 * (`sefer_durak_sira_uq`) ancak böyle çalışır. Satır satır UPDATE göndermek,
 * ilk istekte çakışmayla düşerdi (1↔3 takası).
 *
 * ⚠️ NEDEN `upsert` DEĞİL — ÖLÇÜLDÜ (25.08.2026, QA yığını):
 * `upsert([{id, sira}], {onConflict:"id"})` **23502** ile düşüyor
 * ("null value in column sefer_id"): PostgREST upsert'i INSERT olarak kuruyor
 * ve eksik kolonları NULL'la dolduruyor; çakışma çözülmeden NOT NULL denetimi
 * çalışıyor. TAM SATIR göndermek çalışırdı ama EŞZAMANLI DURUM DEĞİŞİKLİĞİNİ
 * EZERDİ — yönetici sıralarken şoför bir durağı "tamamlandı" yaparsa okunmuş
 * eski `durum` geri yazılır ve şoförün eylemi SİLİNİRDİ. Çözüm: yalnız `sira`
 * kolonuna dokunan bir veritabanı fonksiyonu (082).
 */
async function yenidenNumarala(seferId: string): Promise<void> {
  const { duraklar } = await listDuraklar(seferId);
  const hata = await siraYaz(seferId, duraklar.map((d) => d.id));
  if (hata) console.error(`[sefer-duraklari] yeniden numaralama başarısız: ${hata}`);
}

/**
 * Sıra yazma — TEK KAYNAK (082'nin `sefer_duraklari_sirala` fonksiyonu).
 * Hata varsa mesajı, yoksa null döner.
 */
async function siraYaz(seferId: string, sirali: string[]): Promise<string | null> {
  if (sirali.length === 0) return null;
  const { error } = await supabaseAdmin.rpc("sefer_duraklari_sirala", {
    p_sefer: seferId,
    p_ids: sirali,
  });
  return error ? `${error.code}:${error.message}` : null;
}

export type SiralamaSonuc =
  | { ok: true; duraklar: DurakRow[] }
  | { ok: false; sebep: "tablo_yok" | "eksik_id" | "hata"; mesaj?: string };

/**
 * YENİDEN SIRALAMA — istemcinin verdiği TAM sıra.
 *
 * ⚠️ LİSTE TAM OLMALI: eksik bir kimlik listesi, adı geçmeyen durakların
 * numarasını belirsiz bırakırdı ("sona mı gitsin, yerinde mi kalsın?"). Eksik
 * ya da yabancı kimlik → `eksik_id`, hiçbir şey yazılmaz.
 */
export async function siralaDuraklar(
  seferId: string,
  sirali: string[]
): Promise<SiralamaSonuc> {
  const { duraklar, tabloYok } = await listDuraklar(seferId);
  if (tabloYok) return { ok: false, sebep: "tablo_yok" };

  const mevcut = new Map(duraklar.map((d) => [d.id, d]));
  if (sirali.length !== mevcut.size || sirali.some((id) => !mevcut.has(id))) {
    return { ok: false, sebep: "eksik_id" };
  }
  if (new Set(sirali).size !== sirali.length) return { ok: false, sebep: "eksik_id" };

  const hata = await siraYaz(seferId, sirali);
  if (hata) {
    // Fonksiyon yoksa (082 yarım uygulanmış) `tablo_yok` demek yanıltıcı olurdu:
    // tablo var, YAZMA YOLU yok. Mesaj çağırana aynen taşınıyor.
    return { ok: false, sebep: "hata", mesaj: hata };
  }
  return { ok: true, duraklar: (await listDuraklar(seferId)).duraklar };
}

export type GecisSonuc =
  | { ok: true; durak: DurakRow }
  | {
      ok: false;
      sebep: "gecersiz_gecis" | "kapali_durak" | "sebep_gerekli" | "tablo_yok" | "yok" | "hata";
      mevcut?: DurakDurum;
      izinli?: DurakDurum[];
      mesaj?: string;
    };

/**
 * DURUM İLERLET — şoförün (ya da köprünün) eylemi.
 *
 * ⚠️ YARIŞ EMNİYETİ: yazma `.eq("durum", mevcut.durum)` ile yapılıyor. Araya
 * giren bir güncelleme olduysa 0 satır etkilenir ve `gecersiz_gecis` döner —
 * `ilerletSefer`in (066) aynı deseni. Otomatik varış köprüsü ile şoförün
 * elle basması AYNI ANDA gelebilir; ikisi de yazamaz, ilki kazanır.
 *
 * `kaynak` YALNIZ `varildi` geçişinde yazılır: "sistem mi gördü, şoför mü
 * söyledi" sorusunun cevabı (082 kolonu). Diğer geçişler daima şoförün eylemi.
 */
export async function ilerletDurak(
  id: string,
  hedef: DurakDurum,
  opsiyon?: { sebep?: string | null; kaynak?: "sofor" | "otomatik"; an?: string }
): Promise<GecisSonuc> {
  const mevcut = await getDurak(id);
  if (!mevcut) return { ok: false, sebep: "yok" };

  const izinli = GECERLI_GECIS[mevcut.durum];
  if (izinli.length === 0) {
    return { ok: false, sebep: "kapali_durak", mevcut: mevcut.durum, izinli };
  }
  if (!izinli.includes(hedef)) {
    return { ok: false, sebep: "gecersiz_gecis", mevcut: mevcut.durum, izinli };
  }

  const sebep = (opsiyon?.sebep ?? "").trim();
  if (hedef === "atlandi" && sebep.length < 3) {
    return { ok: false, sebep: "sebep_gerekli", mevcut: mevcut.durum, izinli };
  }

  const yama: Record<string, unknown> = { durum: hedef };
  const damga = DAMGA[hedef];
  if (damga) yama[damga] = opsiyon?.an ?? new Date().toISOString();
  if (hedef === "atlandi") yama.atlama_sebep = sebep.slice(0, 300);
  if (hedef === "varildi") yama.varis_kaynak = opsiyon?.kaynak ?? "sofor";

  const { data, error } = await supabaseAdmin
    .from("sefer_duraklari")
    .update(yama)
    .eq("id", id)
    .eq("durum", mevcut.durum)
    .select(COLS)
    .maybeSingle();
  if (error) {
    return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error.message };
  }
  if (!data) return { ok: false, sebep: "gecersiz_gecis", mevcut: mevcut.durum, izinli };
  return { ok: true, durak: data as unknown as DurakRow };
}

/**
 * YÖNETİCİ DÜZELTMESİ — durağı `bekliyor`a geri alır.
 *
 * ═══ NEDEN VAR ═══
 *
 * Şoför yanlış durağa "tamam" basabilir ve ileri yönlü çizgide bunun geri
 * dönüşü yok. Düzeltme yolu OLMAYAN bir kayıt, kullanıcıyı kendi hatasına
 * kilitler — bu ürünün açıkça reddettiği şey (bkz. scripts/check-crud-ekranlari.mjs).
 *
 * ═══ NEDEN YALNIZ YÖNETİCİDE ═══
 *
 * Kendi damgasını silebilen bir kayıt kanıt olmaktan çıkar. Şoför ileri gider,
 * yönetici düzeltir — paket kapatma formundaki "teyit ≠ engel, yönetici tam
 * düzeltme" ayrımının aynısı. Çağıran ayrıca `audit` yazar.
 *
 * Damgalar TEMİZLENİR: yanlış bir "vardı 14:20" kaydı, düzeltildikten sonra
 * doğru sanılabilecek bir zaman taşımamalı.
 */
export async function durumSifirla(id: string): Promise<GecisSonuc> {
  const { data, error } = await supabaseAdmin
    .from("sefer_duraklari")
    .update({
      durum: "bekliyor",
      varildi_at: null,
      tamamlandi_at: null,
      atlandi_at: null,
      atlama_sebep: null,
      varis_kaynak: null,
    })
    .eq("id", id)
    .select(COLS)
    .maybeSingle();
  if (error) {
    return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error.message };
  }
  if (!data) return { ok: false, sebep: "yok" };
  return { ok: true, durak: data as unknown as DurakRow };
}

// ══════════════════════════════════════════════════════════════════════════
// MOBİL GÖVDESİ
// ══════════════════════════════════════════════════════════════════════════

/** Mobil JSON gövdesi — durak uçlarının tamamı bunu döndürür. */
export function durakGovdesi(d: DurakRow) {
  return {
    id: d.id,
    seferId: d.sefer_id,
    sira: d.sira,
    ad: d.ad,
    bolgeId: d.zone_id,
    adres: d.adres,
    konum: d.latitude !== null && d.longitude !== null
      ? { lat: Number(d.latitude), lng: Number(d.longitude), yaricapM: d.yaricap_m }
      : null,
    /** Otomatik varış bu durakta ÇALIŞIR mı — istemci tahmin etmesin. */
    otomatikVarisVar: Boolean(d.zone_id) || (d.latitude !== null && d.longitude !== null),
    pencere: d.pencere_bas || d.pencere_bit ? { bas: d.pencere_bas, bit: d.pencere_bit } : null,
    tahminiSureDk: d.tahmini_sure_dk,
    notlar: d.notlar,
    durum: d.durum,
    acik: DURAK_ACIK.includes(d.durum),
    izinliGecisler: GECERLI_GECIS[d.durum],
    atlamaSebep: d.atlama_sebep,
    varisKaynak: d.varis_kaynak,
    damgalar: {
      varildi: d.varildi_at,
      tamamlandi: d.tamamlandi_at,
      atlandi: d.atlandi_at,
    },
  };
}

/** Özet gövdesi — sefer listesinde durak başına satır taşımadan ilerleme. */
export function durakOzetGovdesi(duraklar: DurakRow[]) {
  const o = durakOzeti(duraklar);
  return {
    toplam: o.toplam,
    biten: o.biten,
    tamamlanan: o.tamamlanan,
    atlanan: o.atlanan,
    bekleyen: o.bekleyen,
    varilan: o.varilan,
    sonraki: o.sonraki ? { id: o.sonraki.id, sira: o.sonraki.sira, ad: o.sonraki.ad } : null,
  };
}
