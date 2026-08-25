import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { mapBounded } from "@/lib/db-fanout";
import { resolveCostRates } from "@/lib/cost-rates-db";
import { AZG_DAILY_MAX_MS } from "@/lib/azg-rules";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import {
  ODO_KENAR_ESIK_MS,
  ZARAR_MIN_SEFER,
  ZARAR_PENCERE_GUN,
  eksendeTopla,
  seferKarliligiHesapla,
  seferMaliyetiHesapla,
  uclar,
  type GelirModeli,
  type GelirSatiri,
  type KarlilikSatiri,
  type KmOlcumDurumu,
  type MiktarKaynak,
  type SeferKarliligi,
} from "@/lib/karlilik";

/**
 * SEFER KÂRLILIĞI — VERİ KATMANI (migration 085).
 *
 * Saf hesap `lib/karlilik.ts`te. Burada yalnız ÖLÇÜM ve TOPLAMA var.
 *
 * ⚠️ Bu dosyadaki hiçbir yol `time_entries`, `device_telemetry` ya da
 * `tenant_cost_rates` tablolarına YAZMAZ. Maliyet motoru (076/077) salt
 * okunur: €/km raporu bu dosyadan etkilenmez.
 */

const TABLO_YOK = new Set(["PGRST205", "42P01"]);
const tabloYokMu = (e: { code?: string; message?: string } | null) =>
  !!e && (TABLO_YOK.has(e.code ?? "") || /schema cache|does not exist/i.test(e.message ?? ""));

export type MusteriRow = {
  id: string;
  ad: string;
  kod: string | null;
  vergiNo: string | null;
  adres: string | null;
  iletisim: string | null;
  notlar: string | null;
  aktif: boolean;
};

function musteriCevir(r: Record<string, unknown>): MusteriRow {
  return {
    id: String(r.id),
    ad: String(r.ad),
    kod: r.kod ? String(r.kod) : null,
    vergiNo: r.vergi_no ? String(r.vergi_no) : null,
    adres: r.adres ? String(r.adres) : null,
    iletisim: r.iletisim ? String(r.iletisim) : null,
    notlar: r.notlar ? String(r.notlar) : null,
    aktif: r.aktif !== false,
  };
}

export async function listMusteriler(
  hepsi = false
): Promise<{ satirlar: MusteriRow[]; tabloYok: boolean }> {
  let q = supabaseAdmin.from("musteriler").select("*").order("ad");
  if (!hepsi) q = q.eq("aktif", true);
  const { data, error } = await q;
  if (error) return { satirlar: [], tabloYok: tabloYokMu(error) };
  return { satirlar: (data ?? []).map((r) => musteriCevir(r as Record<string, unknown>)), tabloYok: false };
}

// ═══════════════════ SEFER KM'Sİ — ODOMETRE PENCERESİ ════════════════════

export type KmOlcum = {
  km: number | null;
  durum: KmOlcumDurumu;
  /** Uç okumalarının pencere kenarına uzaklığı (dk) — kanıt olarak gösterilir. */
  basSapmaDk: number | null;
  bitSapmaDk: number | null;
};

const OLCULEMEDI = (durum: KmOlcumDurumu): KmOlcum => ({
  km: null,
  durum,
  basSapmaDk: null,
  bitSapmaDk: null,
});

/**
 * Odometre değerini makul km'ye indirger.
 *
 * `lib/auto-shift.ts`teki `normalizeOdometerKm` ile AYNI kuralı uygular ama
 * oradaki fonksiyon dışa açık değil ve o dosyayı bu iş için değiştirmek
 * vardiya motoruna dokunmak olurdu. Kural tek cümle: bazı kurulumlar METRE
 * raporluyor, makul aralığı aşan değer önce /1000 denenir.
 */
const MAX_ODOMETER_KM = 3_000_000;
function odoNormalize(o: unknown): number | null {
  const v0 = typeof o === "number" ? o : Number(o);
  if (!Number.isFinite(v0) || v0 <= 0) return null;
  const v = v0 > MAX_ODOMETER_KM ? v0 / 1000 : v0;
  return v > 0 && v <= MAX_ODOMETER_KM ? v : null;
}

