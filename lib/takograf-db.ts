import "server-only";

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { dosyaSil } from "@/lib/upload-core";
import { servisAyristir } from "@/lib/takograf-servis";
import {
  TAKOGRAF_KOVA,
  depoYolu,
  faaliyetKodu,
  kimlikKisalt,
  muhurKodu,
  slotKodu,
  tekrariSil,
  turTahmin,
  yuklemeDenetle,
  type AyristirmaDurumu,
  type DosyaTuru,
  type FaaliyetTuru,
  type MuhurDurumu,
  type ServisCevabi,
  type YuklemeHatasi,
} from "@/lib/takograf";

/**
 * TAKOGRAF — VERİ KATMANI (migration 091).
 *
 * ═══ 🔴 SIRA: ÖNCE ARŞİV, SONRA AYRIŞTIRMA ═══
 *
 *   1. Storage'a yaz          ← arşiv sözü BURADA tutulur
 *   2. Satırı veritabanına yaz (ayristirma_durumu='bekliyor')
 *   3. Servise sor
 *   4. Sonucu satıra işle
 *
 * 3 ya da 4 düşerse dosya ve satır YERİNDE KALIR. Müşteri dosyasını hiçbir
 * koşulda kaybetmez — ürünün satış vaadi bu.
 *
 * ⚠️ Ters sıra (önce ayrıştır, başarılıysa kaydet) daha "temiz" görünürdü ve
 * tam olarak yanlış olurdu: okuyamadığımız bir dosyayı reddetmek, müşterinin
 * yasal kaydını kapıda geri çevirmek demektir.
 */

const TABLO_YOK = new Set(["PGRST205", "42P01", "42703"]);
const tabloYokMu = (e: { code?: string; message?: string } | null) =>
  !!e && (TABLO_YOK.has(e.code ?? "") || /schema cache|does not exist/i.test(e.message ?? ""));

/** UNIQUE ihlali — aynı dosya ikinci kez. */
const cakismaMi = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "23505" || /duplicate key|unique constraint/i.test(e.message ?? ""));

// ═══════════════════════════ TİPLER ══════════════════════════════════════

export type TakografDosya = {
  id: string;
  tur: DosyaTuru;
  depoYolu: string;
  dosyaAdi: string;
  bayt: number;
  sha256: string;
  nesil: string | null;
  muhurDurumu: MuhurDurumu;
  muhurSebep: string | null;
  ayristirmaDurumu: AyristirmaDurumu;
  ayristirmaHata: string | null;
  ayristiriciSurum: string | null;
  kartNo: string | null;
  aracVin: string | null;
  aracPlaka: string | null;
  workerId: string | null;
  workerAd: string | null;
  vehicleId: string | null;
  vehiclePlaka: string | null;
  donemBas: string | null;
  donemBit: string | null;
  yukleyenAd: string | null;
  yuklendiAt: string;
  /** Ayrıştırılmış satır sayıları — listede göstermek için. */
  faaliyetSayisi: number;
  olaySayisi: number;
};

export type TakografFaaliyet = {
  id: string;
  sira: number;
  kartNo: string | null;
  workerAd: string | null;
  gun: string | null;
  baslangic: string | null;
  bitis: string | null;
  sureDk: number | null;
  faaliyet: FaaliyetTuru | null;
  slot: string | null;
  aracPlaka: string | null;
};

export type TakografOlay = {
  id: string;
  sira: number;
  tur: string | null;
  bas: string | null;
  bit: string | null;
  ciddiyet: string | null;
  aracPlaka: string | null;
};

// ═══════════════════════════ OKUMA ═══════════════════════════════════════

export async function dosyalar(limit = 200): Promise<{ satirlar: TakografDosya[]; tabloYok: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("takograf_dosyalari")
    .select("*")
    .order("yuklendi_at", { ascending: false })
    .limit(limit);
  if (error) return { satirlar: [], tabloYok: tabloYokMu(error) };

  const ham = (data ?? []) as Record<string, unknown>[];
  if (ham.length === 0) return { satirlar: [], tabloYok: false };

  const [adlar, plakalar, sayimlar] = await Promise.all([
    workerAdlari(ham.flatMap((r) => [r.worker_id, r.yukleyen_worker_id]).filter(Boolean).map(String)),
    vehiclePlakalari(ham.map((r) => r.vehicle_id).filter(Boolean).map(String)),
    satirSayimlari(ham.map((r) => String(r.id))),
  ]);

  return {
    tabloYok: false,
    satirlar: ham.map((r) => cevir(r, adlar, plakalar, sayimlar)),
  };
}

