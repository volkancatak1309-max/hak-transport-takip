import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu } from "@/lib/fault-reports";
import { getTestScope, withoutTestRows } from "@/lib/test-data";

/**
 * PERİYODİK BAKIM — veri katmanı (migration 081).
 *
 * ═══ İKİ EŞİK, "HANGİSİ ÖNCE" ═══
 *
 * Plan km ve/veya ay aralığı taşıyor. Motor ikisini de hesaplar ve ÖNCE
 * dolanı kullanır. Sebebi ölçüm: 30 aktif aracın 29'unda odometre var ama
 * yalnız 18'i 48 saatten taze (medyan 14 saat, en kötü 25 gün). Yalnız km'ye
 * dayansaydık cihazı susmuş araç hiç bakıma girmezdi; yalnız süreye
 * dayansaydık çok çalışan araç zamanından önce yıpranırdı.
 *
 * ═══ KM ÖLÇÜLEMİYORSA SESSİZ KALMAZ ═══
 *
 * Odometre okunamayan araçta km eşiği HESAPLANMAZ (null döner) ve bu durum
 * `kmOlculemiyor` bayrağıyla dışarı verilir. "Ölçemedim"i "bakım gerekmiyor"a
 * çevirmek, lib/km-quality.ts'te bir kez öğrenilen hatanın aynısı olurdu.
 */

export type BakimPlani = {
  id: string;
  vehicleId: string | null;
  tip: string;
  aralikKm: number | null;
  aralikAy: number | null;
  sonBakimKm: number | null;
  sonBakimAt: string | null;
  uyariKm: number;
  uyariGun: number;
  aktif: boolean;
};

const PLAN_COLS =
  "id, vehicle_id, tip, aralik_km, aralik_ay, son_bakim_km, son_bakim_at, uyari_km, uyari_gun, aktif";

function planCevir(r: Record<string, unknown>): BakimPlani {
  return {
    id: String(r.id),
    vehicleId: r.vehicle_id ? String(r.vehicle_id) : null,
    tip: String(r.tip),
    aralikKm: r.aralik_km == null ? null : Number(r.aralik_km),
    aralikAy: r.aralik_ay == null ? null : Number(r.aralik_ay),
    sonBakimKm: r.son_bakim_km == null ? null : Number(r.son_bakim_km),
    sonBakimAt: r.son_bakim_at ? String(r.son_bakim_at) : null,
    uyariKm: Number(r.uyari_km ?? 500),
    uyariGun: Number(r.uyari_gun ?? 14),
    aktif: Boolean(r.aktif),
  };
}

export type BakimSonuc<T> =
  | { ok: true; veri: T }
  | { ok: false; sebep: "tablo_yok" | "cakisma" | "hata"; mesaj?: string };

export async function listBakimPlanlari(
  yalnizAktif = false
): Promise<{ planlar: BakimPlani[]; tabloYok: boolean }> {
  let q = supabaseAdmin.from("bakim_planlari").select(PLAN_COLS);
  if (yalnizAktif) q = q.eq("aktif", true);
  const { data, error } = await q.order("tip");
  if (error) return { planlar: [], tabloYok: tabloYokMu(error) };
  return { planlar: ((data ?? []) as Record<string, unknown>[]).map(planCevir), tabloYok: false };
}

export async function upsertBakimPlani(
  p: {
    id?: string;
    vehicleId?: string | null;
    tip: string;
    aralikKm?: number | null;
    aralikAy?: number | null;
    sonBakimKm?: number | null;
    sonBakimAt?: string | null;
    uyariKm?: number;
    uyariGun?: number;
    aktif?: boolean;
  },
  actorWorkerId: string | null
): Promise<BakimSonuc<{ id: string }>> {
  const satir = {
    vehicle_id: p.vehicleId ?? null,
    tip: p.tip.trim(),
    aralik_km: p.aralikKm ?? null,
    aralik_ay: p.aralikAy ?? null,
    son_bakim_km: p.sonBakimKm ?? null,
    son_bakim_at: p.sonBakimAt ?? null,
    uyari_km: p.uyariKm ?? 500,
    uyari_gun: p.uyariGun ?? 14,
    aktif: p.aktif ?? true,
  };
  const q = p.id
    ? supabaseAdmin.from("bakim_planlari").update(satir).eq("id", p.id).select("id").maybeSingle()
    : supabaseAdmin
        .from("bakim_planlari")
        .insert({ ...satir, created_by: actorWorkerId })
        .select("id")
        .maybeSingle();
  const { data, error } = await q;
  if (error || !data) {
    return {
      ok: false,
      sebep: error && tabloYokMu(error)
        ? "tablo_yok"
        : (error?.code ?? "") === "23505"
          ? "cakisma"
          : "hata",
      mesaj: error?.message,
    };
  }
  return { ok: true, veri: { id: String((data as { id: string }).id) } };
}

