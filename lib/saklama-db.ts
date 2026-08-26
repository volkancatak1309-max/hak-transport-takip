import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { buildFuelReport } from "@/lib/reports";
import { mapBounded } from "@/lib/db-fanout";
import {
  VARSAYILAN_SAKLAMA_AYARI,
  VARSAYILAN_HAM_GUN,
  aySiniri,
  aySilinebilir,
  ayBasi,
  kesimTarihi,
  silmeKapisi,
  type SaklamaAyari,
  type SilmeKapisi,
} from "@/lib/saklama";

/**
 * SAKLAMA POLİTİKASI — VERİ KATMANI (migration 090).
 *
 * ═══ ÜÇ İŞ, KESİN SIRAYLA ═══
 *
 *   1. ÖMÜR İZİ   — aracın ilk/son telemetri anını ham akıştan bağımsız yaz
 *   2. AYLIK ÖZET — kesimin gerisindeki her ay için raporun KENDİ cevabını dondur
 *   3. KM DONDUR  — vardiya km yargısını ham silinmeden ÖNCE sabitle
 *   ── ancak bundan SONRA ──
 *   4. SİL        — ve yalnız ayarı açık, özeti tam, kesimin tamamen
 *                   gerisindeki aylar için
 *
 * ⚠️ SIRA TARTIŞMA DIŞI. 3'ü 4'ten sonra yapmak, düzeltmek istediği hatayı
 * kalıcılaştırır: ham gittikten sonra km kapısı her sıfır-farklı vardiyaya
 * sessizce "ölçülemedi" yazar.
 *
 * ⚠️ ÖZET RAPORUN KENDİ ÇIKTISIDIR. `buildFuelReport` ayın tamamı için TEK
 * pencere olarak çağrılıp sonucu yazılıyor — ikinci bir hesap YOK. İkinci
 * hesap, özetin raporla çelişmesine giden en kısa yoldur (aynı ders
 * lib/co2-db.ts ve mobil Analiz ucunda da yazılı).
 */

const TABLO_YOK = new Set(["PGRST205", "42P01", "42703"]);
const tabloYokMu = (e: { code?: string; message?: string } | null) =>
  !!e && (TABLO_YOK.has(e.code ?? "") || /schema cache|does not exist/i.test(e.message ?? ""));

/** RPC yok = migration 090 çalıştırılmamış. */
const FONKSIYON_YOK = new Set(["PGRST202", "42883"]);
const fonksiyonYokMu = (e: { code?: string; message?: string } | null) =>
  !!e && (FONKSIYON_YOK.has(e.code ?? "") || /could not find the function/i.test(e.message ?? ""));

export const HESAP_SURUMU = "090.1";

// ═══════════════════════════ KİRACI AYARI ════════════════════════════════

export async function saklamaAyari(): Promise<SaklamaAyari> {
  const { data, error } = await supabaseAdmin
    .from("tenant_saklama")
    .select("ham_gun, silme_acik, gerekce, updated_at")
    .eq("id", "singleton")
    .maybeSingle();

  // 🔴 FAIL-CLOSED: tablo yoksa ya da okunamıyorsa silme KAPALI kabul edilir.
  if (error || !data) {
    return { ...VARSAYILAN_SAKLAMA_AYARI, tabloYok: tabloYokMu(error) };
  }
  const r = data as Record<string, unknown>;
  return {
    hamGun: Number(r.ham_gun ?? VARSAYILAN_HAM_GUN),
    silmeAcik: r.silme_acik === true,
    gerekce: r.gerekce ? String(r.gerekce) : null,
    guncellendiAt: r.updated_at ? String(r.updated_at) : null,
    tabloYok: false,
  };
}

export async function saklamaAyariYaz(
  girdi: { hamGun: number; silmeAcik: boolean; gerekce: string | null },
  workerId: string | null
): Promise<{ ok: boolean; hata?: string }> {
  const { error } = await supabaseAdmin
    .from("tenant_saklama")
    .update({
      ham_gun: girdi.hamGun,
      silme_acik: girdi.silmeAcik,
      gerekce: girdi.gerekce,
      updated_at: new Date().toISOString(),
      updated_by: workerId,
    })
    .eq("id", "singleton");
  if (error) return { ok: false, hata: tabloYokMu(error) ? "tablo_yok" : "hata" };
  return { ok: true };
}

// ═══════════════════════════ 1 · ÖMÜR İZİ ════════════════════════════════