export async function dosya(id: string): Promise<TakografDosya | null> {
  const { data, error } = await supabaseAdmin
    .from("takograf_dosyalari")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  const [adlar, plakalar, sayimlar] = await Promise.all([
    workerAdlari([r.worker_id, r.yukleyen_worker_id].filter(Boolean).map(String)),
    vehiclePlakalari([r.vehicle_id].filter(Boolean).map(String)),
    satirSayimlari([String(r.id)]),
  ]);
  return cevir(r, adlar, plakalar, sayimlar);
}

function cevir(
  r: Record<string, unknown>,
  adlar: Map<string, string>,
  plakalar: Map<string, string>,
  sayimlar: Map<string, { faaliyet: number; olay: number }>
): TakografDosya {
  const s = sayimlar.get(String(r.id)) ?? { faaliyet: 0, olay: 0 };
  return {
    id: String(r.id),
    tur: String(r.tur) as DosyaTuru,
    depoYolu: String(r.depo_yolu),
    dosyaAdi: String(r.dosya_adi),
    bayt: Number(r.bayt ?? 0),
    sha256: String(r.sha256),
    nesil: r.nesil ? String(r.nesil) : null,
    muhurDurumu: muhurKodu(r.muhur_durumu ? String(r.muhur_durumu) : undefined),
    muhurSebep: r.muhur_sebep ? String(r.muhur_sebep) : null,
    ayristirmaDurumu: String(r.ayristirma_durumu ?? "bekliyor") as AyristirmaDurumu,
    ayristirmaHata: r.ayristirma_hata ? String(r.ayristirma_hata) : null,
    ayristiriciSurum: r.ayristirici_surum ? String(r.ayristirici_surum) : null,
    kartNo: r.kart_no ? String(r.kart_no) : null,
    aracVin: r.arac_vin ? String(r.arac_vin) : null,
    aracPlaka: r.arac_plaka ? String(r.arac_plaka) : null,
    workerId: r.worker_id ? String(r.worker_id) : null,
    workerAd: r.worker_id ? adlar.get(String(r.worker_id)) ?? null : null,
    vehicleId: r.vehicle_id ? String(r.vehicle_id) : null,
    vehiclePlaka: r.vehicle_id ? plakalar.get(String(r.vehicle_id)) ?? null : null,
    donemBas: r.donem_bas ? String(r.donem_bas) : null,
    donemBit: r.donem_bit ? String(r.donem_bit) : null,
    yukleyenAd: r.yukleyen_worker_id ? adlar.get(String(r.yukleyen_worker_id)) ?? null : null,
    yuklendiAt: String(r.yuklendi_at),
    faaliyetSayisi: s.faaliyet,
    olaySayisi: s.olay,
  };
}

/**
 * Şoför adı TÜRETİLMİŞ: dosya satırında yalnız kimlik durur.
 * Adı satıra yazmak, adı değişen bir kullanıcıda geçmişi yanlış gösterirdi
 * (aynı ders 084 ve 090'da da yazılı).
 */
async function workerAdlari(idler: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const u = [...new Set(idler)];
  if (u.length === 0) return out;
  const { data } = await supabaseAdmin.from("workers").select("id, name").in("id", u);
  for (const w of (data ?? []) as Record<string, unknown>[]) out.set(String(w.id), String(w.name));
  return out;
}

async function vehiclePlakalari(idler: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const u = [...new Set(idler)];
  if (u.length === 0) return out;
  const { data } = await supabaseAdmin.from("vehicles").select("id, plate").in("id", u);
  for (const v of (data ?? []) as Record<string, unknown>[]) out.set(String(v.id), String(v.plate));
  return out;
}