// ── EŞİK HESABI ───────────────────────────────────────────────────────────

export type BakimDurumu = {
  planId: string;
  vehicleId: string;
  plaka: string;
  tip: string;
  /** Kalan km — odometre okunamıyorsa null. */
  kalanKm: number | null;
  /** Kalan gün — süre eşiği yoksa null. */
  kalanGun: number | null;
  /** Eşiğe girdi mi (km VEYA gün). */
  uyarida: boolean;
  /** Süresi/km'si GEÇTİ mi. */
  gecti: boolean;
  /** Aracın odometresi okunamıyor — km ekseni sessizce "sorun yok" demiyor. */
  kmOlculemiyor: boolean;
  /** Hangi eksen tetikledi (ekranda gösterilir). */
  eksen: "km" | "sure" | null;
};

/** Bu yaştan eski odometre okuması "ölçülemiyor" sayılır. */
export const ODOMETRE_BAYAT_SAAT = 72;

/**
 * Tek aracın TAZE odometresi (72 saat içinde). Yoksa null.
 *
 * "Bakım yapıldı" yolunda sayaç bu değerle ileri alınır. Kullanıcıya km
 * yazdırmıyoruz: elle girilen bir sayı, sonraki TÜM eşikleri kaydırır ve
 * hatası ancak aylar sonra fark edilir.
 */
export async function tazeOdometre(
  vehicleId: string,
  simdi: Date = new Date()
): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("device_telemetry")
    .select("odometer_km")
    .eq("vehicle_id", vehicleId)
    .not("odometer_km", "is", null)
    .gte(
      "recorded_at",
      new Date(simdi.getTime() - ODOMETRE_BAYAT_SAAT * 3600_000).toISOString()
    )
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return Number((data as { odometer_km: number }).odometer_km);
}

/**
 * Aktif planların durumu.
 *
 * ⚠️ `vehicle_id` NULL olan plan FİLO GENELİDİR: her araç için ayrı bir satır
 * üretilir. Böylece "tüm filoda 8.000 km'de yağ" tek planla kurulur ama uyarı
 * ARAÇ BAŞINA çıkar — yöneticinin göreceği şey plan değil, aracın durumudur.
 */
export async function bakimDurumlari(
  simdi: Date = new Date()
): Promise<{ durumlar: BakimDurumu[]; tabloYok: boolean }> {
  const { planlar, tabloYok } = await listBakimPlanlari(true);
  if (tabloYok) return { durumlar: [], tabloYok: true };
  if (planlar.length === 0) return { durumlar: [], tabloYok: false };

  // Test aracı BURADA eleniyor: filo geneli bir plan (vehicle_id NULL) her
  // araca açılıyor ve test aracı da onlardan biri olurdu — yöneticinin bakım
  // ekranında gerçek olmayan bir araç için "gecikmiş bakım" satırı çıkardı.
  // Seçicilerdeki kuralın aynısı (app/actions/bakim.ts).
  const test = await getTestScope();
  const { data: vRows } = await withoutTestRows(
    supabaseAdmin.from("vehicles").select("id, plate, status").neq("status", "inactive"),
    "id",
    test.vehicleIds
  );
  const araclar = ((vRows ?? []) as { id: string; plate: string }[]) ?? [];
  if (araclar.length === 0) return { durumlar: [], tabloYok: false };

  // Son odometre okuması — araç başına tek satır, tek turda.
  const odo = new Map<string, { km: number; an: string }>();
  const { data: tRows } = await supabaseAdmin
    .from("device_telemetry")
    .select("vehicle_id, odometer_km, recorded_at")
    .in("vehicle_id", araclar.map((a) => a.id))
    .not("odometer_km", "is", null)
    .gte("recorded_at", new Date(simdi.getTime() - ODOMETRE_BAYAT_SAAT * 3600_000).toISOString())
    .order("recorded_at", { ascending: false });
  for (const t of (tRows ?? []) as Record<string, unknown>[]) {
    const vid = String(t.vehicle_id);
    // İlk gelen EN TAZE (sorgu azalan sıralı) — sonrakiler atlanır.
    if (!odo.has(vid)) odo.set(vid, { km: Number(t.odometer_km), an: String(t.recorded_at) });
  }

  const durumlar: BakimDurumu[] = [];
  for (const p of planlar) {
    const hedefler = p.vehicleId ? araclar.filter((a) => a.id === p.vehicleId) : araclar;
    for (const a of hedefler) {
      const okuma = odo.get(a.id);
      const kmOlculemiyor = !okuma;

      let kalanKm: number | null = null;
      if (p.aralikKm != null && okuma) {
        // Taban: son bakımın km'si; hiç bakım yapılmadıysa bugünkü okuma
        // (yani sayaç bugünden başlar — "geçmişte kaldı" demek yerine).
        const taban = p.sonBakimKm ?? okuma.km;
        kalanKm = taban + p.aralikKm - okuma.km;
      }

      let kalanGun: number | null = null;
      if (p.aralikAy != null) {
        const taban = p.sonBakimAt ? new Date(p.sonBakimAt) : simdi;
        const hedef = new Date(taban);
        hedef.setMonth(hedef.getMonth() + p.aralikAy);
        kalanGun = Math.round((hedef.getTime() - simdi.getTime()) / 86_400_000);
      }

      const kmUyari = kalanKm != null && kalanKm <= p.uyariKm;
      const sureUyari = kalanGun != null && kalanGun <= p.uyariGun;
      if (!kmUyari && !sureUyari) continue;

      const gecti = (kalanKm != null && kalanKm < 0) || (kalanGun != null && kalanGun < 0);
      // Hangi eksen daha acil: ikisi de uyarıdaysa GEÇMİŞ olan öne çıkar.
      const eksen: BakimDurumu["eksen"] =
        kmUyari && sureUyari
          ? (kalanKm ?? 0) < 0 || (kalanKm ?? 0) / Math.max(p.uyariKm, 1) <
            (kalanGun ?? 0) / Math.max(p.uyariGun, 1)
            ? "km"
            : "sure"
          : kmUyari
            ? "km"
            : "sure";

      durumlar.push({
        planId: p.id,
        vehicleId: a.id,
        plaka: a.plate,
        tip: p.tip,
        kalanKm,
        kalanGun,
        uyarida: true,
        gecti,
        kmOlculemiyor,
        eksen,
      });
    }
  }

  // En acil önce: geçmişler, sonra kalanı azalan aciliyetle.
  durumlar.sort((x, y) => {
    const xa = x.gecti ? -1 : 0;
    const ya = y.gecti ? -1 : 0;
    if (xa !== ya) return xa - ya;
    const xk = x.kalanGun ?? x.kalanKm ?? 0;
    const yk = y.kalanGun ?? y.kalanKm ?? 0;
    return xk - yk;
  });

  return { durumlar, tabloYok: false };
}

