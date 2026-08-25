import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu } from "@/lib/fault-reports";
import { viennaDayKey } from "@/lib/format";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { lastRecordedAtBatch, lastRecordedAt } from "@/lib/telemetry";
import { buildPerformanceReport, buildFuelReport } from "@/lib/reports";
import { listExpiringDocuments } from "@/lib/documents-db";
import { bakimDurumlari } from "@/lib/bakim-db";
import { listIsEmirleri } from "@/lib/is-emri-db";
import {
  adaylariSec,
  haftaBasi,
  kuralBakimGecikti,
  kuralBelgeBitiyor,
  kuralIsEmriBekliyor,
  kuralSessizArac,
  kuralSkorDususu,
  kuralVardiyaKapanmadi,
  kuralYakitSapmasi,
  susturulmusMu,
  BELGE_ESIK_GUN,
  IS_EMRI_ESIK_GUN,
  SESSIZ_ESIK_SAAT,
  SKOR_DUSUS_ESIK,
  VARDIYA_KAPANMAMA_YUZDE,
  YAKIT_MIN_ARAC,
  YAKIT_PENCERE_GUN,
  YAKIT_SAPMA_YUZDE,
  type AksiyonAdayi,
  type SusturmaKaydi,
  type Tarama,
} from "@/lib/haftalik-aksiyon";

/**
 * HAFTALIK AKSİYON — VERİ KATMANI (migration 084).
 *
 * ═══ İKİ DOSYA, İKİ SORUMLULUK ═══
 *
 * `lib/haftalik-aksiyon.ts` SAF: eşikler, kurallar, öncelik, seçim. Sorgu yok.
 * Bu dosya TOPLAR ve YAZAR: sinyalleri okur, saf kurallara verir, sonucu
 * kaydeder. Kuralları buraya koymak, onları canlı veritabanı olmadan
 * sınanamaz hâle getirirdi.
 *
 * ═══ KAPI BURADA YOK ═══
 *
 * Çağıran yetkiyi KENDİ denetler (cron sırrı ya da `requireFleetView`).
 * lib/sefer-db.ts ile aynı kural.
 *
 * ═══ 084 YOKSA ÖZELLİK KAPALI, PANEL ÇALIŞIR ═══
 *
 * Okumalar `tabloYok` döndürüyor; ekran "bu kurulumda kapalı" der.
 */

const TUR_COLS =
  "id, hafta_basi, uretildi_at, tarama, aksiyon_sayisi, elenen_sayisi, bildirim_alici, bildirim_jeton, bildirim_hata, created_at";
const AKSIYON_COLS =
  "id, tur_id, kural, worker_id, vehicle_id, oncelik, baslik, gerekce, kanit, hedef_yol, durum, kapatan, kapatildi_at, kapatma_notu, created_at";

export type HaftalikTur = {
  id: string;
  haftaBasi: string;
  uretildiAt: string;
  tarama: Tarama;
  aksiyonSayisi: number;
  elenenSayisi: number;
  /** NULL = bildirim DENENMEDİ (turu cron dışı bir yol üretti). 0 = denendi, cihaz yok. */
  bildirimAlici: number | null;
  bildirimJeton: number | null;
  bildirimHata: string | null;
};

export type HaftalikAksiyon = {
  id: string;
  turId: string;
  kural: string;
  workerId: string | null;
  vehicleId: string | null;
  oncelik: number;
  baslik: string;
  gerekce: string;
  kanit: Record<string, unknown>;
  hedefYol: string | null;
  durum: "acik" | "yapildi" | "ilgisiz";
  kapatan: string | null;
  kapatildiAt: string | null;
  kapatmaNotu: string | null;
};

function turCevir(r: Record<string, unknown>): HaftalikTur {
  return {
    id: String(r.id),
    haftaBasi: String(r.hafta_basi),
    uretildiAt: String(r.uretildi_at),
    tarama: (r.tarama ?? {}) as Tarama,
    aksiyonSayisi: Number(r.aksiyon_sayisi ?? 0),
    elenenSayisi: Number(r.elenen_sayisi ?? 0),
    bildirimAlici: r.bildirim_alici === null || r.bildirim_alici === undefined ? null : Number(r.bildirim_alici),
    bildirimJeton: r.bildirim_jeton === null || r.bildirim_jeton === undefined ? null : Number(r.bildirim_jeton),
    bildirimHata: r.bildirim_hata ? String(r.bildirim_hata) : null,
  };
}