async function satirSayimlari(
  dosyaIdler: string[]
): Promise<Map<string, { faaliyet: number; olay: number }>> {
  const out = new Map<string, { faaliyet: number; olay: number }>();
  if (dosyaIdler.length === 0) return out;
  for (const id of dosyaIdler) out.set(id, { faaliyet: 0, olay: 0 });

  const [f, o] = await Promise.all([
    supabaseAdmin.from("takograf_faaliyetleri").select("dosya_id").in("dosya_id", dosyaIdler),
    supabaseAdmin.from("takograf_olaylari").select("dosya_id").in("dosya_id", dosyaIdler),
  ]);
  for (const r of (f.data ?? []) as Record<string, unknown>[]) {
    const k = out.get(String(r.dosya_id));
    if (k) k.faaliyet++;
  }
  for (const r of (o.data ?? []) as Record<string, unknown>[]) {
    const k = out.get(String(r.dosya_id));
    if (k) k.olay++;
  }
  return out;
}

export async function faaliyetler(dosyaId: string, limit = 5000): Promise<TakografFaaliyet[]> {
  const { data, error } = await supabaseAdmin
    .from("takograf_faaliyetleri")
    .select("id, sira, kart_no, worker_id, gun, baslangic, bitis, sure_dk, faaliyet, slot, vehicle_id")
    .eq("dosya_id", dosyaId)
    .order("sira", { ascending: true })
    .limit(limit);
  if (error) return [];
  const ham = (data ?? []) as Record<string, unknown>[];
  const [adlar, plakalar] = await Promise.all([
    workerAdlari(ham.map((r) => r.worker_id).filter(Boolean).map(String)),
    vehiclePlakalari(ham.map((r) => r.vehicle_id).filter(Boolean).map(String)),
  ]);
  return ham.map((r) => ({
    id: String(r.id),
    sira: Number(r.sira ?? 0),
    kartNo: r.kart_no ? String(r.kart_no) : null,
    workerAd: r.worker_id ? adlar.get(String(r.worker_id)) ?? null : null,
    gun: r.gun ? String(r.gun) : null,
    baslangic: r.baslangic ? String(r.baslangic) : null,
    bitis: r.bitis ? String(r.bitis) : null,
    sureDk: r.sure_dk === null || r.sure_dk === undefined ? null : Number(r.sure_dk),
    faaliyet: (r.faaliyet ? String(r.faaliyet) : null) as FaaliyetTuru | null,
    slot: r.slot ? String(r.slot) : null,
    aracPlaka: r.vehicle_id ? plakalar.get(String(r.vehicle_id)) ?? null : null,
  }));
}

export async function olaylar(dosyaId: string, limit = 2000): Promise<TakografOlay[]> {
  const { data, error } = await supabaseAdmin
    .from("takograf_olaylari")
    .select("id, sira, tur, bas, bit, ciddiyet, arac_plaka")
    .eq("dosya_id", dosyaId)
    .order("sira", { ascending: true })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    sira: Number(r.sira ?? 0),
    tur: r.tur ? String(r.tur) : null,
    bas: r.bas ? String(r.bas) : null,
    bit: r.bit ? String(r.bit) : null,
    ciddiyet: r.ciddiyet ? String(r.ciddiyet) : null,
    aracPlaka: r.arac_plaka ? String(r.arac_plaka) : null,
  }));
}

/** İndirme bağlantısı — ORİJİNAL dosya, bayt bayt aynı. */
export async function indirmeBaglantisi(yol: string, saniye = 300): Promise<string | null> {
  const { data } = await supabaseAdmin.storage.from(TAKOGRAF_KOVA).createSignedUrl(yol, saniye);
  return data?.signedUrl ?? null;
}

// ═══════════════════════════ YÜKLEME ═════════════════════════════════════

/**
 * Yükleme hata kodları — SERBEST METİN DEĞİL, kapalı küme.
 *
 * Neden union: her kodun ekranda bir karşılığı olmak zorunda. `string`
 * bıraksaydık yeni bir kod eklendiğinde kullanıcı çevrilmemiş bir anahtar
 * görürdü ve tip denetimi bunu yakalamazdı; union'da yakalar.
 */
export type YuklemeHataKodu =
  | YuklemeHatasi
  | "zaten_yuklu"
  | "depo_yazilamadi"
  | "kayit_yazilamadi"
  | "migration_091_yok"
  | "okunamadi";