/**
 * Aracın ilk/son telemetri anını tazeler.
 *
 * NEDEN ÖNCE: haftalık aksiyon K3 "sessiz araç" ve panodaki "sessiz cihaz"
 * alarmı aracın SON ham satırının yaşına bakıyor. 90 günden uzun susmuş bir
 * aracın tüm satırları silinince o araç uyarı listesinden SESSİZCE DÜŞER —
 * yani en çok ilgilenilmesi gereken araç görünmez olur.
 */
export async function omurIziniTazele(): Promise<{ ok: boolean; satir: number; hata?: string }> {
  const { data, error } = await supabaseAdmin.rpc("refresh_telemetry_lifetime");
  if (error) {
    return { ok: false, satir: 0, hata: fonksiyonYokMu(error) ? "migration_090_yok" : error.message };
  }
  return { ok: true, satir: Number(data ?? 0) };
}

export async function omurIziSayisi(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("vehicle_telemetry_lifetime")
    .select("vehicle_id", { count: "exact", head: true });
  if (error) return 0;
  return count ?? 0;
}

// ═══════════════════════════ 2 · AYLIK ÖZET ══════════════════════════════

export type AyOzetSonucu = {
  ay: string;
  arac: number;
  olculen: number;
  olculemeyen: number;
  litre: number | null;
};

/**
 * Bir ayın özetini üretir ve yazar.
 *
 * ⚠️ TEK PENCERE. Ayın tamamı `buildFuelReport`e tek aralık olarak veriliyor.
 * Günlük parçalara bölüp toplamak yakıtı %15,6-28,9 şişiriyor (ÖLÇÜLDÜ,
 * bkz. lib/saklama.ts başlığı ve db/migrations/090). Aylık tek pencerenin
 * sapması %0,0 — çünkü bu, raporun kendi cevabının ta kendisi.
 *
 * ⚠️ ÜZERİNE YAZMAZ: ham satırları silinmiş bir ay (`ham_silindi_at` dolu)
 * yeniden üretilemez; o satıra dokunulmaz.
 */