function aksiyonCevir(r: Record<string, unknown>): HaftalikAksiyon {
  return {
    id: String(r.id),
    turId: String(r.tur_id),
    kural: String(r.kural),
    workerId: r.worker_id ? String(r.worker_id) : null,
    vehicleId: r.vehicle_id ? String(r.vehicle_id) : null,
    oncelik: Number(r.oncelik),
    baslik: String(r.baslik),
    gerekce: String(r.gerekce),
    kanit: (r.kanit ?? {}) as Record<string, unknown>,
    hedefYol: r.hedef_yol ? String(r.hedef_yol) : null,
    durum: String(r.durum) as HaftalikAksiyon["durum"],
    kapatan: r.kapatan ? String(r.kapatan) : null,
    kapatildiAt: r.kapatildi_at ? String(r.kapatildi_at) : null,
    kapatmaNotu: r.kapatma_notu ? String(r.kapatma_notu) : null,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// OKUMA
// ══════════════════════════════════════════════════════════════════════════

export async function listTurlar(
  limit = 12
): Promise<{ turlar: HaftalikTur[]; tabloYok: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("haftalik_aksiyon_turlari")
    .select(TUR_COLS)
    .order("hafta_basi", { ascending: false })
    .limit(limit);
  if (error) return { turlar: [], tabloYok: tabloYokMu(error) };
  return { turlar: ((data ?? []) as Record<string, unknown>[]).map(turCevir), tabloYok: false };
}

export async function getTur(
  haftaBasiGunu?: string
): Promise<{ tur: HaftalikTur | null; aksiyonlar: HaftalikAksiyon[]; tabloYok: boolean }> {
  let q = supabaseAdmin.from("haftalik_aksiyon_turlari").select(TUR_COLS);
  q = haftaBasiGunu
    ? q.eq("hafta_basi", haftaBasiGunu)
    : q.order("hafta_basi", { ascending: false }).limit(1);
  const { data, error } = await q;
  if (error) return { tur: null, aksiyonlar: [], tabloYok: tabloYokMu(error) };
  const satir = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!satir) return { tur: null, aksiyonlar: [], tabloYok: false };

  const tur = turCevir(satir);
  const { data: aData } = await supabaseAdmin
    .from("haftalik_aksiyonlar")
    .select(AKSIYON_COLS)
    .eq("tur_id", tur.id)
    .order("oncelik", { ascending: false });
  return {
    tur,
    aksiyonlar: ((aData ?? []) as Record<string, unknown>[]).map(aksiyonCevir),
    tabloYok: false,
  };
}

/**
 * SUSTURMA KAYITLARI — "ilgisiz" kapatmaların EN SONU, kural+özne başına.
 *
 * Ayrı bir susturma tablosu YOK (084 başlığı): kayıt aksiyonların kendisinden
 * türetiliyor. Kısmi indeks (`idx_haftalik_aksiyon_ilgisiz`) bu sorguyu
 * karşılıyor — açık ve yapılmış kalemler taranmıyor.
 */
export async function susturmaKayitlari(): Promise<SusturmaKaydi[]> {
  const { data, error } = await supabaseAdmin
    .from("haftalik_aksiyonlar")
    .select("kural, worker_id, vehicle_id, kapatildi_at")
    .eq("durum", "ilgisiz")
    .order("kapatildi_at", { ascending: false })
    .limit(500);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    kural: String(r.kural),
    ozneId: r.worker_id ? String(r.worker_id) : r.vehicle_id ? String(r.vehicle_id) : null,
    kapatildiAt: String(r.kapatildi_at),
  }));
}

// ══════════════════════════════════════════════════════════════════════════
// KAPATMA
// ══════════════════════════════════════════════════════════════════════════

export type KapatmaSonuc =
  | { ok: true }
  | { ok: false; sebep: "yok" | "zaten_kapali" | "tablo_yok" | "hata"; mesaj?: string };

