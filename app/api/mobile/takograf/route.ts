import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { parsePage, pageInfo } from "@/lib/mobile-list";
import { hizSiniriHarca, hizSiniriIadeEt } from "@/lib/upload-core";
import { audit } from "@/lib/security-log";
import {
  dosyaYukle,
  dosyaListesi,
  shaIleBul,
  type TakografDosya,
} from "@/lib/takograf-db";
import {
  DOSYA_TURLERI,
  EN_BUYUK_BAYT,
  muhurSebepKodu,
  yuklemeDenetle,
  type DosyaTuru,
} from "@/lib/takograf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ⚠️ MOBİL UÇLAR ARASINDA DIŞ SERVİSE SENKRON ÇAĞRI YAPAN TEK UÇ.
 *
 * Yükleme, okuyucu servise 35 sn'ye kadar bekleyebilen bir çağrı yapıyor
 * (`SERVIS_ZAMAN_ASIMI_MS`). Next'in varsayılan fonksiyon süresine güvenmek,
 * bir gün sessizce kesilen bir isteğe dönüşürdü: dosya Storage'da, satır
 * `bekliyor`da kalır ve istemci "yükleme başarısız" sanırdı. Süre AÇIKÇA
 * yazılıyor — emsal `app/api/cron/aylik-metrik/route.ts`.
 */
export const maxDuration = 300;

/**
 * POST /api/mobile/takograf — .ddd YÜKLE (multipart)
 * GET  /api/mobile/takograf — süzgeçli, sayfalı liste
 *
 * ═══ KAPI: YALNIZ YÖNETİCİ ═══
 *
 * `requireMobileAdmin` — şef ve şoför 403 `admin_required`. Panelin kuralının
 * aynısı (`app/actions/takograf.ts`: "Takograf indirmesi ŞİRKET KARTI
 * sahibinin yükümlülüğüdür — bir şirket uyum işi, filo operasyonu değil").
 *
 * ═══ AYRIŞTIRMA SENKRON — VE BU ÖLÇÜLMÜŞ BİR KARAR ═══
 *
 * `dosyaYukle` üçüncü adımda servisi SENKRON çağırıyor ve mobil uç onu aynen
 * kullanıyor. Asenkrona ("satır bekliyor, cron sonra okur") geçmek üç şey
 * isterdi: yeni bir cron ucu, `docs/CRON-KAYITLARI.md` kaydı ve o cron'u
 * çalıştıracak bir zamanlayıcı. Bunların hiçbiri bu turun kapsamında değil ve
 * PANEL BUGÜN SENKRON ÇALIŞIYOR — mobili ayırmak, aynı işi yapan iki yüzeyi
 * iki farklı zamanlama modeline bölmek olurdu.
 *
 * ⚠️ Servis erişilemezse istek YİNE DE BAŞARILIDIR (201): dosya arşivde, satır
 * `bekliyor`da. Ayrıştırma sonucu gövdede görünür; istemci onu hata sanmasın
 * diye `ayristirma` bloğu ayrı taşınıyor.
 *
 * ═══ HIZ SINIRI UÇTA — ÇÜNKÜ ÇEKİRDEK DIŞINDA ═══
 *
 * `lib/takograf-db.ts` `lib/upload-core.ts`in gerekçeli istisnası
 * (`scripts/check-dosya-yukleme.mjs` D1): kendi yol deseni (`yyyy/mm/uuid.ddd`,
 * kişi klasörü YOK), kendi SHA256 tekilliği ve kendi durum makinesi var. Bu
 * yüzden `yukleVeYaz`ın hız freni o yoldan GEÇMİYOR — ve bir dosya yükleme ucu
 * frensiz kalamaz. Fren burada, çekirdeğin KENDİ fonksiyonlarıyla uygulanıyor:
 * ikinci bir sayaç yazılmadı.
 *
 * SIRA ÖNEMLİ: doğrulama → fren → yazma.
 *   · Bozuk bir istek (uzantı/boyut) kullanıcının kotasını YEMEZ.
 *   · Sunucu kusuru (depo/kayıt yazılamadı) kotayı İADE EDER.
 *   · `zaten_yuklu` (409) kotayı İADE ETMEZ: istek geçerliydi, iş yapıldı,
 *     cevap "bu dosya zaten var" oldu. Aksi hâlde aynı dosyayı sonsuz kez
 *     göndermek bedava olurdu.
 *
 * ═══ `tur` ALANI İSTEMCİDEN ALINMAZ ═══
 *
 * Görevde `tur=kart|vu` alanı var ama YAZILAN değeri o BELİRLEMEZ: satırın
 * `tur`u `turTahmin(baytlar)` ile dosyanın ilk baytlarından tespit edilir ve
 * HK091 onu değişmez kılar. İstemcinin söylediğine göre yazsaydık, yanlış
 * seçilen bir açılır listede kayıt kalıcı olarak yanlış türde donardı.
 * İstemci yine de gönderebilir; uyuşmazlık REDDEDİLMEZ, yanıtta
 * `turUyusmazligi` ile bildirilir.
 *
 * ═══ HATA KODLARI ═══
 *   401 missing_token / invalid_token / revoked / inactive
 *   403 admin_required
 *   400 dosya_yok · gecersiz_govde · bos_dosya · cok_buyuk · yanlis_uzanti · invalid
 *   409 zaten_yuklu   (+ mevcutId)
 *   429 hiz_siniri    (+ Retry-After)
 *   503 depo_yazilamadi · kayit_yazilamadi · okunamadi · db_error
 */

