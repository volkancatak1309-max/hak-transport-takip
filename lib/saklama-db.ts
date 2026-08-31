import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { buildFuelReport } from "@/lib/reports";
import { mapBounded } from "@/lib/db-fanout";
import {
  VARSAYILAN_SAKLAMA_AYARI,
  VARSAYILAN_UYARI_GUN,
  aralikDenetle,
  aySiniri,
  aylar,
  silmeKapisi,
  uyariCikarMi,
  uyariKesimi,
  type Aralik,
  type KategoriSatiri,
  type SaklamaAyari,
  type SaklamaUyarisi,
  type SilmeKapisi,
  type VeriKategorisi,
  type YasalEsik,
} from "@/lib/saklama";

/**
 * SAKLAMA — VERİ KATMANI (migration 090).
 *
 * ═══ 🔴 OTOMATİK SİLME YOK ═══
 *
 * Bu dosyada gün sayısına göre silen bir fonksiyon YOKTUR. Silme ARALIK alır
 * ve YALNIZ `manuelSil` üzerinden, denetim izi yazılarak yapılır. Gece koşan
 * iş `uyarilar()` çağırır ve durur.
 *
 * Neden: saklama süresi ve silme kararı veri SORUMLUSUNUNDUR (müşteri);
 * Galzura veri işleyendir.
 *
 * ═══ HAZIRLIK — SİLMEDEN ÖNCE, HER ZAMAN ═══
 *
 *   1. ÖMÜR İZİ   — aracın ilk/son telemetri anını ham akıştan bağımsız yaz
 *   2. AYLIK ÖZET — silinecek aralığın DEĞDİĞİ her ay için raporun cevabını dondur
 *   3. KM DONDUR  — aralıktaki vardiyaların km yargısını sabitle
 *
 * ⚠️ SIRA TARTIŞMA DIŞI. 3'ü silmeden sonra yapmak, düzeltmek istediği hatayı
 * kalıcılaştırır: ham gittikten sonra km kapısı her sıfır-farklı vardiyaya
 * sessizce "ölçülemedi" yazar.
 *
 * ⚠️ ÖZET RAPORUN KENDİ ÇIKTISIDIR. `buildFuelReport` ayın tamamı için TEK
 * pencere olarak çağrılıp sonucu yazılıyor — ikinci bir hesap YOK.
 */

const TABLO_YOK = new Set(["PGRST205", "42P01", "42703"]);
const tabloYokMu = (e: { code?: string; message?: string } | null) =>
  !!e && (TABLO_YOK.has(e.code ?? "") || /schema cache|does not exist/i.test(e.message ?? ""));

/** RPC yok = migration 090 çalıştırılmamış. */
const FONKSIYON_YOK = new Set(["PGRST202", "42883"]);
const fonksiyonYokMu = (e: { code?: string; message?: string } | null) =>
  !!e && (FONKSIYON_YOK.has(e.code ?? "") || /could not find the function/i.test(e.message ?? ""));

/**
 * Satırı ÜRETEN motorun sürümü. Okuma yolu bunu KULLANMIYOR — damgadır:
 * bayat satır ile taze satırı ayırt etmenin tek yolu.
 *
 * 090.1 → 095.1 (31.08.2026): 095 düşüş kapısını değiştirdi
 * (`odo - prev_odo < 1` → `between -1 and 1`), yani 095 öncesi bir motorla
 * yazılmış `dusus_sayisi`/`dusus_yuzde` bugünkü motorla üretilenden farklı
 * olurdu. Tablo bumpı yapıldığında ÜÇ KİRACIDA DA BOŞTU (ölçüldü: HAK61 0,
 * Sendigo 0 satır), yani geriye dönük karışık sürüm riski hiç doğmadı.
 */
export const HESAP_SURUMU = "095.1";

/** Uyarı ve silme yüzeyindeki ham tablolar. */
export const HAM_TABLOLAR = ["device_telemetry", "driver_locations"] as const;
export type HamTablo = (typeof HAM_TABLOLAR)[number];

// ═══════════════════════════ KİRACI AYARI ════════════════════════════════

