import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/secure-compare";
import { fetchWobDieselPrices, WOB_SOURCE_KEY } from "@/lib/fuel-price-source";
import { upsertFuelPrices } from "@/lib/fuel-price-db";

// Service-role Supabase → Node, asla edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * YAKIT FİYATI SENKRONU — AB Weekly Oil Bulletin → fuel_price_reference.
 *
 * ═══ NEDEN GÜNDE 1, KAYNAK HAFTALIK OLMASINA RAĞMEN ═══
 *
 * Kaynak Perşembe yayınlanıyor ama "Perşembe koş" demek üç şeyi kaybettirirdi:
 *   (a) yayın saati garanti değil — kaçırılan hafta bir sonraki Perşembe'ye
 *       kadar fark edilmezdi;
 *   (b) UUID kırılırsa haberi 7 gün sonra alırdık (bkz. lib/fuel-price-source
 *       tuzak 4);
 *   (c) günlük koşmanın bedeli 14 KB — yani yok.
 * Yazma idempotent (077'deki UNIQUE), aynı satır yeniden yazılır, zarar yok.
 *
 * ═══ ÜÇ KAPI ═══
 *
 * 1. CRON_SECRET — mevcut cron deseniyle aynı (?secret= veya Bearer),
 *    zamanlama-güvenli karşılaştırma. Sır tanımlı değilse uç KAPALIDIR
 *    (fail-closed): env'i unutmak "herkese açık" anlamına gelemez.
 * 2. DÖRT MUHAFIZ — lib/fuel-price-source içinde; biri bile durdurursa
 *    HİÇBİR ŞEY YAZILMAZ ve sebep yanıtta döner.
 * 3. TABLO YOKLUĞU — migration 077 uygulanmamışsa yazma `tablo_yok` ile
 *    düşer ve yanıt bunu ayrı bir sebep olarak söyler (migration çalıştır ≠
 *    tekrar dene).
 *
 * ═══ SESSİZ BAŞARISIZLIK YASAK ═══
 *
 * Hiçbir dal boş 200 dönmez. Muhafız durdurduysa HTTP 502 + `guard` alanı,
 * tablo yoksa 503 + `sebep`. Zamanlayıcı bunları görebilsin diye durum
 * kodları ayrı: 5xx alan bir cron servisi uyarı gönderir, 200 alan göndermez.
 *
 * ⚠️ BU UÇ KİRACIYA ÖZGÜ DEĞİL. Yazdığı satır ÜLKE eksenlidir; hangi
 * dağıtımdan tetiklendiği fark etmez, aynı ülkenin fiyatı aynıdır. Yani
 * çok kiracılı kurulumda tek bir dağıtımda kurmak yeterlidir — ama her
 * kiracının kendi veritabanı olduğu için (bkz. lib/brand.ts) pratikte her
 * kiracıda ayrı ayrı kurulur ve her biri kendi tablosunu doldurur.
 */

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const qs = req.nextUrl.searchParams.get("secret");
  if (safeEqual(qs, expected)) return true;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return safeEqual(auth.slice(7), expected);
  return false;
}

async function sync() {
  const kaynak = await fetchWobDieselPrices();
  if (!kaynak.ok) {
    return {
      status: 502,
      body: {
        ok: false,
        asama: "kaynak" as const,
        guard: kaynak.guard,
        mesaj: kaynak.message,
        kaynakAnahtari: WOB_SOURCE_KEY,
      },
    };
  }

  const yazma = await upsertFuelPrices(kaynak.records);
  if (!yazma.ok) {
    return {
      status: yazma.sebep === "tablo_yok" ? 503 : 500,
      body: {
        ok: false,
        asama: "yazma" as const,
        sebep: yazma.sebep,
        mesaj:
          yazma.sebep === "tablo_yok"
            ? "migration 077 (fuel_price_reference) çalıştırılmamış"
            : yazma.mesaj,
        referansTarihi: kaynak.referenceDate,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      referansTarihi: kaynak.referenceDate,
      yasGun: kaynak.ageDays,
      yazilan: yazma.yazilan,
      kayitlar: kaynak.records.map((r) => ({
        ulke: r.countryCode,
        yakit: r.fuelType,
        fiyat: r.price,
        birim: `${r.currency}/L`,
      })),
    },
  };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, sebep: "yetkisiz" }, { status: 401 });
  }
  const { status, body } = await sync();
  return NextResponse.json(body, { status });
}

/** Bazı zamanlayıcılar yalnız POST atar — aynı kapı, aynı iş. */
export async function POST(req: NextRequest) {
  return GET(req);
}
