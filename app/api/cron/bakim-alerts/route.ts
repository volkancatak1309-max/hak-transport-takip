import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/secure-compare";
import { supabaseAdmin } from "@/lib/supabase";
import { bakimDurumlari, type BakimDurumu } from "@/lib/bakim-db";
import { createIsEmri } from "@/lib/is-emri-db";
import { bakimBildir } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PERİYODİK BAKIM UYARISI — günlük cron (migration 081).
 *
 * ═══ İKİ İŞ, TEK GEÇİŞ ═══
 *
 * 1) Eşiğe giren/geçen her plan için AÇIK İŞ EMRİ olduğundan emin olur
 *    (kaynak='periyodik'). Emir yoksa açar; VARSA İKİNCİSİNİ AÇMAZ.
 * 2) Dönüm noktalarında bildirim gönderir.
 *
 * İkisini ayırmak, "panoda kalem var ama kuyrukta iş yok" ya da tersi bir
 * durum üretirdi. Kalem `bakimDurumlari`ndan TÜRETİLİYOR (bkz. admin-dashboard
 * 5d) ve emir buradan doğuyor; ikisi aynı ölçümün iki yüzü.
 *
 * ═══ BİLDİRİM DÖNÜM NOKTALARI — belge cron'uyla AYNI GEREKÇE ═══
 *
 * Eşiğe giren bakım her sabah bildirim gönderseydi, kanal susturulurdu. Süre
 * ekseninde dönüm noktaları belge cron'unun aynısı (eşiğe giriş · 7 · 1 · 0 ·
 * sonra haftada bir). KM ekseninde "gün" diye bir şey yok: km eşiği bir
 * TAKVİM noktası değil, aracın ne kadar çalıştığına bağlı. Orada tetikleyici
 * ESKİĞE GİRİŞ ve GEÇİŞ anlarıdır; arada kalan günlerde bildirim gitmez,
 * çünkü "1.200 km kaldı" ile "1.150 km kaldı" arasında yöneticinin
 * davranışını değiştirecek bir fark yok.
 *
 * ⚠️ Durum TUTULMUYOR (belge cron'uyla aynı bilinçli seçim ve aynı bedel):
 * cron bir günü kaçırırsa o güne denk gelen dönüm noktası kaçar. Pano kalemi
 * ve iş emri kaybolmaz — bildirim panonun tekrarlayıcısıdır, tek kanal değil.
 */

/** Süre ekseninde bildirim günleri. */
function sureDonumNoktasi(kalanGun: number, uyariGun: number): boolean {
  if (kalanGun < 0) return kalanGun % 7 === 0; // gecikmiş: haftada bir
  if (kalanGun === 0 || kalanGun === 1 || kalanGun === 7) return true;
  return kalanGun === uyariGun;
}

/**
 * KM ekseninde bildirim: yalnız EŞİĞE GİRİŞ ve GEÇİŞ.
 *
 * `girisBandi` — eşiğe yeni girmiş sayılacak km payı. Bir aracın günlük km'si
 * 100-400 arasında; 500 km'lik uyarı bandına giren araç ertesi gün bandın
 * içinde ama artık "yeni girmiş" değil. Bant tek bir günü değil, tek bir
 * GEÇİŞİ yakalamalı — bu yüzden ölçü günlük km'nin üst sınırı kadar.
 */
const GUNLUK_KM_UST = 400;

function kmDonumNoktasi(kalanKm: number, uyariKm: number): boolean {
  if (kalanKm < 0) return true; // geçmiş bakım her turda hatırlatılır
  return kalanKm <= uyariKm && kalanKm > uyariKm - GUNLUK_KM_UST;
}

function bildirilsinMi(d: BakimDurumu, uyariKm: number, uyariGun: number): boolean {
  if (d.eksen === "sure" && d.kalanGun !== null) {
    return sureDonumNoktasi(d.kalanGun, uyariGun);
  }
  if (d.eksen === "km" && d.kalanKm !== null) {
    return kmDonumNoktasi(d.kalanKm, uyariKm);
  }
  return false;
}

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const qs = req.nextUrl.searchParams.get("secret");
  if (safeEqual(qs, expected)) return true;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return safeEqual(auth.slice(7), expected);
  return false;
}

