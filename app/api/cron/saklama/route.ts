import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/secure-compare";
import {
  saklamaAyari,
  omurIziniTazele,
  ozetiEksikAylar,
  ayOzetiYaz,
  kmDondur,
  kmDonmamisSayisi,
  omurIziSayisi,
  hamSil,
  aylariSilinmisIsaretle,
  type AyOzetSonucu,
} from "@/lib/saklama-db";
import { kesimTarihi, silmeKapisi } from "@/lib/saklama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * HAM TELEMETRİ SAKLAMA — günlük cron (migration 090).
 *
 * ═══ DÖRT İŞ, KESİN SIRAYLA ═══
 *
 *   1. ÖMÜR İZİ   — aracın ilk/son telemetri anını ham akıştan bağımsız yaz
 *   2. AYLIK ÖZET — kesimin gerisindeki her ay için raporun KENDİ cevabını dondur
 *   3. KM DONDUR  — vardiya km yargısını sabitle
 *   4. SİL        — ve YALNIZ 1-3 tamamsa
 *
 * ⚠️ SIRA TARTIŞMA DIŞI. 3'ü 4'ten sonra yapmak, düzeltmek istediği hatayı
 * kalıcılaştırır: ham gittikten sonra km kapısı her sıfır-farklı vardiyaya
 * sessizce "ölçülemedi" yazar — ve o bayrak kullanıcı seçimli aralıktaki
 * Excel/PDF çıktısına kadar gidiyor (app/admin/page.tsx:186).
 *
 * ═══ 🔴 FAIL-CLOSED ═══
 *
 * `tenant_saklama.silme_acik` varsayılanı **false**. Bu cron kaydı girilse,
 * doğru sırla çağrılsa bile ayar kapalıyken **TEK SATIR SİLİNMEZ** — 200
 * döner ve `silme: { izin:false, engel:"ayar_kapali" }` yazar. Sessizce
 * hiçbir şey yapmamak, çalışan bir temizlik sanılırdı.
 *
 * Kapı dört şart arar (lib/saklama.ts silmeKapisi): ayar açık · ömür izi
 * yazılmış · km dondurulmuş · kesimin gerisindeki HER ayın özeti tam.
 *
 * ═══ `?kuru=1` ═══
 *
 * Hiçbir şey YAZMADAN ve SİLMEDEN ne olacağını gösterir: kaç satır silinirdi,
 * hangi ayların özeti eksik, kaç vardiya dondurulmamış. İlk toplu silmeden
 * önce bununla bakılır.
 *
 * ═══ NEDEN AYRI CRON, demo-retention'a EKLENMEDİ ═══
 *
 * `/api/cron/demo-retention` TENANT KİLİTLİ (yalnız galzura-demo) ve 14 gün
 * tutuyor; işi "demoda disk şişmesin". Bu rota bir POLİTİKA yürütücüsü:
 * özet üretir, izi dondurur, gerekçe kapısına bakar. İkisini birleştirmek
 * demo kilidini gerçek kiracıya açmak ya da politikayı demoya dayatmak
 * olurdu.
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

/** Bir turda yazılacak en fazla ay özeti — her ay tam bir yakıt raporu koşusu. */
const TUR_BASINA_AY = 3;

async function run(kuru: boolean) {
  const ayar = await saklamaAyari();
  if (ayar.tabloYok) {
    return {
      status: 503,
      body: { ok: false, error: "migration_090_yok", hint: "db/migrations/090_saklama_politikasi.sql çalıştırılmadı" },
    };
  }

  const kesim = kesimTarihi(ayar.hamGun);

  // ── 1 · ÖMÜR İZİ ───────────────────────────────────────────────────────
  const omur = kuru ? { ok: true, satir: await omurIziSayisi() } : await omurIziniTazele();
  if (!omur.ok) {
    return { status: 503, body: { ok: false, error: (omur as { hata?: string }).hata ?? "omur_izi_hata" } };
  }

  // ── 2 · AYLIK ÖZET ─────────────────────────────────────────────────────
  const { eksik, hazir, hata: ozetHata } = await ozetiEksikAylar(kesim);
  if (ozetHata) return { status: 503, body: { ok: false, error: ozetHata } };

  const yazilan: AyOzetSonucu[] = [];
  if (!kuru) {
    for (const ay of eksik.slice(0, TUR_BASINA_AY)) {
      const r = await ayOzetiYaz(ay);
      if (!r.ok) return { status: 500, body: { ok: false, error: r.hata ?? "ozet_hata", ay } };
      if (r.sonuc) yazilan.push(r.sonuc);
    }
  }

  // ── 3 · KM DONDURMA ────────────────────────────────────────────────────
  const km = kuru
    ? { ok: true, dondurulan: 0, kalan: await kmDonmamisSayisi() }
    : await kmDondur();
  if (!km.ok) return { status: 500, body: { ok: false, error: (km as { hata?: string }).hata ?? "km_dondur_hata" } };

  // ── 4 · SİLME KAPISI ───────────────────────────────────────────────────
  // Özet/dondurma bu turda ilerlemiş olabilir → kapıya GÜNCEL sayılarla bak.
  const kalanEksik = kuru ? eksik : eksik.slice(TUR_BASINA_AY);
  const guncelHazir = kuru ? hazir : [...hazir, ...yazilan.map((y) => y.ay)];
  const kapi = silmeKapisi({
    silmeAcik: ayar.silmeAcik,
    hazirAylar: guncelHazir,
    ozetiEksikAylar: kalanEksik,
    kmDonmamisVardiya: km.kalan,
    omurIziSatir: omur.satir,
  });

  let silme: { telemetri: number; konum: number; tur: number } | null = null;
  if (kapi.izin || kuru) {
    const s = await hamSil(ayar.hamGun, kuru || !kapi.izin);
    if (!s.ok) return { status: 500, body: { ok: false, error: s.hata ?? "silme_hata" } };
    silme = { telemetri: s.telemetri, konum: s.konum, tur: s.tur };
    if (kapi.izin && !kuru) await aylariSilinmisIsaretle(kapi.hazirAylar);
  }

  return {
    status: 200,
    body: {
      ok: true,
      kuru,
      ayar: { hamGun: ayar.hamGun, silmeAcik: ayar.silmeAcik, gerekce: ayar.gerekce },
      kesim: kesim.toISOString(),
      omurIzi: omur.satir,
      ozet: { yazilan, eksikKalan: kalanEksik, hazir: guncelHazir },
      km: { dondurulan: km.dondurulan, kalan: km.kalan },
      silme: {
        izin: kapi.izin,
        engel: kapi.engel,
        ayrinti: kapi.ayrinti,
        // kuru modda ya da kapı kapalıyken bu sayı "silinirdi", "silindi" değil.
        ...(silme ?? { telemetri: 0, konum: 0, tur: 0 }),
        uygulandi: kapi.izin && !kuru,
      },
    },
  };
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // `?kuru=1` — hiçbir şey yazmadan ve silmeden ne olacağını gösterir.
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