export async function ayOzetiYaz(ay: string): Promise<{ ok: boolean; sonuc?: AyOzetSonucu; hata?: string }> {
  const { bas, bit } = aySiniri(ay);

  // Odometre açıklığı + sayımlar: saf SQL'de doğru ve ucuz.
  const { data: spans, error: spanErr } = await supabaseAdmin.rpc("telemetry_month_spans", {
    p_from: bas.toISOString(),
    p_to: bit.toISOString(),
  });
  if (spanErr) {
    return { ok: false, hata: fonksiyonYokMu(spanErr) ? "migration_090_yok" : spanErr.message };
  }
  const spanMap = new Map<string, Record<string, unknown>>();
  for (const s of (spans ?? []) as Record<string, unknown>[]) {
    if (String(s.ay) === ay) spanMap.set(String(s.vehicle_id), s);
  }

  // Yakıt/tüketim: raporun KENDİ motoru, ayın tamamı tek pencere.
  const rapor = await buildFuelReport({ start: bas, end: bit });

  // Bu ayın ham verisi silinmiş araç/ay satırlarını KORU — üzerine yazma.
  const { data: mevcut } = await supabaseAdmin
    .from("vehicle_month_metrics")
    .select("vehicle_id, ham_silindi_at")
    .eq("ay", ay);
  const dokunma = new Set(
    ((mevcut ?? []) as Record<string, unknown>[])
      .filter((m) => m.ham_silindi_at)
      .map((m) => String(m.vehicle_id))
  );

  const satirlar: Record<string, unknown>[] = [];
  let olculen = 0;
  let olculemeyen = 0;
  let litreTop = 0;

  /**
   * ⚠️ DEĞERLER RAPORUN KENDİ SATIRINDAN alınıyor (FuelRow), SQL'den değil.
   * `km`, `consumedLiters`, `zeroCount`, `unreliableSensor` — hepsi raporun
   * kendi cevabı. SQL uçları (telemetry_month_spans) yalnız raporun
   * ÜRETMEDİĞİ iki şey için: kapsama sayımı (ornek_sayisi) ve pencere uçları
   * (ilk/son kayıt). İkisini karıştırmak, özetin raporla çelişmesine giden
   * yol olurdu.
   */
  for (const r of rapor.rows ?? []) {
    const row = r as unknown as Record<string, unknown>;
    const vid = String(row.vehicleId ?? "");
    if (!vid || dokunma.has(vid)) continue;
    const s = spanMap.get(vid);
    const say = (v: unknown) => (v === null || v === undefined ? null : Number(v));

    const litre = say(row.consumedLiters);
    const km = say(row.km);
    const hasData = row.hasData === true;
    const guvenilmez = row.unreliableSensor === true;
    const ornek = say(s?.ornek_sayisi) ?? say(row.sampleCount) ?? 0;
    const yakitOrnek = say(s?.yakit_ornek_sayisi) ?? 0;

    /**
     * ⚠️ "ÖLÇÜLEMEDİ ≠ 0". Sebep dolu ise bu satır bir SIFIR DEĞİL, bir
     * BİLİNMEYENDİR ve rapor onu öyle gösterecek.
     *
     * Sıra önemli: cihaz hiç konuşmadıysa "cihaz_yok" (sensör suçlanmaz);
     * konuştu ama sensörü güvenilmezse "sensor_arizali"; litre yoksa
     * genellikle kapasite/okuma eksiği; litre var ama odometre yoksa km
     * ölçülemez ve L/100km üretilemez.
     */
    let sebep: string | null = null;
    if (ornek === 0 || !hasData) sebep = "cihaz_yok";
    else if (guvenilmez) sebep = "sensor_arizali";
    else if (litre === null) sebep = "yetersiz_okuma";
    else if (km === null) sebep = "odometre_yok";

    if (sebep === null) {
      olculen++;
      litreTop += litre ?? 0;
    } else {
      olculemeyen++;
    }

    satirlar.push({
      vehicle_id: vid,
      ay,
      km,
      odometre_ilk: say(s?.odometre_ilk),
      odometre_son: say(s?.odometre_son),
      litre,
      yuzde_tuketim: say(row.consumedPct),
      dolum_sayisi: say(row.refillCount),
      dolum_yuzde: say(row.refillPct),
      dusus_sayisi: say(row.suspiciousDropCount),
      dusus_yuzde: say(row.suspiciousDropPct),
      l_100km: say(row.lPer100Km),
      ornek_sayisi: ornek,
      yakit_ornek_sayisi: yakitOrnek,
      yakit_sifir_okuma: say(row.zeroCount) ?? say(s?.yakit_sifir_okuma) ?? 0,
      ilk_kayit: s?.ilk_kayit ?? null,
      son_kayit: s?.son_kayit ?? null,
      olculemedi_sebep: sebep,
      hesaplandi_at: new Date().toISOString(),
      hesap_surumu: HESAP_SURUMU,
    });
  }

  if (satirlar.length > 0) {
    const { error } = await supabaseAdmin
      .from("vehicle_month_metrics")
      .upsert(satirlar, { onConflict: "vehicle_id,ay" });
    if (error) return { ok: false, hata: tabloYokMu(error) ? "migration_090_yok" : error.message };
  }

  return {
    ok: true,
    sonuc: { ay, arac: satirlar.length, olculen, olculemeyen, litre: olculen > 0 ? litreTop : null },
  };
}