async function run(kuruYurut: boolean) {
  const { durumlar, tabloYok } = await bakimDurumlari();
  if (tabloYok) {
    return {
      status: 503,
      body: {
        ok: false,
        sebep: "tablo_yok",
        mesaj: "migration 081 (bakim_planlari) çalıştırılmamış",
      },
    };
  }

  const esikte = durumlar.filter((d) => (d.uyarida || d.gecti) && d.eksen !== null);

  // Planların uyarı eşikleri (bildirim dönüm noktası hesabı için).
  const planIds = [...new Set(esikte.map((d) => d.planId))];
  const esikler = new Map<string, { km: number; gun: number }>();
  if (planIds.length > 0) {
    const { data } = await supabaseAdmin
      .from("bakim_planlari")
      .select("id, uyari_km, uyari_gun")
      .in("id", planIds);
    for (const r of (data ?? []) as { id: string; uyari_km: number; uyari_gun: number }[]) {
      esikler.set(r.id, { km: Number(r.uyari_km ?? 500), gun: Number(r.uyari_gun ?? 14) });
    }
  }

  // AÇIK periyodik iş emri olan araçlar — ikinci emir açılmasın.
  const { data: acikRows } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("vehicle_id")
    .eq("kaynak", "periyodik")
    .neq("durum", "kapali");
  const acikArac = new Set(
    ((acikRows ?? []) as { vehicle_id: string }[]).map((r) => r.vehicle_id)
  );

  const acilanEmirler: { plaka: string; tip: string }[] = [];
  const bildirilenler: { plaka: string; tip: string; eksen: string; kalan: number }[] = [];

  for (const d of esikte) {
    const esik = esikler.get(d.planId) ?? { km: 500, gun: 14 };

    // 1) İŞ EMRİ — araç başına tek açık periyodik emir.
    if (!acikArac.has(d.vehicleId)) {
      const parca = d.eksen === "km" ? `${d.kalanKm} km` : `${d.kalanGun} gün`;
      const aciklama = d.gecti
        ? `Periyodik bakım GECİKTİ: ${d.tip} (${parca})`
        : `Periyodik bakım yaklaşıyor: ${d.tip} (kalan ${parca})`;
      if (!kuruYurut) {
        // `reported_by` sistem işinde de zorunlu (NOT NULL): planı açan kişi
        // yoksa aracın atanmış şoförü, o da yoksa emir açılmaz — uydurma
        // bir kimlik yazmaktansa kalem panoda durur.
        const { data: v } = await supabaseAdmin
          .from("vehicles")
          .select("assigned_worker_id")
          .eq("id", d.vehicleId)
          .maybeSingle();
        const kim = (v as { assigned_worker_id: string | null } | null)?.assigned_worker_id;
        if (kim) {
          const r = await createIsEmri(
            {
              vehicleId: d.vehicleId,
              aciklama,
              oncelik: d.gecti ? "yuksek" : "normal",
              kaynak: "periyodik",
            },
            kim
          );
          if (r.ok) acikArac.add(d.vehicleId);
        }
      }
      acilanEmirler.push({ plaka: d.plaka, tip: d.tip });
    }

    // 2) BİLDİRİM — yalnız dönüm noktalarında.
    if (bildirilsinMi(d, esik.km, esik.gun)) {
      const kalan = d.eksen === "km" ? (d.kalanKm ?? 0) : (d.kalanGun ?? 0);
      if (!kuruYurut) {
        await bakimBildir({
          vehicleId: d.vehicleId,
          plaka: d.plaka,
          tip: d.tip,
          eksen: d.eksen as "km" | "sure",
          kalan,
          gecti: d.gecti,
        });
      }
      bildirilenler.push({ plaka: d.plaka, tip: d.tip, eksen: d.eksen!, kalan });
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      kuruYurut,
      planDurumu: durumlar.length,
      esikte: esikte.length,
      // Ölçülemeyen odometre SESSİZ GEÇMEZ: kaç araçta km ekseni
      // hesaplanamadığı raporda görünür (lib/km-quality.ts dersi).
      kmOlculemeyen: durumlar.filter((d) => d.kmOlculemiyor).length,
      isEmriAcilan: acilanEmirler.length,
      bildirilen: bildirilenler.length,
      kalemler: bildirilenler,
    },
  };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, sebep: "yetkisiz" }, { status: 401 });
  }
  // `?kuru=1` — ne olacağını YAZMADAN ve GÖNDERMEDEN gösterir.
  const kuru = req.nextUrl.searchParams.get("kuru") === "1";
  const { status, body } = await run(kuru);
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
