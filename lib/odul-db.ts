import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { buildPerformanceReport } from "@/lib/reports";
import { getLatestConfigEpoch, rangeStartsBeforeEpoch } from "@/lib/config-epoch";
import {
  DONEM_GUN,
  ILK_N,
  SERI_DONEM,
  rozetleriHesapla,
  seriKazanilabilirMi,
  siralamaKur,
  type DonemSkoru,
  type RozetAdayi,
  type RozetKodu,
  type SiraSatiri,
  type SkorKapi,
} from "@/lib/odul";

/**
 * ŞOFÖR ÖDÜL — VERİ KATMANI (migration 088).
 *
 * Saf hesap `lib/odul.ts`te. Burada ÖLÇÜM, SAKLAMA ve OKUMA var.
 *
 * ⚠️ Bu dosya skor motoruna, AZG raporuna ve performans raporuna HİÇBİR ŞEY
 * YAZMAZ. Yalnız 088'in üç tablosuna yazar; skoru `buildPerformanceReport`
 * üretir ve olduğu gibi saklanır.
 */

const GUN_MS = 86_400_000;
const TABLO_YOK = new Set(["PGRST205", "42P01"]);
const tabloYokMu = (e: { code?: string; message?: string } | null) =>
  !!e && (TABLO_YOK.has(e.code ?? "") || /schema cache|does not exist/i.test(e.message ?? ""));

const gunAnahtari = (d: Date) => d.toISOString().slice(0, 10);

// ═══════════════════════════ KİRACI AYARI ════════════════════════════════

export type OdulAyari = { isimGorunur: boolean; rozetAcik: boolean; tabloYok: boolean };

export const VARSAYILAN_ODUL_AYARI: OdulAyari = {
  isimGorunur: false,
  rozetAcik: true,
  tabloYok: true,
};

export async function odulAyari(): Promise<OdulAyari> {
  const { data, error } = await supabaseAdmin
    .from("tenant_odul")
    .select("isim_gorunur, rozet_acik")
    .eq("id", "singleton")
    .maybeSingle();
  if (error || !data) return { ...VARSAYILAN_ODUL_AYARI, tabloYok: tabloYokMu(error) };
  const r = data as { isim_gorunur: boolean; rozet_acik: boolean };
  return { isimGorunur: r.isim_gorunur === true, rozetAcik: r.rozet_acik === true, tabloYok: false };
}

export async function odulAyariYaz(
  girdi: { isimGorunur: boolean; rozetAcik: boolean },
  workerId: string | null
): Promise<{ ok: boolean; hata?: string }> {
  const { error } = await supabaseAdmin
    .from("tenant_odul")
    .update({
      isim_gorunur: girdi.isimGorunur,
      rozet_acik: girdi.rozetAcik,
      updated_at: new Date().toISOString(),
      updated_by: workerId,
    })
    .eq("id", "singleton");
  if (error) return { ok: false, hata: tabloYokMu(error) ? "tablo_yok" : "hata" };
  return { ok: true };
}

// ═══════════════════════ DÖNEM ANLIK GÖRÜNTÜSÜ ═══════════════════════════

/** Dönemin sınırları — `donemGeri` kadar geriye kaydırılmış 30 günlük pencere. */
export function donemAraligi(simdi: Date, donemGeri = 0): { bas: Date; bit: Date } {
  const bit = new Date(simdi.getTime() - donemGeri * DONEM_GUN * GUN_MS);
  const bas = new Date(bit.getTime() - DONEM_GUN * GUN_MS);
  return { bas, bit };
}

export type DonemYazmaSonucu = {
  tabloYok: boolean;
  donemBas: string;
  yazilan: number;
  skorlanan: number;
  skorsuz: number;
  epokOncesi: boolean;
  hata: string | null;
};

/**
 * BİR DÖNEMİ HESAPLA VE SAKLA.
 *
 * ⚠️ SKOR GEÇMİŞİ HİÇBİR YERDE SAKLANMIYORDU (ölçüldü: surucu_skorlari /
 * driver_scores / skor_gecmisi tablolarının hiçbiri yok). "Üst üste N dönem"
 * diyen bir rozet geçmiş olmadan kurulamaz; bu fonksiyon o geçmişi üretir.
 *
 * Her satır hesaplandığı KALİBRASYON DAMGASINI taşır: cihaz eşiği
 * 22–23.07.2026'da değişti ve ham olay sayısı değişti. Damga olmadan rozet
 * motoru iki farklı cetveli karşılaştırırdı.
 */