export type YuklemeSonucu =
  | { ok: true; id: string; dosya: TakografDosya }
  | {
      ok: false;
      hata: YuklemeHataKodu;
      mevcutId?: string;
      ayrinti?: string;
      /**
       * Depoya yazılmış dosya geri alındı mı. YALNIZ satır yazılamadığında
       * anlamlıdır; `zaten_yuklu` ön-kontrolünde (henüz yükleme yok) ve
       * doğrulama hatalarında tanımsızdır.
       */
      dosyaTemizlendi?: boolean;
    };

/**
 * 🔴 TEK YÜKLEME YOLU.
 *
 * Sıra tartışma dışı (dosya başlığı). Her adımın başarısızlığı FARKLI
 * davranır ve hiçbiri dosyayı silmez.
 */
export async function dosyaYukle(girdi: {
  ad: string;
  baytlar: Uint8Array;
  yukleyenWorkerId: string | null;
}): Promise<YuklemeSonucu> {
  const denetim = yuklemeDenetle(girdi.ad, girdi.baytlar.byteLength);
  if (denetim) return { ok: false, hata: denetim };

  const sha = createHash("sha256").update(girdi.baytlar).digest("hex");

  // ── Aynı dosya daha önce yüklendi mi (UNIQUE'ten ÖNCE, dostça mesaj için)
  const { data: mevcut } = await supabaseAdmin
    .from("takograf_dosyalari")
    .select("id")
    .eq("sha256", sha)
    .maybeSingle();
  if (mevcut) {
    return { ok: false, hata: "zaten_yuklu", mevcutId: String((mevcut as { id: string }).id) };
  }

  // ── 1) ARŞİV: Storage'a yaz. Bu adım başarısızsa hiçbir söz veremeyiz.
  const kimlik = crypto.randomUUID();
  const yol = depoYolu(new Date(), kimlik);
  const { error: depoHata } = await supabaseAdmin.storage
    .from(TAKOGRAF_KOVA)
    .upload(yol, Buffer.from(girdi.baytlar), {
      contentType: "application/octet-stream",
      upsert: false,
    });
  if (depoHata) return { ok: false, hata: "depo_yazilamadi", ayrinti: depoHata.message };

  // ── 2) SATIR: 'bekliyor' olarak yazılır. Servis hiç çağrılmasa bile
  //        dosya arşivde ve kayıtta görünür.
  const { data: eklenen, error: ekleHata } = await supabaseAdmin
    .from("takograf_dosyalari")
    .insert({
      // `tur` DEĞİŞMEZ (HK091) → ilk baytlardan tespit edilip DOĞRU yazılıyor.
      tur: turTahmin(girdi.baytlar),
      depo_yolu: yol,
      dosya_adi: girdi.ad.trim().slice(0, 200),
      bayt: girdi.baytlar.byteLength,
      sha256: sha,
      ayristirma_durumu: "bekliyor",
      muhur_durumu: "denenmedi",
      yukleyen_worker_id: girdi.yukleyenWorkerId,
    })
    .select("id")
    .single();

  if (ekleHata || !eklenen) {
    /**
     * 🔴 YETİM KORUMASI (Faz C-3'te eklendi).
     *
     * ÖLÇÜLDÜ: bu üç çıkışta dosya Storage'a YAZILMIŞTI ve satır yazılamadı —
     * yani kimsenin göremediği, hiçbir kayda bağlı olmayan bir dosya kalıyordu.
     * `scripts/check-dosya-yukleme.mjs` bu bedeli D1 istisnasının yanına açıkça
     * yazmıştı: "o yolda yetim koruması YOK … o tur geldiğinde bu istisna
     * kaldırılacak."
     *
     * ⚠️ BU, "DOSYA HER KOŞULDA SAKLANIR" KURALIYLA ÇELİŞMİYOR — ve ayrım
     * ADIM BAZINDA: burada henüz bir KAYIT YOK, dolayısıyla saklanacak bir
     * kanıt da yok; silinen şey bir delil değil, hiç kaydedilmemiş bir dosya.
     * Kural 3. adımdan (servis/ayrıştırma) itibaren geçerli: orada dosya DA
     * satır DA yerinde kalır, durum 'bekliyor'/'basarisiz' olur.
     *
     * Silme sonucu YUTULMUYOR: temizlik başarısızsa yetim VARDIR ve çağıran
     * bunu `dosyaTemizlendi:false` olarak görür.
     */
    const sil = await dosyaSil(TAKOGRAF_KOVA, [yol]);
    const temiz = sil.ok && sil.silinen > 0;
    if (cakismaMi(ekleHata)) return { ok: false, hata: "zaten_yuklu", dosyaTemizlendi: temiz };
    return {
      ok: false,
      hata: tabloYokMu(ekleHata) ? "migration_091_yok" : "kayit_yazilamadi",
      ayrinti: ekleHata?.message,
      dosyaTemizlendi: temiz,
    };
  }
  const id = String((eklenen as { id: string }).id);

  // ── 3) SERVİS. Buradan sonraki hiçbir hata dosyayı geri almaz.
  await ayristirVeYaz(id, girdi.baytlar);

  const son = await dosya(id);
  return son ? { ok: true, id, dosya: son } : { ok: false, hata: "okunamadi" };
}