/** Kesimin gerisindeki hangi aylarda ham var ama özet yok? */
export async function ozetiEksikAylar(kesim: Date): Promise<{ eksik: string[]; hazir: string[]; hata?: string }> {
  const { data: lifetime, error: lErr } = await supabaseAdmin
    .from("vehicle_telemetry_lifetime")
    .select("ilk_kayit");
  if (lErr) return { eksik: [], hazir: [], hata: tabloYokMu(lErr) ? "migration_090_yok" : lErr.message };

  const ilkler = ((lifetime ?? []) as Record<string, unknown>[])
    .map((r) => (r.ilk_kayit ? new Date(String(r.ilk_kayit)) : null))
    .filter((d): d is Date => d !== null);
  if (ilkler.length === 0) return { eksik: [], hazir: [] };

  const enEski = new Date(Math.min(...ilkler.map((d) => d.getTime())));
  const adaylar: string[] = [];
  const d = new Date(Date.UTC(enEski.getUTCFullYear(), enEski.getUTCMonth(), 1));
  while (d.getTime() < kesim.getTime()) {
    const ay = ayBasi(d);
    if (aySilinebilir(ay, kesim)) adaylar.push(ay);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  if (adaylar.length === 0) return { eksik: [], hazir: [] };

  const { data: ozet } = await supabaseAdmin
    .from("vehicle_month_metrics")
    .select("ay")
    .in("ay", adaylar);
  const yazili = new Set(((ozet ?? []) as Record<string, unknown>[]).map((r) => String(r.ay)));

  return {
    eksik: adaylar.filter((a) => !yazili.has(a)),
    hazir: adaylar.filter((a) => yazili.has(a)),
  };
}

// ═══════════════════════════ 3 · KM DONDURMA ═════════════════════════════

/**
 * Kapanmış vardiyaların km yargısını dondurur.
 *
 * ⚠️ SIRA: silmeden ÖNCE. Sonra çalıştırılırsa ham gitmiş olur ve her
 * sıfır-farklı vardiyaya sessizce `false` yazar.
 *
 * Yargı, bugünkü kapının ta kendisi: sayaç farkı > 0 ise ölçülmüştür;
 * fark 0 ise ham telemetride vardiya penceresinde hareket (speed_kmh >= 5)
 * arayıp karar verilir. Ham hâlâ elimizdeyken sorulduğu için cevap doğru.
 */
export async function kmDondur(
  limit = 2000
): Promise<{ ok: boolean; dondurulan: number; kalan: number; hata?: string }> {
  /**
   * test-visible: BAKIM TARAMASI — test vardiyaları BİLEREK dahil.
   *
   * Bu sorgu kullanıcıya bir SAYI göstermiyor; ham silinmeden önce her
   * kapanmış vardiyanın km yargısını sabitleyen bir bakım işi. Silme
   * `device_telemetry`nin TAMAMINI siler — test aracının satırlarını da.
   * Test vardiyalarını dışarıda bırakırsak onların yargısı silmeden SONRA
   * sorulur ve sessizce "ölçülemedi"ye düşer; yani muhafızın önlemeye
   * çalıştığı hatanın ta kendisini üretiriz.
   *
   * Ayrıca `kalan` sayacı silme kapısını açıyor: dondurmadan hariç tutulan
   * ama sayımda görünen bir satır kapıyı SONSUZA KADAR kapalı tutardı.
   * Dondurma ile sayım aynı kümeye bakmak ZORUNDA.
   */
  // test-visible: bakım taraması — gerekçe hemen yukarıda.
  const { data, error } = await supabaseAdmin
    .from("time_entries")
    .select("id, started_at, ended_at, vehicle_id, start_km, end_km")
    .is("km_dondu", null)
    .not("ended_at", "is", null)
    .order("started_at", { ascending: true })
    .limit(limit);
  if (error) return { ok: false, dondurulan: 0, kalan: 0, hata: tabloYokMu(error) ? "migration_090_yok" : error.message };

  const satirlar = (data ?? []) as Record<string, unknown>[];
  if (satirlar.length === 0) return { ok: true, dondurulan: 0, kalan: 0 };

  const sonuclar = await mapBounded(satirlar, async (t: Record<string, unknown>) => {
    const bas = Number(t.start_km);
    const bit = Number(t.end_km);
    if (Number.isFinite(bas) && Number.isFinite(bit) && bit - bas > 0) {
      return { id: String(t.id), olculdu: true };
    }
    // Fark 0 / yok → ham telemetride hareket var mı?
    const vid = t.vehicle_id ? String(t.vehicle_id) : null;
    if (!vid || !t.started_at || !t.ended_at) return { id: String(t.id), olculdu: false };
    const { count } = await supabaseAdmin
      .from("device_telemetry")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", vid)
      .gte("recorded_at", String(t.started_at))
      .lte("recorded_at", String(t.ended_at))
      .gte("speed_kmh", 5);
    // Hareket VARSA araç gitmiş ama sayaç saymamış → ölçülemedi.
    // Hareket YOKSA araç gerçekten durmuş → 0 km bir ÖLÇÜMDÜR.
    return { id: String(t.id), olculdu: (count ?? 0) === 0 };
  }, 6);

  const simdi = new Date().toISOString();
  for (const grup of [true, false]) {
    const idler = sonuclar.filter((r) => r.olculdu === grup).map((r) => r.id);
    if (idler.length === 0) continue;
    const { error: uErr } = await supabaseAdmin
      .from("time_entries")
      .update({ km_dondu: grup, km_dondu_at: simdi })
      .in("id", idler);
    if (uErr) return { ok: false, dondurulan: 0, kalan: satirlar.length, hata: uErr.message };
  }

  // test-visible: yukarıdaki dondurma ile AYNI küme — bkz. kmDondur başlığı.
  const { count: kalan } = await supabaseAdmin
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .is("km_dondu", null)
    .not("ended_at", "is", null);

  return { ok: true, dondurulan: sonuclar.length, kalan: kalan ?? 0 };
}

export async function kmDonmamisSayisi(): Promise<number> {
  // test-visible: silme kapısının sayacı — dondurma ile AYNI kümeye bakmak
  // ZORUNDA, yoksa hariç tutulan satır kapıyı sonsuza kadar kapalı tutar.
  const { count, error } = await supabaseAdmin
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .is("km_dondu", null)
    .not("ended_at", "is", null);
  if (error) return 0;
  return count ?? 0;
}

// ═══════════════════════════ 4 · SİLME ═══════════════════════════════════

export type SilmeDurumu = {
  ayar: SaklamaAyari;
  kapi: SilmeKapisi;
  kesim: string;
  /** Kesimin gerisinde olup özeti YAZILMAMIŞ aylar. */
  eksikAylar: string[];
  /** Özeti yazılmış, silinmeye hazır aylar. */
  hazirAylar: string[];
  kmDonmamis: number;
};

export async function silmeDurumu(): Promise<SilmeDurumu> {
  const ayar = await saklamaAyari();
  const kesim = kesimTarihi(ayar.hamGun);
  const [{ eksik, hazir }, kmKalan, omur] = await Promise.all([
    ozetiEksikAylar(kesim),
    kmDonmamisSayisi(),
    omurIziSayisi(),
  ]);
  const kapi = silmeKapisi({
    silmeAcik: ayar.silmeAcik,
    hazirAylar: hazir,
    ozetiEksikAylar: eksik,
    kmDonmamisVardiya: kmKalan,
    omurIziSatir: omur,
  });
  return {
    ayar,
    kapi,
    kesim: kesim.toISOString(),
    eksikAylar: eksik,
    hazirAylar: hazir,
    kmDonmamis: kmKalan,
  };
}

const BATCH = 20_000;
const MAX_TUR = 25;

/**
 * Parça parça siler. Her tur kendi başına tamamlanmış bir iştir; yarıda
 * kesilse veri tutarlı kalır (054'ün dersi).
 *
 * ⚠️ `kuru` modda HİÇBİR satır silinmez, yalnız ne olacağı sayılır.
 */
export async function hamSil(
  hamGun: number,
  kuru: boolean
): Promise<{ ok: boolean; telemetri: number; konum: number; tur: number; hata?: string }> {
  if (kuru) {
    const kesim = kesimTarihi(hamGun).toISOString();
    const [t, k] = await Promise.all([
      supabaseAdmin.from("device_telemetry").select("id", { count: "exact", head: true }).lt("recorded_at", kesim),
      supabaseAdmin.from("driver_locations").select("id", { count: "exact", head: true }).lt("recorded_at", kesim),
    ]);
    return { ok: true, telemetri: t.count ?? 0, konum: k.count ?? 0, tur: 0 };
  }

  let telemetri = 0;
  let tur = 0;
  for (; tur < MAX_TUR; tur++) {
    const { data, error } = await supabaseAdmin.rpc("purge_old_telemetry", { p_days: hamGun, p_limit: BATCH });
    if (error) {
      return {
        ok: false,
        telemetri,
        konum: 0,
        tur,
        hata: fonksiyonYokMu(error) ? "migration_090_yok" : error.message,
      };
    }
    const n = Number(data ?? 0);
    telemetri += n;
    if (n < BATCH) {
      tur++;
      break;
    }
  }

  let konum = 0;
  for (let i = 0; i < MAX_TUR; i++) {
    const { data, error } = await supabaseAdmin.rpc("purge_old_driver_locations", { p_days: hamGun, p_limit: BATCH });
    if (error) break; // driver_locations fonksiyonu yoksa telemetri sonucu yine geçerli
    const n = Number(data ?? 0);
    konum += n;
    if (n < BATCH) break;
  }

  return { ok: true, telemetri, konum, tur };
}

/** Silinen ayları özet tablosunda işaretle — o aylar artık yeniden üretilemez. */
export async function aylariSilinmisIsaretle(aylar: string[]): Promise<void> {
  if (aylar.length === 0) return;
  await supabaseAdmin
    .from("vehicle_month_metrics")
    .update({ ham_silindi_at: new Date().toISOString() })
    .in("ay", aylar)
    .is("ham_silindi_at", null);
}