export async function donemiHesaplaVeYaz(
  simdi: Date = new Date(),
  donemGeri = 0
): Promise<DonemYazmaSonucu> {
  const { bas, bit } = donemAraligi(simdi, donemGeri);
  const donemBas = gunAnahtari(bas);
  const epok = await getLatestConfigEpoch();
  const epokOncesi = rangeStartsBeforeEpoch(bas, epok);

  const bos: DonemYazmaSonucu = {
    tabloYok: false,
    donemBas,
    yazilan: 0,
    skorlanan: 0,
    skorsuz: 0,
    epokOncesi,
    hata: null,
  };

  const rapor = await buildPerformanceReport({ start: bas, end: bit });
  const satirlar = rapor.rows ?? [];
  if (satirlar.length === 0) return bos;

  const govde = satirlar.map((r) => ({
    worker_id: r.workerId,
    donem_bas: donemBas,
    donem_bit: gunAnahtari(bit),
    skor: r.safetyScore,
    kapi: r.safetyScore === null ? (r.scoreGate ?? null) : null,
    olay_sayisi: r.events ?? 0,
    km: r.scoreKm,
    esik_km: r.scoreMinKm ?? null,
    epok_at: epok ? epok.changedAt.toISOString() : null,
    epok_oncesi: epokOncesi,
    hesaplandi_at: simdi.toISOString(),
  }));

  /**
   * UPSERT — dönem başına TEK satır. İkinci koşum aynı satırı günceller;
   * yeni satır yazsaydı "üst üste 3 dönem" sayımı tekrarlarla şişerdi.
   */
  const { error } = await supabaseAdmin
    .from("sofor_skor_donem")
    .upsert(govde, { onConflict: "worker_id,donem_bas" });

  if (error) {
    return { ...bos, tabloYok: tabloYokMu(error), hata: error.message.slice(0, 160) };
  }

  return {
    ...bos,
    yazilan: govde.length,
    skorlanan: govde.filter((g) => g.skor !== null).length,
    skorsuz: govde.filter((g) => g.skor === null).length,
  };
}

function donemCevir(r: Record<string, unknown>): DonemSkoru {
  return {
    workerId: String(r.worker_id),
    donemBas: String(r.donem_bas),
    donemBit: String(r.donem_bit),
    skor: r.skor === null || r.skor === undefined ? null : Number(r.skor),
    kapi: (r.kapi ?? null) as SkorKapi | null,
    olaySayisi: Number(r.olay_sayisi ?? 0),
    km: r.km === null || r.km === undefined ? null : Number(r.km),
    esikKm: r.esik_km === null || r.esik_km === undefined ? null : Number(r.esik_km),
    epokAt: r.epok_at ? String(r.epok_at) : null,
    epokOncesi: r.epok_oncesi === true,
  };
}

export async function donemleriOku(
  limit = 12
): Promise<{ donemler: DonemSkoru[]; tabloYok: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("sofor_skor_donem")
    .select("*")
    .order("donem_bas", { ascending: false })
    .limit(limit * 60);
  if (error) return { donemler: [], tabloYok: tabloYokMu(error) };
  return { donemler: (data ?? []).map((r) => donemCevir(r as Record<string, unknown>)), tabloYok: false };
}

// ═══════════════════════════ ROZETLER ════════════════════════════════════

export type RozetKaydi = {
  id: string;
  workerId: string;
  rozet: RozetKodu;
  donemBas: string;
  kanit: Record<string, unknown>;
  kazanildiAt: string;
};

export type RozetTuru = {
  tabloYok: boolean;
  donemBas: string;
  aday: number;
  yazilan: number;
  tekrar: number;
  /** Seri rozeti bugün kazanılabilir mi — değilse ekran sebebi söyler. */
  seriKazanilabilir: boolean;
  temizDonem: number;
  hata: string | null;
};

/**
 * ROZETLERİ DEĞERLENDİR VE YAZ.
 *
 * ⚠️ ROZET SİLİNMEZ. Kazanıldığı dönemin gerçeğidir; sonraki dönemde skor
 * düşse de geçmiş rozet durur. Tekillik `(worker_id, rozet, donem_bas)` —
 * ikinci koşum 23505 alır ve hiçbir şey yazmaz.
 */