/**
 * AKSİYONU KAPAT — "yaptım" ya da "ilgisiz".
 *
 * ⚠️ İKİNCİ KAPATMA REDDEDİLİR (`durum = 'acik'` koşulu). İzin verilseydi
 * "yaptım" dediğiniz bir kalem sonradan "ilgisiz"e çevrilebilir ve susturma
 * penceresi geriye dönük açılırdı — kararın kendisi değişirdi.
 */
export async function aksiyonKapat(
  id: string,
  durum: "yapildi" | "ilgisiz",
  actorWorkerId: string | null,
  not?: string | null
): Promise<KapatmaSonuc> {
  const temizNot = (not ?? "").trim();
  const { data, error } = await supabaseAdmin
    .from("haftalik_aksiyonlar")
    .update({
      durum,
      kapatan: actorWorkerId,
      kapatildi_at: new Date().toISOString(),
      kapatma_notu: temizNot ? temizNot.slice(0, 300) : null,
    })
    .eq("id", id)
    .eq("durum", "acik")
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error.message };
  }
  if (!data) {
    // Satır yok ya da zaten kapalı — ikisini ayırmak için tek ek okuma.
    const { data: v } = await supabaseAdmin
      .from("haftalik_aksiyonlar")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    return { ok: false, sebep: v ? "zaten_kapali" : "yok" };
  }
  return { ok: true };
}

// ══════════════════════════════════════════════════════════════════════════
// ÜRETİM
// ══════════════════════════════════════════════════════════════════════════

export type UretimSonuc =
  | {
      ok: true;
      turId: string;
      haftaBasi: string;
      secilen: AksiyonAdayi[];
      elenen: number;
      tarama: Tarama;
      /** Tur zaten vardı — hiçbir şey yazılmadı. */
      zatenVardi: boolean;
    }
  | { ok: false; sebep: "tablo_yok" | "hata"; mesaj?: string };

const GUN_MS = 86_400_000;

/**
 * HAFTALIK TURU ÜRET.
 *
 * ═══ TEK GEÇİŞ, YEDİ KURAL ═══
 *
 * Her kural kendi try/catch'inde: bir sinyal okunamazsa (migration yok, RPC
 * yok) tur DÜŞMEZ, o kural `atlandi` sayacıyla işaretlenir. Bir kuralın
 * arızası diğer altısını sessizce yok etmemeli.
 *
 * ═══ HAFTADA TAM 1 ═══
 *
 * `hafta_basi` tekil. Tur zaten varsa hiçbir şey yazılmaz ve `zatenVardi`
 * döner — bakim-alerts'in "günde tam 1" deseninin haftalık karşılığı. Cron
 * iki kez tetiklenirse ikinci koşum panelin içeriğini DEĞİŞTİRMEZ; kapatılmış
 * kalemler geri gelmez.
 */