/** Liste satırı — panelin gösterdiği alanlar, sayımlar HARİÇ (başlık §). */
function listeGovdesi(d: TakografDosya) {
  return {
    id: d.id,
    dosyaAdi: d.dosyaAdi,
    tur: d.tur,
    bayt: d.bayt,
    nesil: d.nesil,
    kartNo: d.kartNo,
    aracPlaka: d.aracPlaka,
    aracVin: d.aracVin,
    donem: d.donemBas || d.donemBit ? { bas: d.donemBas, bit: d.donemBit } : null,
    muhur: { durum: d.muhurDurumu, sebepKodu: muhurSebepKodu(d.muhurSebep) },
    ayristirma: { durum: d.ayristirmaDurumu, hata: d.ayristirmaHata, surum: d.ayristiriciSurum },
    yukleyenAd: d.yukleyenAd,
    yuklendiAt: d.yuklendiAt,
  };
}

export async function POST(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;
  const { worker } = guard.actor;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return mobileError(400, "gecersiz_govde", { beklenen: "multipart/form-data" });
  }

  const f = form.get("dosya") ?? form.get("file");
  if (!(f instanceof File)) {
    return mobileError(400, "dosya_yok", { alan: "dosya" });
  }

  const baytlar = new Uint8Array(await f.arrayBuffer());
  const ad = f.name || "yukleme.ddd";

  /**
   * ⚠️ BOYUT/UZANTI DENETİMİ ÇEKİRDEKTEN — burada ikinci bir `> 5 * 1024 * 1024`
   * karşılaştırması YAZILMIYOR. Tavan tek yerde (`EN_BUYUK_BAYT`); ikinci bir
   * sayı, biri değiştiğinde sessizce ayrışırdı.
   */
  const denetim = yuklemeDenetle(ad, baytlar.byteLength);
  if (denetim) {
    return mobileError(400, denetim, { tavanBayt: EN_BUYUK_BAYT, gelenBayt: baytlar.byteLength });
  }

  // ── FREN (doğrulamadan SONRA, yazmadan ÖNCE) ───────────────────────────
  const fren = await hizSiniriHarca(worker.id);
  if (!fren.ok) {
    return Response.json(
      { ok: false, error: "hiz_siniri", retryAfter: fren.retryAfter },
      { status: 429, headers: { "Retry-After": String(fren.retryAfter ?? 60) } }
    );
  }

  const sonuc = await dosyaYukle({ ad, baytlar, yukleyenWorkerId: worker.id });

  if (!sonuc.ok) {
    if (sonuc.hata === "zaten_yuklu") {
      /**
       * `mevcutId` iki koddan gelebiliyor: ön-kontrol onu DOLDURUYOR, UNIQUE
       * ihlali dalı (yarış) DOLDURMUYOR. İkinci dalda SHA ile bir kez daha
       * aranıyor — "zaten var" deyip hangisi olduğunu söylememek, kullanıcıyı
       * arşivde el yordamıyla aramaya bırakırdı.
       */
      const mevcutId = sonuc.mevcutId ?? (await shaIleBul(shaHesapla(baytlar)));
      return mobileError(409, "zaten_yuklu", { mevcutId, yaris: !sonuc.mevcutId });
    }

    // Sunucu kusuru → kota iade. Kullanıcının suçu değil.
    await hizSiniriIadeEt(worker.id);
    if (sonuc.hata === "migration_091_yok") {
      return mobileError(503, "db_error", { sebep: "tablo_yok", migration: "091" });
    }
    return mobileError(503, sonuc.hata, {
      ayrinti: sonuc.ayrinti,
      dosyaTemizlendi: sonuc.dosyaTemizlendi,
    });
  }

  const d = sonuc.dosya;

  // Panelin izinin aynısı — dosya ADI yazılmaz (kişisel ad taşıyabilir).
  await audit(
    worker.id,
    "create",
    `takograf_yukle:${sonuc.id} tur=${d.tur} ayristirma=${d.ayristirmaDurumu} muhur=${d.muhurDurumu} kaynak=mobil`
  );

  let panelTazelendi = true;
  try {
    revalidatePath("/admin/takograf");
  } catch {
    panelTazelendi = false;
  }

  const bildirilen = String(form.get("tur") ?? "").toLowerCase();
  const turUyusmazligi =
    bildirilen && (DOSYA_TURLERI as readonly string[]).includes(bildirilen) && bildirilen !== d.tur
      ? { gonderilen: bildirilen, yazilan: d.tur }
      : null;

  return Response.json(
    {
      ok: true,
      ...listeGovdesi(d),
      /** Sayımlar burada GERÇEK: tek dosya, `count: "exact"` gerekmiyor. */
      faaliyetSayisi: d.faaliyetSayisi,
      olaySayisi: d.olaySayisi,
      turUyusmazligi,
      panelTazelendi,
    },
    { status: 201 }
  );
}