export async function rozetleriDegerlendir(
  simdi: Date = new Date()
): Promise<RozetTuru> {
  const { donemler, tabloYok } = await donemleriOku();
  const { bas } = donemAraligi(simdi, 0);
  const donemBas = gunAnahtari(bas);

  const bos: RozetTuru = {
    tabloYok,
    donemBas,
    aday: 0,
    yazilan: 0,
    tekrar: 0,
    seriKazanilabilir: false,
    temizDonem: 0,
    hata: null,
  };
  if (tabloYok) return bos;

  const ayar = await odulAyari();
  if (!ayar.rozetAcik) return bos;

  // Şoför başına dönemler, YENİDEN ESKİYE.
  const kisiBazli = new Map<string, DonemSkoru[]>();
  for (const d of donemler) {
    const liste = kisiBazli.get(d.workerId) ?? [];
    liste.push(d);
    kisiBazli.set(d.workerId, liste);
  }
  for (const liste of kisiBazli.values()) liste.sort((a, b) => b.donemBas.localeCompare(a.donemBas));

  // Bu dönemin ilk 3'ü — "ay_ilk3" rozetinin girdisi.
  const buDonem = donemler
    .filter((d) => d.donemBas === donemBas && d.skor !== null)
    .sort((a, b) => (b.skor ?? 0) - (a.skor ?? 0));
  const ilk3 = buDonem.slice(0, ILK_N).map((d) => d.workerId);

  /**
   * TEMİZ DÖNEM SAYISI — seri rozetinin kazanılabilirliği.
   * Epok sonrası başlayan ayrık dönem sayısı.
   */
  const temizDonem = new Set(
    donemler.filter((d) => !d.epokOncesi).map((d) => d.donemBas)
  ).size;
  const seri = seriKazanilabilirMi(temizDonem);

  const adaylar: RozetAdayi[] = [];
  for (const [workerId, liste] of kisiBazli) {
    if (liste[0]?.donemBas !== donemBas) continue; // yalnız bu dönemi değerlendir
    adaylar.push(...rozetleriHesapla(liste, ilk3));
    void workerId;
  }

  let yazilan = 0;
  let tekrar = 0;
  let hata: string | null = null;
  for (const a of adaylar) {
    const { error } = await supabaseAdmin.from("sofor_rozetleri").insert({
      worker_id: a.workerId,
      rozet: a.rozet,
      donem_bas: a.donemBas,
      kanit: a.kanit,
    });
    if (!error) yazilan++;
    else if (error.code === "23505") tekrar++;
    else hata = error.message.slice(0, 160);
  }

  return {
    tabloYok: false,
    donemBas,
    aday: adaylar.length,
    yazilan,
    tekrar,
    seriKazanilabilir: seri.olur,
    temizDonem,
    hata,
  };
}

export async function rozetleriOku(
  workerId?: string
): Promise<{ rozetler: RozetKaydi[]; tabloYok: boolean }> {
  let q = supabaseAdmin
    .from("sofor_rozetleri")
    .select("*")
    .order("kazanildi_at", { ascending: false })
    .limit(300);
  if (workerId) q = q.eq("worker_id", workerId);
  const { data, error } = await q;
  if (error) return { rozetler: [], tabloYok: tabloYokMu(error) };
  return {
    tabloYok: false,
    rozetler: (data ?? []).map((ham) => {
      const r = ham as Record<string, unknown>;
      return {
        id: String(r.id),
        workerId: String(r.worker_id),
        rozet: String(r.rozet) as RozetKodu,
        donemBas: String(r.donem_bas),
        kanit: (r.kanit ?? {}) as Record<string, unknown>,
        kazanildiAt: String(r.kazanildi_at),
      };
    }),
  };
}

// ═══════════════════════════ LİDERLİK ════════════════════════════════════

export type LiderlikPanosu = {
  tabloYok: boolean;
  ayar: OdulAyari;
  donemBas: string | null;
  donemBit: string | null;
  siralı: SiraSatiri[];
  skorsuz: SiraSatiri[];
  /** İsteyen şoförün kendi satırı — listede olmasa bile. */
  ben: SiraSatiri | null;
  rozetler: RozetKaydi[];
  /** Seri rozeti henüz kazanılabilir mi + kaç dönem eksik. */
  seri: { olur: boolean; eksikDonem: number; temizDonem: number };
  /** Bu dönem epok sınırından önce mi başlıyor (karışık cetvel). */
  epokOncesi: boolean;
};

/**
 * LİDERLİK TABLOSU — en son SAKLANMIŞ dönemden.
 *
 * ⚠️ Canlı hesap YAPMAZ: `buildPerformanceReport` ağır bir rapor ve bu ekran
 * her şoförün telefonunda açılıyor. Snapshot'ı cron üretir.
 */