async function odoUcOkumasi(
  vehicleId: string,
  an: string,
  yon: "ilk" | "son"
): Promise<{ km: number; at: string } | null> {
  const temel = supabaseAdmin
    .from("device_telemetry")
    .select("odometer_km, recorded_at")
    .eq("vehicle_id", vehicleId)
    .not("odometer_km", "is", null)
    .limit(1);

  const { data, error } =
    yon === "ilk"
      ? await temel.gte("recorded_at", an).order("recorded_at", { ascending: true })
      : await temel.lte("recorded_at", an).order("recorded_at", { ascending: false });

  if (error || !data?.[0]) return null;
  const km = odoNormalize((data[0] as { odometer_km: unknown }).odometer_km);
  if (km === null) return null;
  return { km, at: String((data[0] as { recorded_at: string }).recorded_at) };
}

/**
 * SEFER KM'Sİ — odometre farkı, telemetri integrali DEĞİL.
 *
 * ÖLÇÜLDÜ (HAK61, 14 gün, 15 pencere): odometre/sayaç oranı medyan 1,032;
 * telemetri integrali medyan 0,871 — HER pencerede eksik saydı (bir tanesinde
 * −%53). Eksik km → eksik yakıt → ŞİŞMİŞ kâr. Kârlılıkta bu yön yanlıştır.
 *
 * İki uç okuması da pencere kenarına `ODO_KENAR_ESIK_MS` içinde olmalı;
 * değilse "ölçülemedi" döner — 0 DEĞİL.
 */
export async function seferKmOlc(
  vehicleId: string | null,
  bas: string | null,
  bit: string | null
): Promise<KmOlcum> {
  if (!vehicleId) return OLCULEMEDI("arac_yok");
  if (!bas || !bit) return OLCULEMEDI("pencere_yok");
  if (Date.parse(bit) <= Date.parse(bas)) return OLCULEMEDI("pencere_yok");

  const [a, b] = await Promise.all([
    odoUcOkumasi(vehicleId, bas, "ilk"),
    odoUcOkumasi(vehicleId, bit, "son"),
  ]);
  if (!a || !b) return OLCULEMEDI("uc_okumasi_yok");

  const dBas = Math.abs(Date.parse(a.at) - Date.parse(bas));
  const dBit = Math.abs(Date.parse(b.at) - Date.parse(bit));
  const basSapmaDk = Math.round((dBas / 60000) * 10) / 10;
  const bitSapmaDk = Math.round((dBit / 60000) * 10) / 10;
  if (dBas > ODO_KENAR_ESIK_MS || dBit > ODO_KENAR_ESIK_MS) {
    return { km: null, durum: "kenar_bayat", basSapmaDk, bitSapmaDk };
  }

  const km = b.km - a.km;
  // Fark ≤ 0 bir ölçüm değil: odometre geri sarmaz, sarıyorsa okuma bozuktur.
  if (!(km > 0)) return { km: null, durum: "fark_yok", basSapmaDk, bitSapmaDk };

  return { km: Math.round(km * 10) / 10, durum: "olculdu", basSapmaDk, bitSapmaDk };
}

// ═══════════════════════════ GELİR OKUMA ═════════════════════════════════

function gelirCevir(r: Record<string, unknown>): GelirSatiri {
  return {
    id: String(r.id),
    durakId: r.durak_id ? String(r.durak_id) : null,
    model: String(r.model) as GelirModeli,
    birimFiyat: Number(r.birim_fiyat ?? 0),
    miktar: Number(r.miktar ?? 0),
    tutarEur: Number(r.tutar_eur ?? 0),
    miktarKaynak: String(r.miktar_kaynak ?? "elle") as MiktarKaynak,
    aciklama: r.aciklama ? String(r.aciklama) : null,
  };
}

export async function seferGelirleri(
  seferIds: string[]
): Promise<{ harita: Map<string, GelirSatiri[]>; tabloYok: boolean }> {
  const harita = new Map<string, GelirSatiri[]>();
  if (seferIds.length === 0) return { harita, tabloYok: false };

  const { data, error } = await supabaseAdmin
    .from("sefer_gelirleri")
    .select("*")
    .in("sefer_id", seferIds);
  if (error) return { harita, tabloYok: tabloYokMu(error) };

  for (const ham of data ?? []) {
    const r = ham as Record<string, unknown>;
    const k = String(r.sefer_id);
    const liste = harita.get(k) ?? [];
    liste.push(gelirCevir(r));
    harita.set(k, liste);
  }
  return { harita, tabloYok: false };
}

// ═══════════════════════════ SEFER KÂRLILIĞI ═════════════════════════════