export async function haftalikTuruUret(simdi: Date = new Date()): Promise<UretimSonuc> {
  const hafta = haftaBasi(viennaDayKey(simdi));

  // ── Tur zaten var mı
  const { data: mevcut, error: mevcutHata } = await supabaseAdmin
    .from("haftalik_aksiyon_turlari")
    .select("id")
    .eq("hafta_basi", hafta)
    .maybeSingle();
  if (mevcutHata && tabloYokMu(mevcutHata)) return { ok: false, sebep: "tablo_yok" };
  if (mevcut) {
    return {
      ok: true,
      turId: String((mevcut as { id: string }).id),
      haftaBasi: hafta,
      secilen: [],
      elenen: 0,
      tarama: {},
      zatenVardi: true,
    };
  }

  const { adaylar, tarama } = await adaylariTopla(simdi);

  // ── SEÇİM — tavan + çeşitlilik (saf katman)
  const { secilen, elenen } = adaylariSec(adaylar);

  // ── YAZ
  const { data: turData, error: turHata } = await supabaseAdmin
    .from("haftalik_aksiyon_turlari")
    .insert({
      hafta_basi: hafta,
      tarama,
      aksiyon_sayisi: secilen.length,
      elenen_sayisi: elenen.length,
    })
    .select("id")
    .maybeSingle();
  if (turHata || !turData) {
    return {
      ok: false,
      sebep: turHata && tabloYokMu(turHata) ? "tablo_yok" : "hata",
      mesaj: turHata?.message,
    };
  }
  const turId = String((turData as { id: string }).id);

  if (secilen.length > 0) {
    const { error: aHata } = await supabaseAdmin.from("haftalik_aksiyonlar").insert(
      secilen.map((a) => ({
        tur_id: turId,
        kural: a.kural,
        worker_id: a.workerId,
        vehicle_id: a.vehicleId,
        oncelik: a.oncelik,
        baslik: a.baslik.slice(0, 200),
        gerekce: a.gerekce.slice(0, 500),
        kanit: a.kanit,
        hedef_yol: a.hedefYol,
      }))
    );
    if (aHata) {
      /**
       * ⚠️ TUR YAZILDI AMA KALEMLER YAZILAMADI → TURU SİL.
       *
       * Yarım bir hafta bırakmak en kötü sonuç olurdu: `hafta_basi` tekil
       * olduğu için o hafta bir daha ÜRETİLEMEZ ve panel kalıcı olarak boş
       * bir tur gösterirdi ("koştu, temiz" diye okunur — oysa arıza var).
       */
      await supabaseAdmin.from("haftalik_aksiyon_turlari").delete().eq("id", turId);
      return { ok: false, sebep: "hata", mesaj: aHata.message };
    }
  }

  return {
    ok: true,
    turId,
    haftaBasi: hafta,
    secilen,
    elenen: elenen.length,
    tarama,
    zatenVardi: false,
  };
}

/**
 * KURU KOŞUM — üretir, YAZMAZ, bildirmez.
 *
 * Yeni bir kiracıda "kurallar ne çıkarıyor, eşikler yerinde mi" sorusu canlıya
 * satır yazmadan cevaplanabilsin diye. `haftalikTuruUret` ile AYNI toplama
 * fonksiyonunu çağırıyor — iki ayrı gerçek doğmasın.
 */
export async function haftalikKuruKosum(
  simdi: Date = new Date()
): Promise<{ haftaBasi: string; tarama: Tarama; secilen: AksiyonAdayi[]; elenen: AksiyonAdayi[] }> {
  const { adaylar, tarama } = await adaylariTopla(simdi);
  const { secilen, elenen } = adaylariSec(adaylar);
  return { haftaBasi: haftaBasi(viennaDayKey(simdi)), tarama, secilen, elenen };
}

/**
 * YEDİ KURALI ÇALIŞTIR, ADAYLARI TOPLA — yazma YOK.
 *
 * Her kural kendi try/catch'inde: bir sinyal okunamazsa (migration yok, RPC
 * yok) toplama DÜŞMEZ, o kural `atlandi` sayacıyla işaretlenir. Bir kuralın
 * arızası diğer altısını sessizce yok etmemeli.
 */