/**
 * Servise sorar ve sonucu satıra işler. Yeniden denemek için de kullanılır.
 *
 * ⚠️ `tur` BURADA GÜNCELLENMEZ: HK091 tetikleyicisi onu değişmez tutuyor ve
 * satır yazılırken `turTahmin()` ile doğru değer konuyor. Servisin bildirdiği
 * tür farklı çıkarsa bu bir ÇELİŞKİDİR ve sessizce düzeltilmez — ekran ham
 * kimliği gösterir.
 */
export async function ayristirVeYaz(id: string, baytlar: Uint8Array): Promise<void> {
  const sonuc = await servisAyristir(baytlar);

  if (!sonuc.ok) {
    await supabaseAdmin
      .from("takograf_dosyalari")
      .update({
        // 'reddedildi' → kalıcı; 'erisilemedi' → sonra denenecek
        ayristirma_durumu: sonuc.tur === "reddedildi" ? "basarisiz" : "bekliyor",
        ayristirma_hata: sonuc.hata,
      })
      .eq("id", id);
    return;
  }

  const c = sonuc.cevap;
  await supabaseAdmin
    .from("takograf_dosyalari")
    .update({
      nesil: c.nesil ?? null,
      muhur_durumu: muhurKodu(c.muhur_durumu),
      /**
       * ⚠️ HAM METİN BURADA KALIR — bu KAYITTIR, ekran değil.
       *
       * Ekran artık bunu basmıyor (bkz. muhurSebepKodu); denetim izinde
       * gerekirse ham sebep bu kolondan okunur. Yalnız TEKRARI temizleniyor:
       * VU kimlik doğrulaması her imzalı kaydı ayrı deniyor ve aynı cümle
       * kayıt başına bir kez birikiyor — ölçülen örnekte aynı cümle dört kez.
       * Tekrarı saklamak kaydı okunmaz yapıyor, bilgi eklemiyor.
       */
      muhur_sebep: c.muhur_sebep ? tekrariSil(c.muhur_sebep) : null,
      ayristirma_durumu: "tamam",
      ayristirma_hata: null,
      ayristirici_surum: c.ayristirici_surum ?? null,
      kart_no: c.kart_no || null,
      arac_vin: c.arac_vin || null,
      arac_plaka: c.arac_plaka || null,
      donem_bas: c.donem_bas || null,
      donem_bit: c.donem_bit || null,
    })
    .eq("id", id);

  await satirlariYaz(id, c);
}