export async function saklamaAyari(): Promise<SaklamaAyari> {
  const { data, error } = await supabaseAdmin
    .from("tenant_saklama")
    .select("uyari_gun, ulke_kodu, gerekce, updated_at")
    .eq("id", "singleton")
    .maybeSingle();

  if (error || !data) {
    return { ...VARSAYILAN_SAKLAMA_AYARI, tabloYok: tabloYokMu(error) };
  }
  const r = data as Record<string, unknown>;
  return {
    uyariGun: Number(r.uyari_gun ?? VARSAYILAN_UYARI_GUN),
    ulkeKodu: String(r.ulke_kodu ?? "AT"),
    gerekce: r.gerekce ? String(r.gerekce) : null,
    guncellendiAt: r.updated_at ? String(r.updated_at) : null,
    tabloYok: false,
  };
}

export async function saklamaAyariYaz(
  girdi: { uyariGun: number; ulkeKodu: string; gerekce: string | null },
  workerId: string | null
): Promise<{ ok: boolean; hata?: string }> {
  const { error } = await supabaseAdmin
    .from("tenant_saklama")
    .update({
      uyari_gun: girdi.uyariGun,
      ulke_kodu: girdi.ulkeKodu,
      gerekce: girdi.gerekce,
      updated_at: new Date().toISOString(),
      updated_by: workerId,
    })
    .eq("id", "singleton");
  if (error) return { ok: false, hata: tabloYokMu(error) ? "tablo_yok" : "hata" };
  return { ok: true };
}

// ═══════════════════════════ KATEGORİLER ═════════════════════════════════

export async function kategoriler(): Promise<KategoriSatiri[]> {
  const { data, error } = await supabaseAdmin
    .from("veri_kategorileri")
    .select("tablo_adi, kolon_adi, kategori, gerekce")
    .order("kategori")
    .order("tablo_adi");
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    tabloAdi: String(r.tablo_adi),
    kolonAdi: r.kolon_adi ? String(r.kolon_adi) : null,
    kategori: String(r.kategori) as VeriKategorisi,
    gerekce: String(r.gerekce ?? ""),
  }));
}

/**
 * Bir tablonun kategorisi.
 *
 * ⚠️ FAIL-CLOSED: kayıt YOKSA 'yasal_zorunlu' döner, yani silinemez. Bir
 * tabloyu sınıflandırmayı unutmak, onu yanlışlıkla silinebilir yapmamalı.
 */
export async function tabloKategorisi(tabloAdi: string): Promise<VeriKategorisi> {
  const { data, error } = await supabaseAdmin
    .from("veri_kategorileri")
    .select("kategori")
    .eq("tablo_adi", tabloAdi)
    .is("kolon_adi", null)
    .maybeSingle();
  if (error || !data) return "yasal_zorunlu";
  return String((data as Record<string, unknown>).kategori) as VeriKategorisi;
}

// ═══════════════════════════ YASAL EŞİK ══════════════════════════════════

/**
 * Ülke + veri türü için doğrulanmış yasal çıpa.
 *
 * ⚠️ Tablo BUGÜN BOŞ ve bu bilinçli — eşikler ayrı bir araştırma turuyla,
 * kaynak linki ve doğrulanma tarihiyle doldurulacak. `null` dönmesi bir hata
 * değil, "doğrulanmış çıpamız yok" beyanıdır.
 */
export async function yasalEsik(ulkeKodu: string, veriTuru: string): Promise<YasalEsik | null> {
  const { data, error } = await supabaseAdmin
    .from("saklama_esikleri")
    .select("ulke_kodu, veri_turu, esik_gun, yasal_dayanak, kaynak_url, dogrulanma_tarihi")
    .eq("ulke_kodu", ulkeKodu)
    .eq("veri_turu", veriTuru)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return {
    ulkeKodu: String(r.ulke_kodu),
    veriTuru: String(r.veri_turu),
    esikGun: r.esik_gun === null || r.esik_gun === undefined ? null : Number(r.esik_gun),
    yasalDayanak: r.yasal_dayanak ? String(r.yasal_dayanak) : null,
    kaynakUrl: r.kaynak_url ? String(r.kaynak_url) : null,
    dogrulanmaTarihi: r.dogrulanma_tarihi ? String(r.dogrulanma_tarihi) : null,
  };
}

// ═══════════════════════════ UYARI ═══════════════════════════════════════