export type SeferKarlilikSatiri = {
  seferId: string;
  tarih: string;
  musteriId: string | null;
  musteriAd: string | null;
  vehicleId: string | null;
  plaka: string | null;
  workerId: string;
  soforAd: string | null;
  durum: string;
  kmOlcum: KmOlcum;
  saatTavanUygulandi: boolean;
  karlilik: SeferKarliligi;
  /** Ham gelir satırları — ekran bunları listeler ve tek tek sildirir. */
  gelirler: GelirSatiri[];
};

export type KarlilikPanosu = {
  tabloYok: boolean;
  /** Kaç sefer tarandı (tamamlanmış, aralıkta). */
  seferSayisi: number;
  /** Geliri girilmiş sefer sayısı — kapsama kanıtı. */
  gelirliSefer: number;
  satirlar: SeferKarlilikSatiri[];
  musteri: KarlilikSatiri[];
  arac: KarlilikSatiri[];
  sofor: KarlilikSatiri[];
  enKarli: KarlilikSatiri[];
  enZararli: KarlilikSatiri[];
  /** Ölçümü eksik olduğu için UÇ listelerine girmeyen müşteri sayısı. */
  ucDisiOlcumsuz: number;
  toplam: {
    gelirEur: number;
    maliyetEur: number;
    katkiPayiEur: number;
    /** Atfedilemeyen araç sabit gideri — AYRI, dağıtılmadan. */
    atfedilemezSabitEur: number | null;
    atfedilemezAracGun: number;
  };
  oranlar: {
    fuelEurPerL: number;
    lPer100Km: number;
    laborEurPerHour: number;
    vehicleEurPerDay: number;
  };
  /** Maliyet oranlarının kaynağı — 076'daki etiket zinciri aynen taşınır. */
  oranKaynak: Awaited<ReturnType<typeof resolveCostRates>>["origin"];
  ratesTableMissing: boolean;
};

/** Viyana gün anahtarı — araç-günü sayımı için (cost-model ile aynı eksen). */
function gunAnahtari(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vienna" }).format(new Date(iso));
}

/**
 * KÂRLILIK PANOSU.
 *
 * `fleetLPer100Km` DIŞARIDAN gelir — maliyet motorunun ölçtüğü filo ortalaması.
 * null geçilirse `resolveCostRates` kendi düşüş zincirini uygular ve etiket
 * "ölçüldü" yerine "varsayılan" olur; ekran farkı gösterir.
 */
