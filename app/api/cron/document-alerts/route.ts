import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/secure-compare";
import { listExpiringDocuments, type ExpiringDocument } from "@/lib/documents-db";
import { belgeBildir } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * BELGE UYARISI BİLDİRİMİ — günlük cron (migration 078).
 *
 * ═══ NEDEN HER GÜN HERKESE DEĞİL, EŞİK GÜNLERİNDE ═══
 *
 * Eşiğe giren bir belge 30 gün boyunca her sabah bildirim gönderseydi, 30
 * bildirim sonunda kimse okumazdı — ve okunmayan bir uyarı, hiç olmayan bir
 * uyarıdan kötüdür (kullanıcı kanalı tümden sessize alır). Bildirim yalnız
 * DÖNÜM NOKTALARINDA gider:
 *
 *   · eşiğe girildiği gün        (tür başına warn_days, varsayılan 30)
 *   · 7 gün kala                 (yenileme randevusu için son makul an)
 *   · 1 gün kala                 (son uyarı)
 *   · dolduğu gün                (0)
 *   · dolduktan sonra HAFTADA BİR (days % 7 === 0) — düzeltilene kadar susmaz
 *
 * Pano kalemi bundan BAĞIMSIZ: Dikkat listesinde belge eşiğe girdiği andan
 * düzeltilene kadar HER GÜN durur. Bildirim dürtme, pano ise durum kaydıdır.
 *
 * ═══ DURUM TUTULMUYOR — BİLİNÇLİ VE BEDELİ VAR ═══
 *
 * Tetikleme günün sayısından TÜRETİLİYOR; "en son ne zaman bildirdim" diye bir
 * kolon yok. Kazanç: 078'e ikinci bir yazma yolu ve senkron tutulacak ikinci
 * bir gerçek eklenmiyor.
 *
 * ⚠️ BEDELİ: cron bir günü kaçırırsa (sunucu, zamanlayıcı, ağ) O GÜNE denk
 * gelen dönüm noktası kaçar ve tekrar denenmez. Sonraki dönüm noktası yine
 * çalışır, pano kalemi zaten hiç kaybolmaz. Bu kabul edilebilir çünkü bildirim
 * BURADA tek başına bir kanal değil — panonun tekrarlayıcısı.
 *
 * ═══ KAPSAM ═══
 *
 * `listExpiringDocuments(null)` — kiracının TÜM şoförleri. Bu bir kullanıcı
 * yüzeyi değil, sistem işi: filo şefi kapsamı burada uygulanmaz, çünkü
 * bildirimin ALICI tarafı zaten kapsamlı (`belgeBildir` → `yonetimTarafi`,
 * yalnız o şoförün filosundaki şefler).
 */

/** Bildirimin gideceği dönüm noktaları. */
function donumNoktasiMi(days: number, warnDays: number): boolean {
  if (days < 0) {
    // Dolmuş belge haftada bir hatırlatılır; her gün bağırmaz ama susmaz da.
    return days % 7 === 0;
  }
  if (days === 0 || days === 1 || days === 7) return true;
  return days === warnDays;
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
  const { items, tabloYok } = await listExpiringDocuments(null);
  if (tabloYok) {
    return {
      status: 503,
      body: {
        ok: false,
        sebep: "tablo_yok",
        mesaj: "migration 078 (worker_documents / document_types) çalıştırılmamış",
      },
    };
  }

  const gonderilecek: ExpiringDocument[] = items.filter((d) =>
    donumNoktasiMi(d.days, d.warnDays)
  );

  if (!kuruYurut) {
    // Sıra ile gönderiliyor: her belge AYRI alıcı kümesine gidiyor (şoför +
    // o şoförün yönetimi), yani duyurudaki gibi tek partide toplanamaz.
    // Belge sayısı kişi başına birkaç satır olduğu için hacim sorun değil.
    for (const d of gonderilecek) {
      await belgeBildir({
        soforId: d.workerId,
        soforAd: d.workerName,
        belgeTuru: d.typeLabel,
        kalanGun: d.days,
        sonTarih: d.expiresAt,
      });
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      kuruYurut,
      esiktekiBelge: items.length,
      bildirilen: gonderilecek.length,
      kalemler: gonderilecek.map((d) => ({
        sofor: d.workerName,
        belge: d.typeLabel,
        sonTarih: d.expiresAt,
        kalanGun: d.days,
      })),
    },
  };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, sebep: "yetkisiz" }, { status: 401 });
  }
  // `?kuru=1` — hangi bildirimlerin gideceğini GÖNDERMEDEN gösterir.
  // Zamanlayıcıyı kurmadan önce doğrulamak ve canlıda kanıt üretmek için;
  // gerçek bildirim göndermeden aynı hesabı yapar.
  const kuru = req.nextUrl.searchParams.get("kuru") === "1";
  const { status, body } = await run(kuru);
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