/**
 * SİSTEMİN TEK ÇIKTISI — uyarı. Hiçbir şey silmez.
 *
 * ═══ 🔴 NEDEN RPC DEĞİL, TABLO BAŞINA AYRI SORGU ═══
 *
 * 090 `saklama_eski_satirlar` RPC'sini kuruyor (iki tabloyu `union all` ile
 * tek ifadede sayan bir fonksiyon). CANLIDA ÖLÇÜLDÜ (HAK61, 26.08.2026,
 * 1.620.323 satır):
 *
 *     RPC 1. çağrı (soğuk önbellek) : 8.388 ms → 57014 ZAMAN AŞIMI
 *     RPC 1. çağrı (ikinci deneme)  : 7.380 ms → geçti, ama sınırda
 *     RPC 2. çağrı (sıcak)          :   416 ms
 *
 * Sebep JENERİK PLAN DEĞİL — soğuk önbellek. Aynı sorgular tablo başına
 * ayrı ayrı çalıştırıldığında 218-1.219 ms sürüyor.
 *
 * 🔑 BELİRLEYİCİ OLGU: statement timeout (8 sn) İFADEYE uygulanır, çağrıya
 * değil (lib/reports.ts:1017'de de yazılı). Tek `union all` ifadesi iki
 * tablonun taramasını AYNI 8 saniyeye sıkıştırıyor; ayrı ifadeler her biri
 * kendi bütçesini alıyor.
 *
 * ⚠️ Gece koşan cron önbelleği HER ZAMAN soğuk bulur — o saatte o sayfalara
 * dokunan başka kimse yok. Yani "ikinci çağrı hızlı" tesellisi cron için
 * geçerli değil; ilk çağrı her gece ilk çağrıdır.
 *
 * İKİNCİ KAZANÇ — ARIZA YALITIMI: bir tablonun sorgusu düşerse diğeri
 * ayakta kalır ve o tablo için "ölçülemedi" denir. Tek ifadede bir tablonun
 * yavaşlığı DİĞERİNİN cevabını da götürüyordu; bu, "sessiz eksik YASAK"
 * kuralının ihlaliydi.
 *
 * RPC şemada duruyor (teşhis ve elle sorgu için kullanışlı), ürün yolu
 * ondan geçmiyor.
 */
export async function uyarilar(): Promise<{ uyarilar: SaklamaUyarisi[]; hata?: string }> {
  const ayar = await saklamaAyari();
  if (ayar.tabloYok) return { uyarilar: [], hata: "migration_090_yok" };

  const kesim = uyariKesimi(ayar.uyariGun).toISOString();
  const esik = await yasalEsik(ayar.ulkeKodu, "ham_konum");
  const simdi = Date.now();
  const out: SaklamaUyarisi[] = [];

  for (const tablo of HAM_TABLOLAR) {
    const kategori = await tabloKategorisi(tablo);
    if (!uyariCikarMi(kategori)) continue;

    // ── İFADE 1: kaç satır (kendi 8 sn bütçesi)
    const { count, error: sayimHata } = await supabaseAdmin
      .from(tablo)
      .select("id", { count: "exact", head: true })
      .lt("recorded_at", kesim);

    /**
     * ⚠️ ÖLÇÜLEMEDİ ≠ 0. Sayım düşerse bu tabloyu ATLAMIYORUZ ve 0 da
     * DEMİYORUZ — tabloyu yoksaymak, uyarıyı sessizce kaybetmek olurdu.
     * `satirSayisi: -1` diye bir şey de yok: satır listeye HİÇ girmiyor ve
     * çağıran `hata` alanından haberdar oluyor.
     */
    if (sayimHata) {
      if (tabloYokMu(sayimHata)) return { uyarilar: [], hata: "migration_090_yok" };
      return { uyarilar: out, hata: `${tablo}: ${sayimHata.message}` };
    }
    const satirSayisi = count ?? 0;
    if (satirSayisi === 0) continue; // sıfır satır uyarı DEĞİLDİR

    // ── İFADE 2: en eski kayıt (ayrı bütçe; yalnız satır VARSA sorulur)
    const { data: enEskiSatir } = await supabaseAdmin
      .from(tablo)
      .select("recorded_at")
      .lt("recorded_at", kesim)
      .order("recorded_at", { ascending: true })
      .limit(1);
    const enEski = enEskiSatir?.[0]
      ? String((enEskiSatir[0] as Record<string, unknown>).recorded_at)
      : null;

    out.push({
      tabloAdi: tablo,
      kategori,
      satirSayisi,
      enEski,
      enEskiGun: enEski ? Math.floor((simdi - new Date(enEski).getTime()) / 86_400_000) : null,
      uyariGun: ayar.uyariGun,
      ulkeKodu: ayar.ulkeKodu,
      // ⚠️ null = doğrulanmış çıpa yok. Ekran SAYI BASMAZ.
      yasalEsikGun: esik?.esikGun ?? null,
      yasalDayanak: esik?.yasalDayanak ?? null,
      kaynakUrl: esik?.kaynakUrl ?? null,
    });
  }

  return { uyarilar: out };
}