/** Faaliyet ve olay satırlarını yazar. Yeniden ayrıştırmada önce siler. */
async function satirlariYaz(id: string, c: ServisCevabi): Promise<void> {
  await Promise.all([
    supabaseAdmin.from("takograf_faaliyetleri").delete().eq("dosya_id", id),
    supabaseAdmin.from("takograf_olaylari").delete().eq("dosya_id", id),
  ]);

  const faal = (c.faaliyetler ?? []).map((f, i) => ({
    dosya_id: id,
    sira: i,
    kart_no: f.kart_no || c.kart_no || null,
    gun: f.baslangic ? f.baslangic.slice(0, 10) : null,
    baslangic: f.baslangic || null,
    bitis: f.bitis || null,
    /**
     * ⚠️ `?? null` — `|| null` DEĞİL. Süre gerçekten 0 dakika olabilir
     * (aynı dakikada iki değişim) ve `||` onu "ölçülemedi"ye çevirirdi.
     */
    sure_dk: typeof f.sure_dk === "number" && Number.isFinite(f.sure_dk) ? f.sure_dk : null,
    faaliyet: faaliyetKodu(f.faaliyet),
    slot: slotKodu(f.slot),
    kaynak_nesil: c.nesil ?? null,
  }));

  const olay = (c.olaylar ?? []).map((o, i) => ({
    dosya_id: id,
    sira: i,
    tur: o.tur || null,
    bas: o.bas || null,
    bit: o.bit || null,
    ciddiyet: o.ciddiyet || null,
    arac_plaka: c.arac_plaka || null,
  }));

  /**
   * ⚠️ PARÇALI YAZIM. Bir VU dosyası 3.430 satır üretiyor (365 günlükte
   * ≈13.000, ÖLÇÜLDÜ). Tek `insert` PostgREST'te istek boyutu ve ifade
   * zaman aşımı sınırlarına dayanır.
   */
  const PARCA = 500;
  for (let i = 0; i < faal.length; i += PARCA) {
    await supabaseAdmin.from("takograf_faaliyetleri").insert(faal.slice(i, i + PARCA));
  }
  for (let i = 0; i < olay.length; i += PARCA) {
    await supabaseAdmin.from("takograf_olaylari").insert(olay.slice(i, i + PARCA));
  }
}

/** Ekranda gösterilecek kısa kimlik (kart no ya da VIN). */
export function kimlikEtiketi(d: TakografDosya): string | null {
  if (d.tur === "kart") return kimlikKisalt(d.kartNo);
  return d.aracPlaka || kimlikKisalt(d.aracVin);
}

// ═══════════════════ MOBİL: SÜZGEÇLİ · SAYFALI LİSTE ════════════════════

/**
 * ⚠️ NEDEN YENİ BİR FONKSİYON, NEDEN `dosyalar()` GENİŞLETİLMEDİ.
 *
 * `dosyalar(limit = 200)` panelin çağrısı ve DAVRANIŞI DEĞİŞMEMELİ: panel tüm
 * listeyi tek seferde çekip `sayaclar()` ile süzgeç rozetlerini istemcide
 * üretiyor. Ona sayfalama sokmak, görünmeyen bir davranış değişikliği olurdu.
 * Mobil ise telefon ekranı ve zayıf bağlantı için sayfalı istiyor.
 *
 * ⚠️ `faaliyetSayisi`/`olaySayisi` BU LİSTEDE YOK — bilinçli bir eksik.
 * `satirSayimlari()` sayıları SATIR ÇEKEREK üretiyor ve PostgREST'in 1000
 * satır tavanına takılıyor (ÖLÇÜLDÜ 21.09.2026, galzura-demo: 1.270.885
 * satırlık bir tabloda limitsiz select 1000, `.limit(40000)` de 1000 döndü).
 * Bir VU dosyası 3.430 faaliyet satırı üretebiliyor (091 başlığı), yani
 * listedeki sayılar SESSİZCE yanlış olurdu. Doğru sayım künye ucunda,
 * `count: "exact"` ile alınıyor.
 */
export type DosyaSuzgeci = {
  tur?: DosyaTuru | null;
  /** `kart_no` üzerinde parça eşleşme. */
  kart?: string | null;
  /** `arac_plaka` VEYA `arac_vin` üzerinde parça eşleşme. */
  plaka?: string | null;
  yukleyenWorkerId?: string | null;
  /** Takvim ayı — dosyanın dönemiyle ÖRTÜŞME aranır. */
  donem?: { bas: string; bit: string } | null;
  limit?: number;
  offset?: number;
};

export type DosyaListesi = {
  satirlar: TakografDosya[];
  toplam: number;
  tabloYok: boolean;
  /**
   * Dönem süzgeci verildiğinde, dönemi NULL olduğu için listeye GİREMEYEN
   * dosya sayısı. Sessiz kalmak, ayrıştırılamamış dosyaları yok saymak olurdu.
   */
  donemsizGizlendi: number | null;
};

/** PostgREST `or()` deseninde anlam taşıyan karakterleri etkisizleştirir. */
function ilikeKac(s: string): string {
  return s.replace(/[%_,()*.]/g, " ").trim();
}

