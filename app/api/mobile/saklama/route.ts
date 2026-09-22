import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { audit } from "@/lib/security-log";
import {
  saklamaAyari,
  saklamaAyariYaz,
  kategoriler,
  yasalEsik,
  uyarilar,
  silmeIzi,
  HAM_TABLOLAR,
} from "@/lib/saklama-db";
import {
  ayarDenetle,
  esikGosterilebilir,
  silinebilirMi,
  uyariAciliyeti,
  uyariVarMi,
  ARALIK_MAX_GUN,
  SEBEP_MIN_UZUNLUK,
  SIL_ONAY_METNI,
  UYARI_GUN_MAX,
  UYARI_GUN_MIN,
  type VeriKategorisi,
} from "@/lib/saklama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET   /api/mobile/saklama — saklama panosu
 * PATCH /api/mobile/saklama — kiracı ayarı (uyarı eşiği + ülke)
 *
 * `/admin/saklama` ekranının (migration 090) mobil karşılığı.
 *
 * ═══ KAPI: YALNIZ YÖNETİCİ ═══
 * Panelin kuralının aynısı (`app/actions/saklama.ts`: "Uyarı eşiğini
 * değiştirmek ve veri silmek, ürünün dışarıya verdiği hukuki beyanı ve
 * müşterinin verisini etkiler. Filo şefine açık DEĞİL").
 *
 * ═══ 🔴 SİLME UCU YOK — VE OLMAYACAK ═══
 * `araligiSil` mobile AÇILMIYOR. Sebep ürünün kendi kuralı: silme bir İNSAN
 * eylemidir ve çift onaylıdır (kuru mod → sayıyı gör → kutuya elle "SIL" yaz
 * → sebep yaz). Telefonda o akışın ikinci ayağı bir kaza riskidir ve geri
 * alınamaz. Mobil YALNIZ okur ve ÖN İZLEME yapar (`./saklama/on-izleme`).
 *
 * ═══ 🔴 GÖREVDEKİ `{kategori, gun}` ŞEKLİ ÜRÜNDE YOK — ÖLÇÜLDÜ ═══
 * Görev "PATCH {kategori, gun}" ve "15 veri kategorisi: ad, SAKLAMA SÜRESİ"
 * istiyordu. 090'da **kategori başına saklama süresi diye bir alan yok**:
 *
 *   · `veri_kategorileri` (15 satır) bir SINIFLANDIRMA katalogudur —
 *     `{tablo_adi, kolon_adi, kategori, gerekce}`. Gün alanı taşımaz
 *     (`lib/saklama.ts` `KategoriSatiri`).
 *   · Kiracının TEK eşiği var: `tenant_saklama.uyari_gun` (+ `ulke_kodu`).
 *     Ayarı doğrulayan tek fonksiyon `ayarDenetle` ve yalnız iki şey bakar:
 *     **1 ≤ gün ≤ 3650** ve ülke kodu iki BÜYÜK harf.
 *   · "Mevzuat tabanı altına inilemez" diye bir kapı da YOK: `yasalEsik`
 *     BİLGİDİR, kapı değil (`esikGosterilebilir` — sayı varsa dayanağı da
 *     olmak zorunda, yoksa hiç gösterilmez). Olmayan bir reddi uydurmak,
 *     panelde kabul edilen bir değeri telefonda reddetmek olurdu.
 *
 * Bu yüzden PATCH gerçek alanları alıyor: `uyariGun` · `ulkeKodu` · `gerekce`.
 * Yasal çıpa yanıtta TAŞINIYOR (`yasalEsik`), böylece istemci "eşiğiniz yasal
 * çıpanın altında" UYARISINI gösterebilir — ama kaydı reddetmez.
 *
 * ═══ UYARI SATIRLARI 15 DEĞİL 2 TABLODAN ÇIKAR ═══
 * `HAM_TABLOLAR = ["device_telemetry", "driver_locations"]` — uyarı ve silme
 * yalnız bu iki ham tabloya uygulanır, ve yalnız kategorisi `kisisel` olana
 * (`uyariCikarMi`). 15 satırlık katalog yine gövdede: sınıflandırmanın
 * kendisi hukuki beyanın parçası.
 *
 * HATA KODLARI:
 *   401 missing_token / invalid_token / revoked / inactive
 *   403 admin_required
 *   400 gecersiz_govde · bos_govde · invalid (alan: uyariGun | ulkeKodu)
 *   503 db_error (migration 090 yok)
 */

const IZINLI_ALANLAR = new Set(["uyariGun", "ulkeKodu", "gerekce"]);

export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const ayar = await saklamaAyari();
  if (ayar.tabloYok) {
    return mobileError(503, "db_error", { sebep: "tablo_yok", migration: "090" });
  }

  const [{ uyarilar: liste, hata: uyariHatasi }, kats, esik, izi] = await Promise.all([
    uyarilar(),
    kategoriler(),
    yasalEsik(ayar.ulkeKodu, "ham_konum"),
    silmeIzi(20),
  ]);

  /**
   * Panelin süzgecinin AYNISI: 'yasal_zorunlu' liste dışı ve sınıflandırılmamış
   * tablo FAIL-CLOSED 'yasal_zorunlu' sayılır. Seçenek hiç üretilmezse
   * yanlışlıkla render edilemez.
   */
  const katMap = new Map(
    kats.filter((k) => k.kolonAdi === null).map((k) => [k.tabloAdi, k.kategori])
  );
  const silinebilirTablolar = HAM_TABLOLAR.map((t) => ({
    tablo: t,
    kategori: katMap.get(t) ?? ("yasal_zorunlu" as VeriKategorisi),
  })).filter((x) => silinebilirMi(x.kategori));

  await audit(guard.actor.worker.id, "page_view", "saklama kaynak=mobil");

  return Response.json({
    ok: true,
    ayar: {
      uyariGun: ayar.uyariGun,
      ulkeKodu: ayar.ulkeKodu,
      gerekce: ayar.gerekce,
      guncellendiAt: ayar.guncellendiAt,
    },
    /** Yasal çıpa BİLGİDİR, kapı değil. Dayanağı eksikse `gosterilebilir:false`. */
    yasalEsik: esik
      ? { ...esik, gosterilebilir: esikGosterilebilir(esik) }
      : { gosterilebilir: false, esikGun: null, yasalDayanak: null, kaynakUrl: null },
    /** 15 satırlık sınıflandırma katalogu — gün alanı YOK (başlık §). */
    kategoriler: kats,
    /**
     * Uyarılar: tablo başına satır sayısı + EN ESKİ kayıt + yaş.
     * ⚠️ `satirSayisi: null` "0" DEĞİL, "ölçülemedi" demektir; çekirdek
     * sayım düşerse tabloyu atlamıyor (lib/saklama-db.ts `uyarilar`).
     */
    uyarilar: liste.map((u) => ({ ...u, aciliyet: uyariAciliyeti(u), uyariVar: uyariVarMi(u) })),
    uyariHatasi: uyariHatasi ?? null,
    silinebilirTablolar,
    /** Son silme izi — hukuki kayıt (`saklama_silme_izi`). */
    izi,
    /** İstemci sayıları GÖMMESİN. */
    sinirlar: {
      uyariGunMin: UYARI_GUN_MIN,
      uyariGunMax: UYARI_GUN_MAX,
      aralikMaxGun: ARALIK_MAX_GUN,
      sebepMinUzunluk: SEBEP_MIN_UZUNLUK,
      onayMetni: SIL_ONAY_METNI,
      hamTablolar: HAM_TABLOLAR,
    },
    /** Mobilde silme YOK — istemci düğmeyi hiç çizmesin (başlık §). */
    silmeUcu: null,
  });
}