/**
 * Bakım yapıldı: servis kaydı yazılır ve plan İLERLETİLİR.
 *
 * ⚠️ Sonraki bakım "otomatik hesaplanır" derken kastedilen budur: planın
 * `son_bakim_km`/`son_bakim_at` tabanı güncellenir, sonraki eşik o tabandan
 * yeniden doğar. Ayrı bir "sonraki bakım" satırı YAZILMAZ — yazsaydık plan
 * değiştiğinde (aralık 8.000'den 10.000'e çıkınca) bekleyen satır bayat
 * kalırdı.
 */
export async function bakimYapildi(
  g: {
    planId: string;
    vehicleId: string;
    plaka: string;
    odometreKm: number | null;
    serviceType?: string;
    maliyet?: number | null;
    aciklama?: string | null;
  },
  actorWorkerId: string | null
): Promise<BakimSonuc<{ kayitId: string | null }>> {
  const an = new Date().toISOString();

  // 007'nin SABİT service_type listesi burada bir kısıt: plan tipi serbest
  // metin, servis kaydı ise o listeden bir değer istiyor. Eşleşmeyen tipler
  // 'general_service' altına yazılır ve gerçek tip açıklamaya geçer — kaydı
  // düşürmek yerine bilgiyi koruyan yol.
  const BILINEN = [
    "oil_change",
    "inspection",
    "tire_change",
    "brake_check",
    "general_service",
    "repair",
    "other",
  ];
  const tip = g.serviceType && BILINEN.includes(g.serviceType) ? g.serviceType : "general_service";

  let kayitId: string | null = null;
  const { data, error } = await supabaseAdmin
    .from("vehicle_maintenance")
    .insert({
      vehicle_plate: g.plaka,
      vehicle_id: g.vehicleId,
      bakim_plani_id: g.planId,
      serviced_at: an,
      service_type: tip,
      odometer_km: g.odometreKm ?? 0,
      cost: g.maliyet ?? null,
      description: g.aciklama?.trim() || null,
      created_by: actorWorkerId,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error.message };
  }
  kayitId = data ? String((data as { id: string }).id) : null;

  const { error: planHata } = await supabaseAdmin
    .from("bakim_planlari")
    .update({ son_bakim_at: an, son_bakim_km: g.odometreKm ?? null })
    .eq("id", g.planId);
  if (planHata) return { ok: false, sebep: "hata", mesaj: planHata.message };

  return { ok: true, veri: { kayitId } };
}
