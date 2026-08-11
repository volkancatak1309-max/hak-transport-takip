import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { mobileTenant } from "@/lib/mobile-user";
import { getVehicleDeviceRoute } from "@/lib/route-history";
import { gecerliGun, sonGunler } from "@/lib/vehicle-day";
import { aracOzeti } from "@/lib/vehicle-day-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/vehicles/[id]/rota?tarih=YYYY-MM-DD&eslesme=0|1
 * Bir kiracı gününün ZAMAN DAMGALI izi — trip replay'in ana ucu.
 *
 * KAPI: requireMobileAdmin ↔ /admin/araclar/[id]/rota sayfasının requireAdmin()'i.
 * VERİ: `getVehicleDeviceRoute` — o sayfanın okuduğu fonksiyonun AYNISI. Nokta
 * seyreltmesi de onun mantığı (900 tavan, ilk ve son nokta daima korunur).
 *
 * ── HIZ VE KONTAK BU TURDA TAŞINMAYA BAŞLADI ───────────────────────────────
 * `listVehicleTrack` `speed_kmh` ve `ignition_on`u hep seçiyordu;
 * `getVehicleDeviceRoute` ikisini de `.map()` içinde atıyordu (route-history.ts).
 * Alt şeritteki km/h ve durum çipi bunlara bağlı olduğu için düzeltme ORADA
 * yapıldı — panelin RouteReplay'i iki alanı da okumadığından o ekran değişmedi.
 *
 * ── OSRM VARSAYILAN OLARAK KAPALI ──────────────────────────────────────────
 * Yol eşlemesi 6 sn'lik DIŞ bağımlılıktır (public OSRM). Telefon önizlemesi
 * bunu hak etmiyor: `eslesme=1` denmedikçe ham çizgi döner ve `geometri` null
 * kalır — istemci `noktalar`ı çizer. Vardiya detayı ucu da aynı kararı verdi.
 * `eslesme=1` geldiğinde eşleme DENENİR; başarısızsa `eslendi:false` döner ve
 * `geometri` ham çizgiye düşer (uç asla hata vermez).
 *
 * ── SEYRELTME SÖYLENİR ─────────────────────────────────────────────────────
 * `toplamNokta` ham seri, `nokta` çizilen, `orneklendi` ikisi farklıysa true.
 * 3.000 noktalık bir günde 900 nokta göstermek doğru; bunu SÖYLEMEMEK değil.
 *
 * `tarih` verilmezse bugünün kiracı günü — panel rota sayfasının kuralı
 * (`sp.date || viennaDayKey(new Date())`). Verilip de geçersizse 400.
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

  const sp = new URL(req.url).searchParams;
  const ham = sp.get("tarih");
  const tarih = ham === null ? sonGunler(1)[0] : ham;
  if (!gecerliGun(tarih)) return mobileError(400, "invalid_date");
  const eslesmeIstendi = sp.get("eslesme") === "1";

  const route = await getVehicleDeviceRoute(id, tarih, { match: eslesmeIstendi });
  const noktalar = route.points.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    an: p.t,
    hizKmh: p.speed ?? null,
    yon: p.heading ?? null,
    kontak: p.ignition ?? null,
  }));

  return Response.json({
    ok: true,
    aracId: arac.id,
    plaka: route.plate ?? arac.plaka,
    tarih,
    saatDilimi: mobileTenant().saatDilimi,
    toplamNokta: route.totalRaw,
    nokta: noktalar.length,
    orneklendi: noktalar.length < route.totalRaw,
    /** Cihaz yön (course) bildiriyor mu — ok mu, düz iğne mi çizilecek. */
    yonlu: route.directional === true,
    eslesmeIstendi,
    eslendi: route.matched,
    geometri: eslesmeIstendi ? route.geometry : null,
    baslangic: noktalar[0] ?? null,
    bitis: noktalar.length ? noktalar[noktalar.length - 1] : null,
    noktalar,
  });
}
