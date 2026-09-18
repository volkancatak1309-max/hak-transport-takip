import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { mobileTenant } from "@/lib/mobile-user";
import { aracOzeti } from "@/lib/vehicle-day-db";
import { aracDonemOzeti } from "@/lib/vehicle-ozet";
import { DONEMLER, donemCoz, donemGovdesi } from "../../../_performans/donem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/vehicles/[id]/ozet?donem=gun|hafta|ay
 *
 * Araç detayının DÖNEM SEÇİCİSİ — km · vardiya · paket · rölanti · yakıt,
 * araç ekseninde, tek çağrıda.
 *
 * ── DÖNEM DİLİ KOPYALANMADI ───────────────────────────────────────────────
 * `donemCoz` (app/api/mobile/_performans/donem.ts) — sürücü performans
 * uçlarının kullandığı fonksiyonun TA KENDİSİ. Pencereler panelin kayan
 * pencereleridir (gun=1, hafta=7, ay=30) ve `?tarih=` ile demirlenebilir.
 * İkinci bir dönem tanımı yazılsaydı bir gün biri "hafta = takvim haftası"
 * der, aynı araç iki ekranda iki farklı km gösterirdi.
 *
 * ⚠️ `?range=` DİYE BİR PARAMETRE YOK. Tanınmayan anahtar sessizce yutulur ve
 * `donem` verilmemiş sayılır → HAFTA döner. Bu davranış `donemCoz`un kendisine
 * ait ve bilerek öyle; burada ikinci bir ayrıştırma yapılmıyor.
 *
 * ── KAPI: requireMobileAdmin ──────────────────────────────────────────────
 * Kardeş araç uçlarıyla (metrikler · gunler · olaylar · duraklar · rota) aynı
 * katman. Şef ve şoför 403 `admin_required` alır.
 *
 * ── "ÖLÇÜLEMEDİ ≠ 0" ──────────────────────────────────────────────────────
 * `/metrikler` ucundaki desenin aynısı: boş bir "—" yöneticiye iş vermez,
 * sebebi yazılan boşluk verir. Her metrik ya SAYI ya null + SEBEP:
 *   km    → `vardiya_yok` (dönemde hiç vardiya yok) · `olculmedi` (vardiya var,
 *           çekirdek hiçbirinde km ölçemedi)
 *   yakıt → PARAMETRELİ NESNE (lib/fuel-vehicle.ts `YakitSebep`):
 *           {kod:"kapsama_dusuk", yuzde} · {kod:"l100_aralik_disi", deger} ·
 *           {kod:"arizali_sensor", yuzde} · {kod:"depo_yok"} · {kod:"km_yok"} ·
 *           {kod:"olculmedi"} · {kod:"rpc_yok"} · {kod:"hesaplanamadi"}
 *
 * ⚠️ YAKIT ÜÇLÜSÜ BİRLİKTE GİZLENİR: litre · € · L/100 üçü de null olur ve TEK
 * sebep taşır. Oranı denetleyemediğimiz litreyi göstermek, denetlenmemiş bir
 * sayıyı toplama sokmak olurdu (gerekçe: lib/fuel-vehicle.ts `yakitKapisi`).
 *
 * ⚠️ SEBEP PARAMETRELİ ki istemci kendi eşiğini uydurmasın: `{kod:
 * "kapsama_dusuk", yuzde: 1}` → "cihaz yakıt seviyesini vardiyanın %1'inde
 * gönderiyor". Kod tek başına yöneticiye iş vermiyordu.
 *
 * ── RÖLANTİ NEDEN null DEĞİL ──────────────────────────────────────────────
 * Rölanti epizot SAYMADIR: epizot yoksa gerçekten 0 rölanti vardır. Ölçüm
 * boşluğu diye bir hâli yok, o yüzden sebep bloğunda da yer almıyor. (Cihaz
 * hiç konuşmadıysa epizot da üretilmez — ama o durumda `km` zaten
 * `olculmedi` der ve yöneticiyi doğru yere gönderir.)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const arac = await aracOzeti(id);
  if (!arac) return mobileError(404, "not_found");

  const url = new URL(req.url);
  const cozum = donemCoz(url);
  if (!cozum.ok) {
    // Geçerli küme yanıtta: istemci hangi değerin kabul edildiğini dokümana
    // bakmadan görsün (kardeş uçlarla aynı sözleşme).
    return mobileError(400, cozum.kod, {
      ...(cozum.kod === "invalid_donem"
        ? { alan: "donem", gecerli: DONEMLER }
        : { alan: "tarih", bicim: "YYYY-MM-DD" }),
    });
  }
  const { cozum: d } = cozum;

  const ozet = await aracDonemOzeti(id, d.range);

  return Response.json({
    ok: true,
    aracId: arac.id,
    plaka: arac.plaka,
    saatDilimi: mobileTenant().saatDilimi,
    donem: donemGovdesi(d),
    km: ozet.km,
    /**
     * Km'nin hangi eksenden geldiği: `cihaz` (vardiya penceresi odometresi) ·
     * `sayac` (vardiya uçları) · `karisik` (dönemde ikisi de kullanıldı) ·
     * null (hiç ölçülemedi). Ekran sayıyı değil, GÜVENİ buradan ayarlar.
     */
    kmKaynak: ozet.kmKaynak,
    vardiyaSayisi: ozet.vardiyaSayisi,
    paket: ozet.paket,
    rolanti: ozet.rolanti,
    yakit: ozet.yakit,
    sebepler: ozet.sebepler,
    /** Km toplamının kaç vardiyadan geldiği — eksikliği sessiz bırakmaz. */
    kapsama: ozet.kapsama,
  });
}