export async function PATCH(req: NextRequest) {
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

  const yama = body as Record<string, unknown>;
  const izinsiz = Object.keys(yama).filter((k) => !IZINLI_ALANLAR.has(k));
  if (izinsiz.length > 0) {
    /**
     * TANINMAYAN ALAN SESSİZCE YUTULMAZ. `{kategori, gun}` gönderen bir
     * istemci, kaydettiğini sanıp hiçbir şey değiştirmemiş olurdu.
     */
    return mobileError(400, "invalid", {
      alanlar: izinsiz,
      izinli: [...IZINLI_ALANLAR],
      ...(izinsiz.includes("kategori") || izinsiz.includes("gun")
        ? {
            sebep: "kategori_bazli_sure_yok",
            aciklama:
              "090'da kategori başına saklama süresi yok; kiracının TEK eşiği uyariGun (1-3650) ve ulkeKodu.",
          }
        : {}),
    });
  }
  if (Object.keys(yama).length === 0) {
    return mobileError(400, "bos_govde", { izinli: [...IZINLI_ALANLAR] });
  }

  const once = await saklamaAyari();
  if (once.tabloYok) {
    return mobileError(503, "db_error", { sebep: "tablo_yok", migration: "090" });
  }

  const uyariGun = "uyariGun" in yama ? Number(yama.uyariGun) : once.uyariGun;
  const ulkeKodu = "ulkeKodu" in yama ? String(yama.ulkeKodu ?? "") : once.ulkeKodu;
  const gerekce =
    "gerekce" in yama
      ? yama.gerekce === null
        ? null
        : String(yama.gerekce).trim().slice(0, 500) || null
      : once.gerekce;

  /** Doğrulama İKİNCİ bir kural kümesi DEĞİL — panelin çağırdığı fonksiyonun ta kendisi. */
  const hata = ayarDenetle(uyariGun, ulkeKodu);
  if (hata) {
    return mobileError(
      400,
      "invalid",
      hata === "gun_araligi"
        ? { alan: "uyariGun", min: UYARI_GUN_MIN, max: UYARI_GUN_MAX, gelen: yama.uyariGun }
        : { alan: "ulkeKodu", bicim: "IKI_BUYUK_HARF", gelen: yama.ulkeKodu }
    );
  }

  const r = await saklamaAyariYaz({ uyariGun, ulkeKodu, gerekce }, guard.actor.worker.id);
  if (!r.ok) return mobileError(503, "db_error", { sebep: r.hata ?? "hata" });

  // İZ: eski→yeni. Ayar tablosu yalnız SON hâli tutuyor (panelin izinin aynısı).
  await audit(
    guard.actor.worker.id,
    "update",
    `saklama_uyari:${once.uyariGun}→${uyariGun}gun ulke:${once.ulkeKodu}→${ulkeKodu} kaynak=mobil`
  );

  let panelTazelendi = true;
  try {
    revalidatePath("/admin/saklama");
  } catch {
    panelTazelendi = false;
  }

  const sonra = await saklamaAyari();
  const esik = await yasalEsik(sonra.ulkeKodu, "ham_konum");

  return Response.json({
    ok: true,
    once: { uyariGun: once.uyariGun, ulkeKodu: once.ulkeKodu, gerekce: once.gerekce },
    sonra: {
      uyariGun: sonra.uyariGun,
      ulkeKodu: sonra.ulkeKodu,
      gerekce: sonra.gerekce,
      guncellendiAt: sonra.guncellendiAt,
    },
    /**
     * UYARI, RET DEĞİL: eşik yasal çıpanın altındaysa istemci bunu gösterebilsin.
     * Panel de reddetmiyor — ürün burada bir sınır koymuyor (başlık §).
     */
    yasalCipaAltinda:
      esikGosterilebilir(esik) && esik!.esikGun !== null ? sonra.uyariGun < esik!.esikGun : null,
    yasalEsikGun: esik?.esikGun ?? null,
    panelTazelendi,
  });
}

