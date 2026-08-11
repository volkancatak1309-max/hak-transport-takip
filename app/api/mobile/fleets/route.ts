import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { FILO_ADI_MAX, FILO_TAVANI, filoAdiniAyikla } from "@/lib/fleets";
import { createFleet, listFleets } from "@/lib/fleets-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * FİLO YÖNETİMİ — liste + yeni filo (migration 059).
 *
 * ── KAPI: requireMobileAdmin ──────────────────────────────────────────────
 * Panel paritesi: filo tanımını değiştiren yüzey /admin/araclar'dır ve o sayfa
 * `requireAdmin()` ile korunuyor → filo ŞEFİ giremez. Şef kendi filosunu
 * görür ama filoları YENİDEN DÜZENLEYEMEZ; kendi filosuna araç çekebilmesi,
 * karşı filodan araç almak demek olurdu. Şef ve şoför 403 `admin_required`.
 *
 * ── MIGRATION 059 ÇALIŞTIRILMADAN ─────────────────────────────────────────
 * GET ÇALIŞIR: filolar 023/029 CHECK kümesinden türetilir ve sayımlar
 * GERÇEKTİR (araç/personel bugünkü kolonlardan sayılıyor). Yanıt bunu
 * `tabloDurumu:"tablo_yok"` ile SÖYLER — istemci "yeni filo" düğmesini o
 * bilgiye bakarak kapatabilsin. POST ise 503 döner: adı yazacak yer yok.
 */

/**
 * GET /api/mobile/fleets — filolar + her birinde araç/personel sayısı.
 *
 * ── GÖRÜNMEYEN FİLO DA LİSTELENİR ─────────────────────────────────────────
 * `ACTIVE_FLEETS` (lib/tenant.ts) kiracının arayüzünde hangi filonun
 * gösterileceğini süzüyor. Bu uç o süzgeci UYGULAMAZ, yalnız `gorunur`
 * bayrağını taşır: yönetim ekranı göremediği filoyu yönetemez ve içinde araç
 * duran bir filoyu listeden düşürmek onu SESSİZCE kaybetmek olurdu.
 *
 * ── SAYFALAMA YOK ─────────────────────────────────────────────────────────
 * Tavan beş satır. `page` bloğu taşımak, hiçbir zaman ikinci sayfası olmayan
 * bir liste için sözleşme kirletmek olurdu.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const sonuc = await listFleets();
  if (!sonuc.ok) return mobileError(503, "db_error", { sebep: sonuc.sebep });

  const { liste } = sonuc;
  return Response.json({
    ok: true,
    // Boş/eksik listenin SEBEBİ taşınır: "filo yok" ile "059 çalışmamış" ayrı şeyler.
    tabloDurumu: liste.tabloDurumu,
    enFazlaFilo: FILO_TAVANI,
    filolar: liste.filolar,
    filosuzPersonel: liste.filosuzPersonel,
    bilinmeyenFilolar: liste.bilinmeyenFilolar,
    sayimKirpildi: liste.sayimKirpildi,
  });
}

/**
 * POST /api/mobile/fleets — yeni filo. Gövde `{ ad?: string | null }`.
 *
 * ── GÖVDE İSTEĞE BAĞLI ────────────────────────────────────────────────────
 * Adsız POST geçerlidir: sunucu sırayı belirler ve ad "N. Filo" olur. Bu
 * yüzden BOŞ GÖVDE ile BOZUK GÖVDE ayrılıyor — `JSON.parse` boş metinde de
 * fırlatır ve ayrılmasaydı adsız filo açmak `invalid_json` alırdı.
 *
 * ── KOD İSTEMCİDEN GELMEZ ─────────────────────────────────────────────────
 * Gövdede `kod`/`sira` diye bir alan YOK. Kod 30 araç satırında yazılı olan
 * şeydir; istemcinin seçmesine izin vermek, var olan bir filonun üstüne
 * yazabilmesi demekti.
 *
 * ── TAVAN ─────────────────────────────────────────────────────────────────
 * Beşinci filodan sonrası 400 `limit_reached` ve yanıt hem tavanı hem mevcut
 * sayıyı söyler. Asıl uygulayıcı şemadır (059: sort_order 1..5 + unique);
 * buradaki denetim yalnız cevabı anlaşılır kılar.
 *
 * ⚠️ HIZ SINIRI (rate limit) YOK — paket/arıza/erteleme uçlarıyla aynı durum.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  let body: unknown = {};
  const ham = await req.text();
  if (ham.trim().length > 0) {
    try {
      body = JSON.parse(ham);
    } catch {
      return mobileError(400, "invalid_json");
    }
  }

  const ayikla = filoAdiniAyikla(body, { zorunlu: false });
  if (!ayikla.ok) {
    return mobileError(400, ayikla.kod, {
      alan: ayikla.alan,
      ...(ayikla.sebep ? { sebep: ayikla.sebep } : {}),
      ...(ayikla.kod === "too_long"
        ? { enFazla: FILO_ADI_MAX, uzunluk: ayikla.uzunluk }
        : {}),
    });
  }

  const sonuc = await createFleet(ayikla.ad);
  if (!sonuc.ok) {
    if (sonuc.sebep === "tavan") {
      return mobileError(400, "limit_reached", {
        enFazla: FILO_TAVANI,
        mevcut: sonuc.mevcut,
      });
    }
    // Yarış: araya giren istek son yuvayı aldı. "Sunucu arızası" değil, tekrar
    // denenebilir bir çakışma — istemci listeyi tazeleyip yeniden karar verir.
    if (sonuc.sebep === "cakisma") {
      return mobileError(409, "conflict", { sebep: "sira_dolu" });
    }
    // "Tablo yok" ≠ "yazma başarısız": ilki migration 059'un çalıştırılmadığı
    // kurulumdur ve yöneticiye BAŞKA iş yaptırır.
    return mobileError(503, "db_error", { sebep: sonuc.sebep });
  }

  // Sayımlar BİLEREK yok: yeni filo boştur ve "0" demek için sorgu atmak
  // gereksiz. Sayı isteyen GET'ten okur (tek sözleşme, tek kaynak).
  return Response.json({ ok: true, filo: sonuc.filo }, { status: 201 });
}
