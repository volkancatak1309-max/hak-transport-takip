import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/secure-compare";
import { omurIziniTazele, uyarilar, omurIziSayisi, saklamaAyari } from "@/lib/saklama-db";
import { uyariAciliyeti, uyariVarMi } from "@/lib/saklama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SAKLAMA UYARISI — günlük cron (migration 090).
 *
 * ═══ 🔴 BU UÇ HİÇBİR ŞEY SİLMEZ ═══
 *
 * İki iş yapar:
 *   1. CİHAZ ÖMÜR İZİNİ TAZELER — aracın ilk/son telemetri anı ham akıştan
 *      bağımsız yaşasın (yoksa silme sonrası "sessiz araç" uyarısı kaybolur)
 *   2. UYARI ÜRETİR — "uyarı eşiğini geçen X satır ham konum veriniz var"
 *
 * Silme YOK, silme anahtarı YOK, gün sayısına göre silen fonksiyon çağrısı
 * YOK. Silmeye bir insan karar verir, /admin/saklama ekranından, aralığı
 * kendisi seçerek, çift onayla ve denetim izine yazılarak.
 *
 * ═══ NEDEN ═══
 *
 * Saklama süresi ve silme kararı **veri sorumlusunundur** (müşteri); Galzura
 * veri İŞLEYENDİR. Ürünün bir kiracının verisini kendi takvimine göre
 * silmesi, işleyenin sorumlu yerine karar vermesi olurdu. Sistem "şu kadar
 * satırınız eşiği geçti" der ve durur.
 *
 * ═══ ⚠️ YASAL ÇIPA UYDURULMAZ ═══
 *
 * Uyarı, kiracının kendi eşiğini (`tenant_saklama.uyari_gun`) ve —VARSA—
 * `saklama_esikleri` tablosundaki DOĞRULANMIŞ yasal çıpayı taşır. O tablo
 * bugün BOŞ; bu durumda `yasalEsikGun: null` döner ve ekran hiçbir sayı
 * basmaz. Uydurma bir gün sayısı DACH müşterisine giderse sorumluluk doğar.
 *
 * ═══ NEDEN AYRI CRON, demo-retention'a EKLENMEDİ ═══
 *
 * `/api/cron/demo-retention` TENANT KİLİTLİ (yalnız galzura-demo), 14 gün
 * tutar ve GERÇEKTEN SİLER; işi "demoda disk şişmesin". Bu uç bir UYARI
 * üreticisidir ve hiçbir şey silmez. İkisini birleştirmek, demonun silme
 * davranışını gerçek kiracıya taşıma riski olurdu.
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

async function run(kuru: boolean) {
  const ayar = await saklamaAyari();
  if (ayar.tabloYok) {
    return {
      status: 503,
      body: {
        ok: false,
        error: "migration_090_yok",
        hint: "db/migrations/090_saklama_politikasi.sql çalıştırılmadı",
      },
    };
  }

  // 1 · ÖMÜR İZİ — kuru modda YAZMAZ, yalnız mevcut satır sayısını okur.
  const omur = kuru ? { ok: true, satir: await omurIziSayisi() } : await omurIziniTazele();
  if (!omur.ok) {
    return { status: 503, body: { ok: false, error: (omur as { hata?: string }).hata ?? "omur_izi_hata" } };
  }

  // 2 · UYARI
  const { uyarilar: liste, hata } = await uyarilar();
  if (hata) return { status: 503, body: { ok: false, error: hata } };

  const aktif = liste.filter(uyariVarMi).map((u) => ({
    ...u,
    aciliyet: uyariAciliyeti(u),
  }));

  return {
    status: 200,
    body: {
      ok: true,
      kuru,
      /** 🔴 Bu uç SİLMEZ. Alan bilerek burada: gövdeyi okuyan yanılmasın. */
      silmeYapildi: false,
      ayar: { uyariGun: ayar.uyariGun, ulkeKodu: ayar.ulkeKodu },
      omurIzi: omur.satir,
      uyariSayisi: aktif.length,
      uyarilar: aktif,
    },
  };
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // `?kuru=1` — ömür izini bile YAZMADAN yalnız okur.
  const kuru = req.nextUrl.searchParams.get("kuru") === "1";
  const { status, body } = await run(kuru);
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