export async function dosyaListesi(f: DosyaSuzgeci = {}): Promise<DosyaListesi> {
  const limit = Math.min(200, Math.max(1, f.limit ?? 50));
  const offset = Math.max(0, f.offset ?? 0);

  const kartDeseni = f.kart ? `%${ilikeKac(f.kart)}%` : null;
  // Plaka VEYA VIN: kullanıcı hangisini yazdığını bilmek zorunda değil.
  const plakaDeseni = f.plaka
    ? `arac_plaka.ilike.*${ilikeKac(f.plaka)}*,arac_vin.ilike.*${ilikeKac(f.plaka)}*`
    : null;

  let q = supabaseAdmin.from("takograf_dosyalari").select("*", { count: "exact" });
  if (f.tur) q = q.eq("tur", f.tur);
  if (f.yukleyenWorkerId) q = q.eq("yukleyen_worker_id", f.yukleyenWorkerId);
  if (kartDeseni) q = q.ilike("kart_no", kartDeseni);
  if (plakaDeseni) q = q.or(plakaDeseni);
  /**
   * ÖRTÜŞME: dosyanın [donem_bas, donem_bit] aralığı istenen ayla kesişiyorsa
   * eşleşir. "Dönemi tam o ay olan" demek, 28 günlük kart dosyalarının ay
   * sınırını aşan çoğunu elerdi.
   */
  if (f.donem) q = q.lte("donem_bas", f.donem.bit).gte("donem_bit", f.donem.bas);

  const { data, error, count } = await q
    /**
     * ⚠️ İKİNCİL ANAHTAR ZORUNLU: aynı `yuklendi_at`li iki satırda ofset
     * sayfalaması determinist olmazsa bir satır iki sayfada görünür ya da
     * hiç görünmez.
     */
    .order("yuklendi_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return { satirlar: [], toplam: 0, tabloYok: tabloYokMu(error), donemsizGizlendi: null };
  }

  const ham = (data ?? []) as unknown as Record<string, unknown>[];
  const [adlar, plakalar] = await Promise.all([
    workerAdlari(
      ham.flatMap((r) => [r.worker_id, r.yukleyen_worker_id]).filter(Boolean).map(String)
    ),
    vehiclePlakalari(ham.map((r) => r.vehicle_id).filter(Boolean).map(String)),
  ]);

  /**
   * ⚠️ DÖNEM SÜZGECİ SESSİZ ELEME YAPMAZ.
   *
   * Dönemi NULL olan dosyalar (ayrıştırılamamış ya da servise hiç
   * ulaşılamamış olanlar) bu süzgecin dışında kalır — ve bu doğru: dönemi
   * bilinmeyen bir dosyanın "Mart'a ait" olduğunu iddia edemeyiz. Ama kaç
   * tane olduğunu SÖYLEMEMEK, kullanıcıya eksik bir listeyi tam gibi
   * göstermek olurdu.
   *
   * Sayım AYNI dönem-dışı süzgeçlerle daraltılıyor: "bu türde/plakada,
   * dönemi bilinmediği için gösteremediğim N dosya var".
   */
  let donemsizGizlendi: number | null = null;
  if (f.donem) {
    let dq = supabaseAdmin
      .from("takograf_dosyalari")
      .select("id", { count: "exact", head: true })
      .is("donem_bas", null);
    if (f.tur) dq = dq.eq("tur", f.tur);
    if (f.yukleyenWorkerId) dq = dq.eq("yukleyen_worker_id", f.yukleyenWorkerId);
    if (kartDeseni) dq = dq.ilike("kart_no", kartDeseni);
    if (plakaDeseni) dq = dq.or(plakaDeseni);
    const { count: c } = await dq;
    donemsizGizlendi = c ?? 0;
  }

  return {
    // Sayımlar YOK (başlıktaki gerekçe) — boş harita geçiliyor.
    satirlar: ham.map((r) => cevir(r, adlar, plakalar, new Map())),
    toplam: count ?? ham.length,
    tabloYok: false,
    donemsizGizlendi,
  };
}

// ═══════════════════ MOBİL: GERÇEK SAYIM + SAYFALI ALT LİSTELER ═════════