async function adaylariTopla(
  simdi: Date
): Promise<{ adaylar: AksiyonAdayi[]; tarama: Tarama }> {
  const tarama: Tarama = {};
  const adaylar: AksiyonAdayi[] = [];
  const susturmalar = await susturmaKayitlari();

  /** Kuralı çalıştırır; hata olursa turu düşürmez, `atlandi` yazar. */
  const kuralKos = async (
    ad: keyof Tarama,
    esik: string,
    is: () => Promise<{ aday: number; cikanlar: (AksiyonAdayi | null)[] }>
  ) => {
    try {
      const { aday, cikanlar } = await is();
      const gecen = cikanlar.filter(Boolean) as AksiyonAdayi[];
      // Susturulmuş kalemler ÜRETİLMEZ ama "geçen" sayısına girer: eşiği
      // geçtiler, yalnız gösterilmiyorlar. Sayacın anlamı "eşiği geçen".
      for (const a of gecen) {
        if (!susturulmusMu(susturmalar, a.kural, a.workerId ?? a.vehicleId, simdi)) {
          adaylar.push(a);
        }
      }
      tarama[ad] = { aday, gecen: gecen.length, esik };
    } catch (e) {
      tarama[ad] = { aday: 0, gecen: 0, esik, atlandi: String((e as Error).message).slice(0, 120) };
    }
  };

  const test = await getTestScope();

  // ── 1) SKOR DÜŞÜŞÜ — iki ardışık haftalık pencere
  await kuralSkorKos(kuralKos, simdi);

  // ── 2) YAKIT SAPMASI
  await kuralKos("yakit_sapmasi", `filo ort +%${YAKIT_SAPMA_YUZDE} (${YAKIT_PENCERE_GUN} gün)`, async () => {
    const rapor = await buildFuelReport({
      start: new Date(simdi.getTime() - YAKIT_PENCERE_GUN * GUN_MS),
      end: simdi,
    });
    const olculen = (rapor.rows ?? []).filter(
      (r) => r.lPer100Km !== null && r.lPer100Km > 0 && !r.dataUnreliable
    );
    if (olculen.length < YAKIT_MIN_ARAC) {
      throw new Error(`ölçülebilir araç ${olculen.length} < ${YAKIT_MIN_ARAC}`);
    }
    const ort = olculen.reduce((a, r) => a + (r.lPer100Km ?? 0), 0) / olculen.length;
    return {
      aday: olculen.length,
      cikanlar: olculen.map((r) =>
        kuralYakitSapmasi({
          vehicleId: r.vehicleId,
          plaka: r.plate,
          lPer100Km: r.lPer100Km!,
          filoOrtalama: ort,
          ornekSayisi: r.sampleCount,
        })
      ),
    };
  });

  // ── 3) SESSİZ ARAÇ
  await kuralKos("sessiz_arac", `${SESSIZ_ESIK_SAAT} saat`, async () => {
    const { data } = await withoutTestRows(
      supabaseAdmin
        .from("vehicles")
        .select("id, plate, flespi_device_id, imei")
        .neq("status", "inactive"),
      "id",
      test.vehicleIds
    );
    const cihazli = ((data ?? []) as {
      id: string;
      plate: string;
      flespi_device_id: number | null;
      imei: string | null;
    }[]).filter((v) => !test.isTestVehicle(v.id) && (v.flespi_device_id || v.imei));

    const imlec = await lastRecordedAtBatch(cihazli.map((v) => v.id));
    const cikanlar: (AksiyonAdayi | null)[] = [];
    for (const v of cihazli) {
      const son = imlec ? (imlec.get(v.id) ?? null) : await lastRecordedAt(v.id);
      const saat = son ? (simdi.getTime() - Date.parse(son)) / 3_600_000 : null;
      cikanlar.push(kuralSessizArac({ vehicleId: v.id, plaka: v.plate, sessizSaat: saat }));
    }
    return { aday: cihazli.length, cikanlar };
  });

  // ── 4) BELGE
  await kuralKos("belge_bitiyor", `${BELGE_ESIK_GUN} gün`, async () => {
    const { items, tabloYok } = await listExpiringDocuments(null, simdi);
    if (tabloYok) throw new Error("worker_documents yok (078)");
    return {
      aday: items.length,
      cikanlar: items.map((d) =>
        kuralBelgeBitiyor({
          workerId: d.workerId,
          ad: d.workerName,
          belgeTuru: d.typeLabel,
          kalanGun: d.days,
          sonTarih: d.expiresAt.slice(0, 10),
        })
      ),
    };
  });

  // ── 5) BAKIM
  await kuralKos("bakim_gecikti", "bakım anı geçti", async () => {
    const { durumlar, tabloYok } = await bakimDurumlari(simdi);
    if (tabloYok) throw new Error("bakim_planlari yok (081)");
    return {
      aday: durumlar.length,
      cikanlar: durumlar.map((d) =>
        kuralBakimGecikti({
          vehicleId: d.vehicleId,
          plaka: d.plaka,
          tip: d.tip,
          eksen: d.eksen,
          kalanKm: d.kalanKm,
          kalanGun: d.kalanGun,
          gecti: d.gecti,
        })
      ),
    };
  });

  // ── 6) İŞ EMRİ
  await kuralKos("is_emri_bekliyor", `${IS_EMRI_ESIK_GUN} gün`, async () => {
    const { emirler, tabloYok } = await listIsEmirleri({ yalnizAcik: true, limit: 200 });
    if (tabloYok) throw new Error("vehicle_fault_reports yok (056/057)");
    return {
      aday: emirler.length,
      cikanlar: emirler.map((e) =>
        kuralIsEmriBekliyor({
          emirId: e.id,
          vehicleId: e.vehicleId,
          plaka: e.plaka,
          aciklama: e.aciklama,
          yasGun: Math.floor((simdi.getTime() - Date.parse(e.createdAt)) / GUN_MS),
          oncelikEtiketi: String(e.oncelik),
        })
      ),
    };
  });

  // ── 7) VARDİYA KAPANMAMA (filo geneli)
  await kuralKos("vardiya_kapanmadi", `%${VARDIYA_KAPANMAMA_YUZDE}`, async () => {
    /**
     * TEST VARDİYALARI ORANI BOZAR. Bu kural filo GENELİ bir oran ("kapanmayan
     * / toplam") üretiyor; kalıcı test hesabının vardiyaları paydayı da payı da
     * kirletir. Eleme sorguda: muhafız da görebilsin.
     */
    const { data } = await withoutTestRows(
      supabaseAdmin
        .from("time_entries")
        .select("id, ended_at")
        .gte("started_at", new Date(simdi.getTime() - 7 * GUN_MS).toISOString())
        .limit(2000),
      "worker_id",
      test.workerIds
    );
    const satirlar = (data ?? []) as { id: string; ended_at: string | null }[];
    return {
      aday: satirlar.length,
      cikanlar: [
        kuralVardiyaKapanmadi({
          toplam: satirlar.length,
          kapanmayan: satirlar.filter((t) => !t.ended_at).length,
        }),
      ],
    };
  });

  return { adaylar, tarama };
}