// ═══════════════════════════ 1 · ÖMÜR İZİ ════════════════════════════════

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

/**
 * Elde GERÇEKTEN bulunan en eski ham kayıt — rapor kapsam şeridinin çıpası.
 *
 * ⚠️ Çıpa artık uyarı eşiği DEĞİL. Otomatik silme olmadığı için "90 günden
 * eski veri yok" varsayımı YANLIŞ olurdu: kimse silmemişse veri orada durur
 * ve rapor doğru çalışır. Şerit yalnız GERÇEKTEN eksik olanı söyler.
 */
export async function hamVeriBaslangici(): Promise<Date | null> {
  const { data, error } = await supabaseAdmin
    .from("vehicle_telemetry_lifetime")
    .select("ilk_kayit")
    .not("ilk_kayit", "is", null)
    .order("ilk_kayit", { ascending: true })
    .limit(1);
  if (error || !data?.length) return null;
  const v = (data[0] as Record<string, unknown>).ilk_kayit;
  return v ? new Date(String(v)) : null;
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
 * Günlük parçalara bölüp toplamak yakıtı %15,6-28,9 şişiriyor (ÖLÇÜLDÜ).
 * Aylık tek pencerenin sapması %0,0 — çünkü bu, raporun kendi cevabı.
 *
 * ⚠️ ÜZERİNE YAZMAZ: ham satırları silinmiş bir araç/ay (`ham_silindi_at`
 * dolu) yeniden üretilemez; o satıra dokunulmaz.
 */
export async function ayOzetiYaz(ay: string): Promise<{ ok: boolean; sonuc?: AyOzetSonucu; hata?: string }> {
  const { bas, bit } = aySiniri(ay);

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

  const rapor = await buildFuelReport({ start: bas, end: bit });

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
   * SQL uçları (telemetry_month_spans) yalnız raporun ÜRETMEDİĞİ iki şey
   * için: kapsama sayımı ve pencere uçları. İkisini karıştırmak, özetin
   * raporla çelişmesine giden yol olurdu.
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

/** Verilen ARALIĞIN değdiği aylardan hangilerinin özeti yazılmamış? */
export async function ozetiEksikAylar(a: Aralik): Promise<{ eksik: string[]; hazir: string[]; hata?: string }> {
  const adaylar = aylar(a.bas, new Date(a.bit.getTime() - 1));
  if (adaylar.length === 0) return { eksik: [], hazir: [] };

  const { data, error } = await supabaseAdmin
    .from("vehicle_month_metrics")
    .select("ay")
    .in("ay", adaylar);
  if (error) return { eksik: adaylar, hazir: [], hata: tabloYokMu(error) ? "migration_090_yok" : error.message };

  const yazili = new Set(((data ?? []) as Record<string, unknown>[]).map((r) => String(r.ay)));
  return {
    eksik: adaylar.filter((x) => !yazili.has(x)),
    hazir: adaylar.filter((x) => yazili.has(x)),
  };
}

// ═══════════════════════════ 3 · KM DONDURMA ═════════════════════════════

/**
 * Kapanmış vardiyaların km yargısını dondurur.
 *
 * ⚠️ SIRA: silmeden ÖNCE. Sonra çalıştırılırsa ham gitmiş olur ve her
 * sıfır-farklı vardiyaya sessizce `false` yazar.
 *
 * Yargı, bugünkü kapının ta kendisi: sayaç farkı > 0 ise ölçülmüştür; fark 0
 * ise ham telemetride vardiya penceresinde hareket (speed_kmh >= 5) arayıp
 * karar verilir. Ham hâlâ elimizdeyken sorulduğu için cevap doğru.
 *
 * `aralik` verilirse yalnız o aralıktaki vardiyalar dondurulur — elle silme
 * bir ARALIK işi olduğu için tüm tabloyu taramak gereksiz.
 */
export async function kmDondur(
  aralik?: Aralik,
  limit = 2000
): Promise<{ ok: boolean; dondurulan: number; kalan: number; hata?: string }> {
  /**
   * test-visible: BAKIM TARAMASI — test vardiyaları BİLEREK dahil.
   *
   * Bu sorgu kullanıcıya bir SAYI göstermiyor; ham silinmeden önce her
   * kapanmış vardiyanın km yargısını sabitleyen bir bakım işi. Silme seçilen
   * aralığın TAMAMINI siler — test aracının satırlarını da. Test
   * vardiyalarını dışarıda bırakırsak onların yargısı silmeden SONRA sorulur
   * ve sessizce "ölçülemedi"ye düşer; yani muhafızın önlemeye çalıştığı
   * hatanın ta kendisini üretiriz.
   *
   * Ayrıca `kalan` sayacı silme kapısını açıyor: dondurmadan hariç tutulan
   * ama sayımda görünen bir satır kapıyı SONSUZA KADAR kapalı tutardı.
   */
  // test-visible: bakım taraması — gerekçe hemen yukarıda.
  let q = supabaseAdmin
    .from("time_entries")
    .select("id, started_at, ended_at, vehicle_id, start_km, end_km")
    .is("km_dondu", null)
    .not("ended_at", "is", null);
  if (aralik) {
    q = q.gte("started_at", aralik.bas.toISOString()).lt("started_at", aralik.bit.toISOString());
  }
  const { data, error } = await q.order("started_at", { ascending: true }).limit(limit);
  if (error) {
    return { ok: false, dondurulan: 0, kalan: 0, hata: tabloYokMu(error) ? "migration_090_yok" : error.message };
  }

  const satirlar = (data ?? []) as Record<string, unknown>[];
  if (satirlar.length === 0) return { ok: true, dondurulan: 0, kalan: await kmDonmamisSayisi(aralik) };

  const sonuclar = await mapBounded(
    satirlar,
    async (t: Record<string, unknown>) => {
      const bas = Number(t.start_km);
      const bit = Number(t.end_km);
      if (Number.isFinite(bas) && Number.isFinite(bit) && bit - bas > 0) {
        return { id: String(t.id), olculdu: true };
      }
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
    },
    6
  );

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

  return { ok: true, dondurulan: sonuclar.length, kalan: await kmDonmamisSayisi(aralik) };
}

export async function kmDonmamisSayisi(aralik?: Aralik): Promise<number> {
  // test-visible: silme kapısının sayacı — dondurma ile AYNI kümeye bakmak
  // ZORUNDA, yoksa hariç tutulan satır kapıyı sonsuza kadar kapalı tutar.
  let q = supabaseAdmin
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .is("km_dondu", null)
    .not("ended_at", "is", null);
  if (aralik) {
    q = q.gte("started_at", aralik.bas.toISOString()).lt("started_at", aralik.bit.toISOString());
  }
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

// ═══════════════════════════ HAZIRLIK ════════════════════════════════════

export type HazirlikDurumu = {
  omurIzi: number;
  eksikAylar: string[];
  hazirAylar: string[];
  kmDonmamis: number;
};

export async function hazirlikDurumu(a: Aralik): Promise<HazirlikDurumu> {
  const [omur, ozet, km] = await Promise.all([
    omurIziSayisi(),
    ozetiEksikAylar(a),
    kmDonmamisSayisi(a),
  ]);
  return { omurIzi: omur, eksikAylar: ozet.eksik, hazirAylar: ozet.hazir, kmDonmamis: km };
}

/** Hazırlığı ilerletir. ⚠️ HİÇBİR SATIR SİLMEZ. */
export async function hazirligiIlerlet(
  a: Aralik,
  ayTavani = 2
): Promise<{
  ok: boolean;
  hata?: string;
  omurIzi: number;
  ozetYazilan: string[];
  kmDondurulan: number;
  kmKalan: number;
}> {
  const bos = { omurIzi: 0, ozetYazilan: [] as string[], kmDondurulan: 0, kmKalan: 0 };
  const omur = await omurIziniTazele();
  if (!omur.ok) return { ok: false, hata: omur.hata, ...bos };

  const { eksik } = await ozetiEksikAylar(a);
  const yazilan: string[] = [];
  for (const ay of eksik.slice(0, ayTavani)) {
    const r = await ayOzetiYaz(ay);
    if (!r.ok) return { ok: false, hata: r.hata, ...bos, omurIzi: omur.satir, ozetYazilan: yazilan };
    yazilan.push(ay);
  }

  const km = await kmDondur(a);
  if (!km.ok) return { ok: false, hata: km.hata, ...bos, omurIzi: omur.satir, ozetYazilan: yazilan };

  return {
    ok: true,
    omurIzi: omur.satir,
    ozetYazilan: yazilan,
    kmDondurulan: km.dondurulan,
    kmKalan: km.kalan,
  };
}

// ═══════════════════════════ ELLE SİLME ══════════════════════════════════

const BATCH = 20_000;
const MAX_TUR = 25;

const SILME_RPC: Record<HamTablo, string> = {
  device_telemetry: "purge_telemetry_range",
  driver_locations: "purge_driver_locations_range",
};

/** Aralıktaki satır sayısı — silmeden ÖNCE göstermek için. */
export async function aralikSatirSayisi(tablo: HamTablo, a: Aralik): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(tablo)
    .select("id", { count: "exact", head: true })
    .gte("recorded_at", a.bas.toISOString())
    .lt("recorded_at", a.bit.toISOString());
  if (error) return 0;
  return count ?? 0;
}

export type SilmeSonucu = {
  ok: boolean;
  hata?: string;
  kuru: boolean;
  tablo: HamTablo;
  /** Kuru modda "silinecek", gerçek modda "silinen" satır sayısı. */
  satir: number;
  tur: number;
  kapi: SilmeKapisi;
};

/**
 * 🔴 ELLE SİLME — TEK SİLME YOLU.
 *
 * `kuru: true` iken HİÇBİR ŞEY silinmez, yalnız kaç satır gideceği sayılır ve
 * ön koşul kapısı gösterilir.
 *
 * Gerçek silmede ÖNCE denetim izi yazılır, SONRA silinir: iz yazılamıyorsa
 * silme de olmaz. Tersi sıra, izsiz bir silme bırakabilirdi.
 *
 * ⚠️ Kapı altı şartı da denetler (lib/saklama.ts silmeKapisi). Kategori
 * 'yasal_zorunlu' ise buraya hiç gelinmemesi gerekir — arayüz düğmeyi
 * ÇİZMEZ — ama kapı yine de SON SAVUNMA olarak duruyor.
 */
export async function manuelSil(girdi: {
  tablo: HamTablo;
  aralik: Aralik;
  sebep: string;
  onayMetni: string;
  workerId: string | null;
  kuru: boolean;
}): Promise<SilmeSonucu> {
  const { tablo, aralik, kuru } = girdi;

  const kategori = await tabloKategorisi(tablo);
  const hazirlik = await hazirlikDurumu(aralik);
  const kapi = silmeKapisi({
    kategori,
    aralikHatasi: aralikDenetle(aralik),
    ozetiEksikAylar: hazirlik.eksikAylar,
    kmDonmamisVardiya: hazirlik.kmDonmamis,
    omurIziSatir: hazirlik.omurIzi,
    // Kuru modda onay/sebep henüz istenmez; kapı yalnız ÖN KOŞULLARI göstersin
    // ki kullanıcı "SIL" yazmadan önce neyin eksik olduğunu görebilsin.
    onayMetni: kuru ? "SIL" : girdi.onayMetni,
    sebep: kuru ? "kuru mod on izleme" : girdi.sebep,
  });

  const sayi = await aralikSatirSayisi(tablo, aralik);

  if (kuru) return { ok: true, kuru: true, tablo, satir: sayi, tur: 0, kapi };
  if (!kapi.izin) {
    return { ok: false, hata: kapi.engel ?? "kapi", kuru: false, tablo, satir: 0, tur: 0, kapi };
  }

  // ⚠️ İZ ÖNCE. Silme geri alınamaz; iz yazılamıyorsa silme de olmamalı.
  const { error: izErr } = await supabaseAdmin.from("saklama_silme_izi").insert({
    silen_worker_id: girdi.workerId,
    tablo_adi: tablo,
    kategori,
    aralik_bas: aralik.bas.toISOString(),
    aralik_bit: aralik.bit.toISOString(),
    satir_sayisi: sayi,
    sebep: girdi.sebep.trim(),
    onay_metni: girdi.onayMetni.trim(),
  });
  if (izErr) {
    return {
      ok: false,
      hata: tabloYokMu(izErr) ? "migration_090_yok" : `iz_yazilamadi: ${izErr.message}`,
      kuru: false,
      tablo,
      satir: 0,
      tur: 0,
      kapi,
    };
  }

  let silinen = 0;
  let tur = 0;
  for (; tur < MAX_TUR; tur++) {
    const { data, error } = await supabaseAdmin.rpc(SILME_RPC[tablo], {
      p_from: aralik.bas.toISOString(),
      p_to: aralik.bit.toISOString(),
      p_limit: BATCH,
    });
    if (error) {
      return {
        ok: false,
        hata: fonksiyonYokMu(error) ? "migration_090_yok" : error.message,
        kuru: false,
        tablo,
        satir: silinen,
        tur,
        kapi,
      };
    }
    const n = Number(data ?? 0);
    silinen += n;
    if (n < BATCH) {
      tur++;
      break;
    }
  }

  // Ham verisi giden ayları işaretle — özet artık YENİDEN ÜRETİLEMEZ.
  if (tablo === "device_telemetry") {
    await aylariSilinmisIsaretle(aylar(aralik.bas, new Date(aralik.bit.getTime() - 1)));
  }

  return { ok: true, kuru: false, tablo, satir: silinen, tur, kapi };
}

export async function aylariSilinmisIsaretle(aylarListe: string[]): Promise<void> {
  if (aylarListe.length === 0) return;
  await supabaseAdmin
    .from("vehicle_month_metrics")
    .update({ ham_silindi_at: new Date().toISOString() })
    .in("ay", aylarListe)
    .is("ham_silindi_at", null);
}

// ═══════════════════════════ DENETİM İZİ ═════════════════════════════════

export type SilmeIziSatiri = {
  id: string;
  silenAd: string | null;
  silindiAt: string;
  tabloAdi: string;
  kategori: string;
  aralikBas: string;
  aralikBit: string;
  satirSayisi: number;
  sebep: string;
};

export async function silmeIzi(limit = 50): Promise<SilmeIziSatiri[]> {
  const { data, error } = await supabaseAdmin
    .from("saklama_silme_izi")
    .select("id, silen_worker_id, silindi_at, tablo_adi, kategori, aralik_bas, aralik_bit, satir_sayisi, sebep")
    .order("silindi_at", { ascending: false })
    .limit(limit);
  if (error) return [];

  const satirlar = (data ?? []) as Record<string, unknown>[];
  /**
   * Şoför adı TÜRETİLMİŞ: izde yalnız kimlik duruyor. Adı ize yazmak, adı
   * değişen bir kullanıcıda geçmişi yanlış gösterirdi (aynı ders 084'te).
   */
  const idler = [...new Set(satirlar.map((r) => r.silen_worker_id).filter(Boolean).map(String))];
  const adlar = new Map<string, string>();
  if (idler.length) {
    const { data: w } = await supabaseAdmin.from("workers").select("id, name").in("id", idler);
    for (const x of (w ?? []) as Record<string, unknown>[]) adlar.set(String(x.id), String(x.name));
  }

  return satirlar.map((r) => ({
    id: String(r.id),
    silenAd: r.silen_worker_id ? adlar.get(String(r.silen_worker_id)) ?? null : null,
    silindiAt: String(r.silindi_at),
    tabloAdi: String(r.tablo_adi),
    kategori: String(r.kategori),
    aralikBas: String(r.aralik_bas),
    aralikBit: String(r.aralik_bit),
    satirSayisi: Number(r.satir_sayisi ?? 0),
    sebep: String(r.sebep ?? ""),
  }));
}