/**
 * Bir dosyanın faaliyet/olay sayısı — SATIR ÇEKMEDEN.
 *
 * ⚠️ `satirSayimlari()` sayıyı satır çekerek buluyor ve 1000 tavanında
 * sessizce yanlışa dönüyor. `count: "exact", head: true` tavandan bağımsızdır:
 * gövde hiç dönmez, yalnız `Content-Range` başlığı okunur.
 */
export async function altSayim(dosyaId: string): Promise<{ faaliyet: number; olay: number }> {
  const [f, o] = await Promise.all([
    supabaseAdmin
      .from("takograf_faaliyetleri")
      .select("id", { count: "exact", head: true })
      .eq("dosya_id", dosyaId),
    supabaseAdmin
      .from("takograf_olaylari")
      .select("id", { count: "exact", head: true })
      .eq("dosya_id", dosyaId),
  ]);
  return { faaliyet: f.count ?? 0, olay: o.count ?? 0 };
}

/** Sayfalı faaliyetler — künye ucu için. Toplam AYRI ve gerçek. */
export async function faaliyetlerSayfali(
  dosyaId: string,
  s: { limit: number; offset: number }
): Promise<{ satirlar: TakografFaaliyet[]; toplam: number }> {
  const { data, error, count } = await supabaseAdmin
    .from("takograf_faaliyetleri")
    .select(
      "id, sira, kart_no, worker_id, gun, baslangic, bitis, sure_dk, faaliyet, slot, vehicle_id",
      { count: "exact" }
    )
    .eq("dosya_id", dosyaId)
    .order("sira", { ascending: true })
    .range(s.offset, s.offset + s.limit - 1);
  if (error) return { satirlar: [], toplam: 0 };

  const ham = (data ?? []) as Record<string, unknown>[];
  const [adlar, plakalar] = await Promise.all([
    workerAdlari(ham.map((r) => r.worker_id).filter(Boolean).map(String)),
    vehiclePlakalari(ham.map((r) => r.vehicle_id).filter(Boolean).map(String)),
  ]);
  return {
    toplam: count ?? ham.length,
    satirlar: ham.map((r) => ({
      id: String(r.id),
      sira: Number(r.sira ?? 0),
      kartNo: r.kart_no ? String(r.kart_no) : null,
      workerAd: r.worker_id ? (adlar.get(String(r.worker_id)) ?? null) : null,
      gun: r.gun ? String(r.gun) : null,
      baslangic: r.baslangic ? String(r.baslangic) : null,
      bitis: r.bitis ? String(r.bitis) : null,
      sureDk: r.sure_dk === null || r.sure_dk === undefined ? null : Number(r.sure_dk),
      faaliyet: (r.faaliyet ? String(r.faaliyet) : null) as FaaliyetTuru | null,
      slot: r.slot ? String(r.slot) : null,
      aracPlaka: r.vehicle_id ? (plakalar.get(String(r.vehicle_id)) ?? null) : null,
    })),
  };
}

/** Sayfalı olaylar — künye ucu için. */
export async function olaylarSayfali(
  dosyaId: string,
  s: { limit: number; offset: number }
): Promise<{ satirlar: TakografOlay[]; toplam: number }> {
  const { data, error, count } = await supabaseAdmin
    .from("takograf_olaylari")
    .select("id, sira, tur, bas, bit, ciddiyet, arac_plaka", { count: "exact" })
    .eq("dosya_id", dosyaId)
    .order("sira", { ascending: true })
    .range(s.offset, s.offset + s.limit - 1);
  if (error) return { satirlar: [], toplam: 0 };
  return {
    toplam: count ?? (data ?? []).length,
    satirlar: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      sira: Number(r.sira ?? 0),
      tur: r.tur ? String(r.tur) : null,
      bas: r.bas ? String(r.bas) : null,
      bit: r.bit ? String(r.bit) : null,
      ciddiyet: r.ciddiyet ? String(r.ciddiyet) : null,
      aracPlaka: r.arac_plaka ? String(r.arac_plaka) : null,
    })),
  };
}

/** Aynı SHA'ya sahip mevcut kaydın kimliği — 409 yanıtını doldurmak için. */
export async function shaIleBul(sha: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("takograf_dosyalari")
    .select("id")
    .eq("sha256", sha)
    .maybeSingle();
  return data ? String((data as { id: string }).id) : null;
}