export async function karlilikPanosu(
  bas: Date,
  bit: Date,
  fleetLPer100Km: number | null = null
): Promise<KarlilikPanosu> {
  const scope = await getTestScope();

  const { data: sefData, error: sefErr } = await withoutTestRows(
    supabaseAdmin
      .from("seferler")
      .select("id, tarih, worker_id, vehicle_id, musteri_id, durum, yolda_at, tamamlandi_at")
      .eq("durum", "tamamlandi")
      .gte("tarih", bas.toISOString().slice(0, 10))
      .lte("tarih", bit.toISOString().slice(0, 10))
      .order("tarih", { ascending: false })
      .limit(2000),
    "worker_id",
    scope.workerIds
  );

  const cozum = await resolveCostRates(fleetLPer100Km);
  const bos = (tabloYok: boolean): KarlilikPanosu => ({
    tabloYok,
    seferSayisi: 0,
    gelirliSefer: 0,
    satirlar: [],
    musteri: [],
    arac: [],
    sofor: [],
    enKarli: [],
    enZararli: [],
    ucDisiOlcumsuz: 0,
    toplam: {
      gelirEur: 0,
      maliyetEur: 0,
      katkiPayiEur: 0,
      atfedilemezSabitEur: null,
      atfedilemezAracGun: 0,
    },
    oranlar: cozum.rates,
    oranKaynak: cozum.origin,
    ratesTableMissing: cozum.tabloYok,
  });

  if (sefErr) return bos(tabloYokMu(sefErr));
  const seferler = (sefData ?? []) as {
    id: string;
    tarih: string;
    worker_id: string;
    vehicle_id: string | null;
    musteri_id: string | null;
    durum: string;
    yolda_at: string | null;
    tamamlandi_at: string | null;
  }[];
  if (seferler.length === 0) return bos(false);

  const { harita: gelirHarita, tabloYok: gelirTabloYok } = await seferGelirleri(
    seferler.map((s) => s.id)
  );
  if (gelirTabloYok) return bos(true);

  // ── Etiket sözlükleri (tek sorgu, N+1 yok).
  const [{ data: mData }, { data: vData }, { data: wData }] = await Promise.all([
    supabaseAdmin.from("musteriler").select("id, ad"),
    // test-visible: yalnız PLAKA ETİKETİ sözlüğü — hiçbir sayıyı etkilemez.
    // Kârlılık satırları SEFER eksenlidir ve seferlerin test kapsamı yukarıdaki
    // `withoutTestRows(..., "worker_id", ...)` ile ZATEN uygulandı; test aracına
    // ait bir sefer buraya hiç gelmez. Aracı süzmek tek bir sayıyı bile
    // değiştirmez, yalnız gerçek bir aracın plakasını "—"e çevirirdi.
    supabaseAdmin.from("vehicles").select("id, plate"),
    // test-visible: yalnız İSİM ETİKETİ sözlüğü — hiçbir sayıyı etkilemez.
    // Seferin kendi kapsamı yukarıdaki withoutTestRows ile zaten uygulandı.
    supabaseAdmin.from("workers").select("id, name"),
  ]);
  const musteriAd = new Map(((mData ?? []) as { id: string; ad: string }[]).map((m) => [m.id, m.ad]));
  const plaka = new Map(((vData ?? []) as { id: string; plate: string }[]).map((v) => [v.id, v.plate]));
  const soforAd = new Map(((wData ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));

  // ── Sefer başına ölçüm. Eşzamanlılık tavanı 6 (bkz. lib/db-fanout.ts).
  const satirlar = await mapBounded(seferler, async (s): Promise<SeferKarlilikSatiri> => {
    const kmOlcum = await seferKmOlc(s.vehicle_id, s.yolda_at, s.tamamlandi_at);

    /**
     * İŞÇİLİK PENCERESİ — AZG GÜNLÜK TAVANI UYGULANIR.
     * Geç kapatılmış sefer çalışma değildir; vardiya motorundaki
     * `hourCapShifts` ile birebir aynı gerekçe ve aynı tavan.
     */
    let saat: number | null = null;
    let tavan = false;
    if (s.yolda_at && s.tamamlandi_at) {
      const ms = Date.parse(s.tamamlandi_at) - Date.parse(s.yolda_at);
      if (ms > 0) {
        tavan = ms > AZG_DAILY_MAX_MS;
        saat = (tavan ? AZG_DAILY_MAX_MS : ms) / 3_600_000;
      }
    }

    const maliyet = seferMaliyetiHesapla({
      km: kmOlcum.km,
      kmDurum: kmOlcum.durum,
      saat,
      saatTavanUygulandi: tavan,
      lPer100Km: cozum.rates.lPer100Km,
      fuelEurPerL: cozum.rates.fuelEurPerL,
      laborEurPerHour: cozum.rates.laborEurPerHour,
    });

    return {
      seferId: s.id,
      tarih: s.tarih,
      musteriId: s.musteri_id,
      musteriAd: s.musteri_id ? (musteriAd.get(s.musteri_id) ?? null) : null,
      vehicleId: s.vehicle_id,
      plaka: s.vehicle_id ? (plaka.get(s.vehicle_id) ?? null) : null,
      workerId: s.worker_id,
      soforAd: soforAd.get(s.worker_id) ?? null,
      durum: s.durum,
      kmOlcum,
      saatTavanUygulandi: tavan,
      karlilik: seferKarliligiHesapla(gelirHarita.get(s.id) ?? [], maliyet),
      gelirler: gelirHarita.get(s.id) ?? [],
    };
  });

  const musteri = eksendeTopla(
    satirlar.map((r) => ({ id: r.musteriId, ad: r.musteriAd ?? "— müşteri yok", k: r.karlilik }))
  );
  const arac = eksendeTopla(
    satirlar.map((r) => ({ id: r.vehicleId, ad: r.plaka ?? "— araç yok", k: r.karlilik }))
  );
  const sofor = eksendeTopla(
    satirlar.map((r) => ({ id: r.workerId, ad: r.soforAd ?? "—", k: r.karlilik }))
  );
  const { enKarli, enZararli, olcumsuz } = uclar(musteri);

  const gelirEur = Math.round(satirlar.reduce((a, r) => a + r.karlilik.gelirEur, 0) * 100) / 100;
  const maliyetEur =
    Math.round(satirlar.reduce((a, r) => a + (r.karlilik.maliyet.atfedilenEur ?? 0), 0) * 100) / 100;

  /**
   * ATFEDİLEMEYEN SABİT GİDER — DAĞITILMAZ, AMA GİZLENMEZ DE.
   *
   * Aralıkta sefer görmüş ayrık (araç, gün) çifti sayılır ve €/gün ile
   * çarpılır. Bu sayı hiçbir sefere yazılmaz; ekranda AYRI durur ve
   * "katkı payı net kâr değildir" cümlesinin sayısal karşılığıdır.
   */
  const aracGun = new Set<string>();
  for (const r of satirlar) {
    if (r.vehicleId && r.tarih) aracGun.add(`${r.vehicleId}|${gunAnahtari(`${r.tarih}T12:00:00Z`)}`);
  }

  return {
    tabloYok: false,
    seferSayisi: satirlar.length,
    gelirliSefer: satirlar.filter((r) => r.karlilik.gelirSatiri > 0).length,
    satirlar,
    musteri,
    arac,
    sofor,
    enKarli,
    enZararli,
    ucDisiOlcumsuz: olcumsuz,
    toplam: {
      gelirEur,
      maliyetEur,
      katkiPayiEur: Math.round((gelirEur - maliyetEur) * 100) / 100,
      atfedilemezSabitEur:
        aracGun.size > 0 ? Math.round(aracGun.size * cozum.rates.vehicleEurPerDay * 100) / 100 : null,
      atfedilemezAracGun: aracGun.size,
    },
    oranlar: cozum.rates,
    oranKaynak: cozum.origin,
    ratesTableMissing: cozum.tabloYok,
  };
}

// ═══════════════ HAFTALIK AKSİYON KÖPRÜSÜ — ZARAR EDEN MÜŞTERİ ═══════════

export type ZararliMusteri = {
  musteriId: string;
  ad: string;
  seferSayisi: number;
  gelirEur: number;
  maliyetEur: number;
  katkiPayiEur: number;
};

/**
 * Son `ZARAR_PENCERE_GUN` günde katkı payı NEGATİF olan müşteriler.
 *
 * ⚠️ ASGARİ ÖRNEKLEM KAPISI: müşterinin en az `ZARAR_MIN_SEFER` seferi
 * ölçülmüş olmalı. Tek seferden "bu müşteri zarar ettiriyor" sonucu çıkarmak,
 * zayıf paydadan filo-göreli eşik üretmenin aynısıdır (084 yakıt kuralı).
 *
 * Ayrıca maliyeti HİÇ ölçülemeyen seferler kapıyı geçemez: geliri olan ama
 * maliyeti bilinmeyen bir müşteri "zararlı" görünemez.
 */
export async function zararEdenMusteriler(
  simdi: Date
): Promise<{ satirlar: ZararliMusteri[]; aday: number; tabloYok: boolean }> {
  const bas = new Date(simdi.getTime() - ZARAR_PENCERE_GUN * 86_400_000);
  const pano = await karlilikPanosu(bas, simdi);
  if (pano.tabloYok) return { satirlar: [], aday: 0, tabloYok: true };

  // Müşterisi olan ve maliyeti ÖLÇÜLMÜŞ seferler.
  const olculen = pano.satirlar.filter(
    (r) => r.musteriId && r.karlilik.maliyet.atfedilenEur !== null
  );
  const kova = new Map<string, ZararliMusteri>();
  for (const r of olculen) {
    const k = r.musteriId!;
    const s =
      kova.get(k) ??
      { musteriId: k, ad: r.musteriAd ?? "—", seferSayisi: 0, gelirEur: 0, maliyetEur: 0, katkiPayiEur: 0 };
    s.seferSayisi++;
    s.gelirEur += r.karlilik.gelirEur;
    s.maliyetEur += r.karlilik.maliyet.atfedilenEur ?? 0;
    kova.set(k, s);
  }

  const hepsi = [...kova.values()].map((s) => ({
    ...s,
    gelirEur: Math.round(s.gelirEur * 100) / 100,
    maliyetEur: Math.round(s.maliyetEur * 100) / 100,
    katkiPayiEur: Math.round((s.gelirEur - s.maliyetEur) * 100) / 100,
  }));

  return {
    aday: hepsi.length,
    tabloYok: false,
    satirlar: hepsi
      .filter((s) => s.seferSayisi >= ZARAR_MIN_SEFER && s.katkiPayiEur < 0)
      .sort((a, b) => a.katkiPayiEur - b.katkiPayiEur),
  };
}