/**
 * SHA'yı YARIŞ DALINDA yeniden hesaplar.
 *
 * Çekirdek `zaten_yuklu`yu iki ayrı yoldan dönebiliyor: ön-kontrol (`mevcutId`
 * DOLU) ve UNIQUE ihlali (`mevcutId` BOŞ — araya başka bir istek girmiş).
 * İkinci dalda kimliği söyleyebilmek için SHA burada bir kez daha üretiliyor;
 * algoritma çekirdekle birebir aynı (`createHash("sha256")`).
 */
function shaHesapla(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

// ═══════════════════════════════ LİSTE ══════════════════════════════════

/**
 * GET /api/mobile/takograf
 *
 * Süzgeçler: `?tur=kart|vu` · `?kart=` · `?plaka=` · `?yukleyen=<uuid>` ·
 * `?donem=YYYY-MM` · `?limit=` `?offset=` (varsayılan 50, tavan 200).
 *
 * ═══ 🔴 `?sofor=` VE `?arac=` NEDEN YOK ═══
 *
 * ÖLÇÜLDÜ (21.09.2026): `takograf_dosyalari.worker_id` ve `vehicle_id`
 * kolonları 091'de "TÜRETİLMİŞ BAĞ" diye tanımlı ama HİÇBİR KOD YOLU ONLARI
 * YAZMIYOR — ne insert (`lib/takograf-db.ts` `dosyaYukle`) ne ayrıştırma
 * güncellemesi (`ayristirVeYaz`). galzura-demo'daki tek dosyada ikisi de null.
 * Yani `?sofor=<uuid>` süzgeci DAİMA 0 satır döndürürdü: çalışıyor görünen,
 * hiçbir zaman eşleşmeyen bir süzgeç.
 *
 * Yerine GERÇEKTEN YAZILAN kolonlar veriliyor: `?kart=` (`kart_no`) ve
 * `?plaka=` (`arac_plaka` ∪ `arac_vin`). `?sofor=`/`?arac=` gönderilirse
 * SESSİZCE YOK SAYILMAZ — 400 döner ve hangi adların geçerli olduğunu söyler.
 * Kimlik bağının kurulması ayrı bir iş (bkz. docs/TAKOGRAF-UCLARI.md).
 */
const GECERLI_SUZGECLER = new Set([
  "tur",
  "kart",
  "plaka",
  "yukleyen",
  "donem",
  "limit",
  "offset",
]);

const AY = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);

  // Tanınmayan süzgeç SESSİZCE düşmez: istemci yanlış listeye bakmasın.
  for (const k of url.searchParams.keys()) {
    if (!GECERLI_SUZGECLER.has(k)) {
      return mobileError(400, "invalid", {
        alan: k,
        gecerli: [...GECERLI_SUZGECLER],
        ...(k === "sofor" || k === "arac"
          ? {
              sebep: "kimlik_bagi_yok",
              aciklama:
                "takograf_dosyalari.worker_id / vehicle_id hiçbir kod yoluyla yazılmıyor; bu süzgeç daima boş dönerdi. Yerine kart= / plaka= kullanın.",
            }
          : {}),
      });
    }
  }

  const turHam = url.searchParams.get("tur");
  if (turHam && !(DOSYA_TURLERI as readonly string[]).includes(turHam)) {
    return mobileError(400, "invalid", { alan: "tur", gecerli: DOSYA_TURLERI });
  }

  const donemHam = url.searchParams.get("donem");
  let donem: { bas: string; bit: string } | null = null;
  if (donemHam) {
    if (!AY.test(donemHam)) {
      return mobileError(400, "invalid", { alan: "donem", bicim: "YYYY-MM" });
    }
    const [y, a] = donemHam.split("-").map(Number);
    // Ayın ilk anı → ertesi ayın ilk anından bir milisaniye öncesi.
    const bas = new Date(Date.UTC(y, a - 1, 1));
    const bit = new Date(Date.UTC(a === 12 ? y + 1 : y, a === 12 ? 0 : a, 1) - 1);
    donem = { bas: bas.toISOString(), bit: bit.toISOString() };
  }

  const page = parsePage(url);
  const liste = await dosyaListesi({
    tur: (turHam as DosyaTuru | null) ?? null,
    kart: url.searchParams.get("kart"),
    plaka: url.searchParams.get("plaka"),
    yukleyenWorkerId: url.searchParams.get("yukleyen"),
    donem,
    limit: page.limit,
    offset: page.offset,
  });

  if (liste.tabloYok) {
    return mobileError(503, "db_error", { sebep: "tablo_yok", migration: "091" });
  }

  return Response.json({
    ok: true,
    dosyalar: liste.satirlar.map(listeGovdesi),
    page: pageInfo(page, liste.toplam),
    filtre: {
      tur: turHam,
      kart: url.searchParams.get("kart"),
      plaka: url.searchParams.get("plaka"),
      yukleyen: url.searchParams.get("yukleyen"),
      donem: donemHam,
      /** Dönemi bilinmediği için bu süzgece giremeyen dosya sayısı. */
      donemsizGizlendi: liste.donemsizGizlendi,
    },
    /**
     * Liste satırında faaliyet/olay sayısı YOK — sebebi `dosyaListesi`
     * başlığında (PostgREST 1000 satır tavanı). Gerçek sayı künye ucunda.
     */
    sayimlarIcin: "GET /api/mobile/takograf/{id}",
  });
}