export async function liderlikPanosu(
  benWorkerId: string | null,
  takmaEtiket: (n: number) => string
): Promise<LiderlikPanosu> {
  const ayar = await odulAyari();
  const { donemler, tabloYok } = await donemleriOku();

  const bos: LiderlikPanosu = {
    tabloYok: tabloYok || ayar.tabloYok,
    ayar,
    donemBas: null,
    donemBit: null,
    siralı: [],
    skorsuz: [],
    ben: null,
    rozetler: [],
    seri: { olur: false, eksikDonem: SERI_DONEM, temizDonem: 0 },
    epokOncesi: false,
  };
  if (tabloYok || donemler.length === 0) return bos;

  const sonDonem = donemler[0].donemBas;
  const buDonem = donemler.filter((d) => d.donemBas === sonDonem);
  const oncekiBas = [...new Set(donemler.map((d) => d.donemBas))].sort().reverse()[1] ?? null;
  const oncekiler = new Map<string, number | null>(
    donemler.filter((d) => d.donemBas === oncekiBas).map((d) => [d.workerId, d.skor])
  );

  const ids = [...new Set(buDonem.map((d) => d.workerId))];
  const { data: wData } = await supabaseAdmin.from("workers").select("id, name").in("id", ids);
  const adlar = new Map(((wData ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));

  const { siralı, skorsuz } = siralamaKur(
    buDonem,
    adlar,
    oncekiler,
    benWorkerId,
    ayar.isimGorunur,
    takmaEtiket
  );

  const { rozetler } = ayar.rozetAcik
    ? await rozetleriOku(benWorkerId ?? undefined)
    : { rozetler: [] as RozetKaydi[] };

  const temizDonem = new Set(donemler.filter((d) => !d.epokOncesi).map((d) => d.donemBas)).size;
  const s = seriKazanilabilirMi(temizDonem);

  return {
    tabloYok: false,
    ayar,
    donemBas: sonDonem,
    donemBit: buDonem[0]?.donemBit ?? null,
    siralı,
    skorsuz,
    ben: [...siralı, ...skorsuz].find((r) => r.ben) ?? null,
    rozetler,
    seri: { olur: s.olur, eksikDonem: s.eksikDonem, temizDonem },
    epokOncesi: buDonem[0]?.epokOncesi ?? false,
  };
}

/**
 * DÖNEM SONU ÖZETİ — yönetici için "kimi ödüllendirmeli, kim düşüşte".
 */
export type DonemOzeti = {
  tabloYok: boolean;
  donemBas: string | null;
  odullendir: { workerId: string; ad: string; skor: number; rozet: RozetKodu[] }[];
  dususte: { workerId: string; ad: string; skor: number; onceki: number; fark: number }[];
  skorsuz: { workerId: string; ad: string; kapi: SkorKapi | null; km: number | null; esikKm: number | null }[];
};

export async function donemOzeti(): Promise<DonemOzeti> {
  const { donemler, tabloYok } = await donemleriOku();
  if (tabloYok || donemler.length === 0) {
    return { tabloYok, donemBas: null, odullendir: [], dususte: [], skorsuz: [] };
  }

  const sonBas = donemler[0].donemBas;
  const bu = donemler.filter((d) => d.donemBas === sonBas);
  const oncekiBas = [...new Set(donemler.map((d) => d.donemBas))].sort().reverse()[1] ?? null;
  const onceki = new Map(
    donemler.filter((d) => d.donemBas === oncekiBas).map((d) => [d.workerId, d])
  );

  const ids = [...new Set(bu.map((d) => d.workerId))];
  const { data: wData } = await supabaseAdmin.from("workers").select("id, name").in("id", ids);
  const adlar = new Map(((wData ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));

  const { rozetler } = await rozetleriOku();
  const rozetHarita = new Map<string, RozetKodu[]>();
  for (const r of rozetler.filter((x) => x.donemBas === sonBas)) {
    rozetHarita.set(r.workerId, [...(rozetHarita.get(r.workerId) ?? []), r.rozet]);
  }

  const odullendir = bu
    .filter((d) => d.skor !== null && (rozetHarita.get(d.workerId)?.length ?? 0) > 0)
    .sort((a, b) => (b.skor ?? 0) - (a.skor ?? 0))
    .map((d) => ({
      workerId: d.workerId,
      ad: adlar.get(d.workerId) ?? "—",
      skor: d.skor!,
      rozet: rozetHarita.get(d.workerId) ?? [],
    }));

  /**
   * DÜŞÜŞTE — yalnız KIYASLANABİLİR dönemler arasında. Epok sınırını aşan
   * bir "düşüş" gerçek değil, cetvel değişimidir.
   */
  const dususte = bu
    .map((d) => {
      const o = onceki.get(d.workerId);
      if (d.skor === null || !o || o.skor === null) return null;
      if (d.epokOncesi || o.epokOncesi || (d.epokAt ?? null) !== (o.epokAt ?? null)) return null;
      const fark = d.skor - o.skor;
      return fark <= -5
        ? { workerId: d.workerId, ad: adlar.get(d.workerId) ?? "—", skor: d.skor, onceki: o.skor, fark }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.fark - b.fark);

  const skorsuz = bu
    .filter((d) => d.skor === null)
    .map((d) => ({
      workerId: d.workerId,
      ad: adlar.get(d.workerId) ?? "—",
      kapi: d.kapi,
      km: d.km,
      esikKm: d.esikKm,
    }));

  return { tabloYok: false, donemBas: sonBas, odullendir, dususte, skorsuz };
}