/**
 * SKOR KURALI — iki ardışık HAFTALIK pencere.
 *
 * Ayrı fonksiyon çünkü İKİ rapor koşturuyor ve ikisinin kesişimini alıyor;
 * `kuralKos` sarmalayıcısının içine sığdırmak okunmaz olurdu.
 */
async function kuralSkorKos(
  kuralKos: (
    ad: keyof Tarama,
    esik: string,
    is: () => Promise<{ aday: number; cikanlar: (AksiyonAdayi | null)[] }>
  ) => Promise<void>,
  simdi: Date
): Promise<void> {
  await kuralKos("skor_dususu", `${SKOR_DUSUS_ESIK} puan (2 pencere)`, async () => {
    const pencere = (k: number) => ({
      start: new Date(simdi.getTime() - 7 * (k + 1) * GUN_MS),
      end: new Date(simdi.getTime() - 7 * k * GUN_MS),
    });
    const [bu, gecen, onceki] = await Promise.all([
      buildPerformanceReport(pencere(0)),
      buildPerformanceReport(pencere(1)),
      buildPerformanceReport(pencere(2)),
    ]);
    const skorlu = (r: Awaited<ReturnType<typeof buildPerformanceReport>>) =>
      new Map(r.rows.filter((x) => x.safetyScore !== null).map((x) => [x.workerId, x]));
    const m0 = skorlu(bu);
    const m1 = skorlu(gecen);
    const m2 = skorlu(onceki);

    // Aday = İKİ ardışık pencerede de skoru olan şoförler.
    const ortak = [...m0.keys()].filter((id) => m1.has(id));
    return {
      aday: ortak.length,
      cikanlar: ortak.map((id) =>
        kuralSkorDususu({
          workerId: id,
          ad: m0.get(id)!.name,
          buHafta: m0.get(id)!.safetyScore!,
          gecenHafta: m1.get(id)!.safetyScore!,
          oncekiHafta: m2.get(id)?.safetyScore ?? null,
        })
      ),
    };
  });
}

/** Turun bildirim sonucunu kaydeder — gönderim ÇAĞIRANDA (cron). */
export async function bildirimSonucuYaz(
  turId: string,
  sonuc: { alici: number; jeton: number; hata: string | null }
): Promise<void> {
  await supabaseAdmin
    .from("haftalik_aksiyon_turlari")
    .update({
      bildirim_alici: sonuc.alici,
      bildirim_jeton: sonuc.jeton,
      bildirim_hata: sonuc.hata,
    })
    .eq("id", turId);
}
