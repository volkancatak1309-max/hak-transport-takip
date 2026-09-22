import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import {
  manuelSil,
  hazirlikDurumu,
  tabloKategorisi,
  HAM_TABLOLAR,
  type HamTablo,
} from "@/lib/saklama-db";
import {
  araligiCoz,
  aralikDenetle,
  silinebilirMi,
  ARALIK_MAX_GUN,
  type AralikTuru,
} from "@/lib/saklama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/saklama/on-izleme — KURU MOD. HİÇBİR ŞEY SİLMEZ.
 *
 * `app/actions/saklama.ts` `silmeOnIzleme`nin mobil ikizi ve AYNI çekirdeği
 * çağırıyor: `manuelSil({ kuru: true })` + `hazirlikDurumu`.
 *
 * ═══ 🔴 GÖREVDEKİ `{kategori}` ŞEKLİ ÜRÜNDE YOK — ÖLÇÜLDÜ ═══
 * Ön izleme KATEGORİ ekseninde değil, **TABLO + ARALIK** ekseninde çalışıyor
 * (`manuelSil({tablo, aralik})`). Sebebi 090'ın kendi tasarımı: silme bir
 * zaman aralığına uygulanır ("Ağustos'un ham konumunu sil"), bir sınıfa değil.
 * `{kategori}` alsaydık aralığı BİZ seçmiş olurduk — kullanıcının göreceği
 * sayı, onaylamadığı bir pencereden çıkardı.
 *
 * Silinebilir tablo kümesi YALNIZ iki ham tablo:
 * `HAM_TABLOLAR = ["device_telemetry", "driver_locations"]`.
 *
 * ═══ NEDEN POST — OKUMA OLMASINA RAĞMEN ═══
 * Gövdeli ve pahalı bir sorgu (aralık taraması); GET query string'ine
 * sığdırmak tarih/aralık üçlüsünü üç ayrı parametreye bölmek olurdu. Panel de
 * bunu bir action çağrısıyla yapıyor. **Yazma yok** — yanıt `yazmaYapildi:false`
 * ile bunu açıkça söylüyor.
 *
 * ═══ SİLME UCU YOK ═══
 * `araligiSil` mobile AÇILMIYOR (gerekçe kardeş `../route.ts` başlığında).
 * Bu uç çift onayın YALNIZ BİRİNCİ ayağıdır ve ikincisi mobilde hiç yok.
 *
 * ⚠️ `kapi` alanı çekirdeğin verdiği karardır (`silmeKapisi`): `izin:false`
 * ise sebebi `engel` alanında. Kategorisi `yasal_zorunlu` olan tablo buraya
 * gelirse **400** ile reddedilir — panel o seçeneği hiç çizmiyor, uç da
 * "denendi ve reddedildi" demeden önce hiç başlatmıyor.
 *
 * HATA KODLARI:
 *   401 · 403 admin_required
 *   400 gecersiz_govde · invalid (alan: tablo | tur) · aralik_gecersiz ·
 *       aralik_* (çekirdeğin kendi kodları) · kategori_silinemez
 *   503 db_error
 */

const TURLER: AralikTuru[] = ["hafta", "ay", "ozel"];

export async function POST(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "gecersiz_govde", { beklenen: "application/json" });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return mobileError(400, "gecersiz_govde", { sebep: "nesne_degil" });
  }
  const g = body as Record<string, unknown>;

  const tablo = String(g.tablo ?? "");
  if (!(HAM_TABLOLAR as readonly string[]).includes(tablo)) {
    return mobileError(400, "invalid", {
      alan: "tablo",
      gecerli: HAM_TABLOLAR,
      ...(("kategori" in g)
        ? {
            sebep: "kategori_ekseni_yok",
            aciklama:
              "Ön izleme TABLO + ARALIK ekseninde çalışır; kategori ekseni 090'da yok.",
          }
        : {}),
    });
  }

  const tur = String(g.tur ?? "");
  if (!(TURLER as readonly string[]).includes(tur)) {
    return mobileError(400, "invalid", { alan: "tur", gecerli: TURLER });
  }

  /**
   * FAIL-CLOSED: sınıflandırılmamış tablo 'yasal_zorunlu' sayılır
   * (`tabloKategorisi`). Silinemeyen bir sınıf için kuru mod bile
   * çalıştırılmaz — kullanıcıya hiç var olmayan bir yol gösterilmesin.
   */
  const kategori = await tabloKategorisi(tablo);
  if (!silinebilirMi(kategori)) {
    return mobileError(400, "kategori_silinemez", { tablo, kategori });
  }

  const a = araligiCoz(tur as AralikTuru, {
    referans: g.referans === undefined ? undefined : String(g.referans),
    bas: g.bas === undefined ? undefined : String(g.bas),
    bit: g.bit === undefined ? undefined : String(g.bit),
  });
  if (!a) {
    return mobileError(400, "aralik_gecersiz", {
      alan: tur === "ozel" ? "bas|bit" : "referans",
      bicim: "YYYY-MM-DD",
    });
  }
  const aralikHatasi = aralikDenetle(a);
  if (aralikHatasi) {
    return mobileError(400, aralikHatasi, {
      aralikBas: a.bas.toISOString(),
      aralikBit: a.bit.toISOString(),
      maxGun: ARALIK_MAX_GUN,
    });
  }

  /** ⚠️ `kuru: true` — sebep ve onay metni BOŞ geçilir, çekirdek yazmaz. */
  const r = await manuelSil({
    tablo: tablo as HamTablo,
    aralik: a,
    sebep: "",
    onayMetni: "",
    workerId: guard.actor.worker.id,
    kuru: true,
  });
  const h = await hazirlikDurumu(a);

  return Response.json({
    ok: r.ok,
    hata: r.hata ?? null,
    /** 🔴 Hiçbir satır yazılmadı/silinmedi — istemci bunu gövdeden görsün. */
    yazmaYapildi: false,
    tablo,
    kategori,
    aralik: { bas: a.bas.toISOString(), bit: a.bit.toISOString(), tur },
    /** Bu aralıkta kaç satır ETKİLENİRDİ. */
    satir: r.satir,
    /** Çekirdeğin kapı kararı: `izin` · `engel` · `ayrinti`. */
    kapi: r.kapi,
    /** Silmeden ÖNCE yapılması gerekenler — panelin "hazırlık" bölümü. */
    hazirlik: { omurIzi: h.omurIzi, eksikAylar: h.eksikAylar, kmDonmamis: h.kmDonmamis },
  });
}
