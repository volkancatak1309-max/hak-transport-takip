import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileAdmin, requireMobileFleetView } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { auditChange } from "@/lib/audit-change";
import { parsePage, pageInfo } from "@/lib/mobile-list";
import { supabaseAdmin } from "@/lib/supabase";
import {
  mevzuatAyari,
  mevzuatAyariYaz,
  mevzuatBelgeleri,
  mevzuatPanosu,
  uyariListesi,
} from "@/lib/mevzuat-db";
import {
  KURAL_SETLERI,
  kademeDenetle,
  setinTemeli,
  VARDIYA_BAYAT_MS,
  VARSAYILAN_KADEME,
  type KademeAyari,
  type KuralSeti,
} from "@/lib/mevzuat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 🔴 SÜRE TAVANI AÇIKÇA YAZILI. Kural seti `EU_561` + `surus_tahmini` açıkken
 * pano AÇIK VARDİYA BAŞINA bir telemetri turu atıyor (`surusTahminiOlc`).
 * Bugün üç kiracıda da set `AT_AZG` ve o tur hiç koşmuyor; ama bir kiracı
 * EU_561'e geçtiği gün 16 açık vardiya 16 rota okuması demek. Platform
 * varsayılanına güvenmek, o gün sessizce kesilen bir isteğe dönüşür ve
 * istemci sebebini bilmez — `co2.pdf` turunda öğrenilen ders.
 */
export const maxDuration = 300;

/**
 * GET   /api/mobile/mevzuat — mevzuat panosu
 * PATCH /api/mobile/mevzuat — kiracı mevzuat ayarı
 *
 * `/admin/mevzuat` ekranının (migration 086) mobil karşılığı.
 *
 * ═══ İKİ KAPI, PANELİN İKİ KAPISININ AYNISI ═══
 *   OKUMA → `requireMobileFleetView`  ↔ panel `requireFleetView`
 *           (patron + filo şefi; şef sevkiyatı planlayan kişi)
 *   AYAR  → `requireMobileAdmin`      ↔ panel `requireAdmin`
 *           kural setini değiştirmek filonun tabi olduğu HUKUKU değiştirir,
 *           şefe kapalı (`app/actions/mevzuat.ts` başlığı).
 *
 * ═══ 🔴 GÖREVİN ÜÇ VARSAYIMI ÜRÜNDE YOK — ÖLÇÜLDÜ ═══
 *
 * 1) **UYARI KAPATMA YOK** → `POST /uyari/[id]/kapat` UCU AÇILMADI.
 *    `mevzuat_uyarilari` bir DEFTERDİR ve bilerek DEĞİŞMEZDİR. Kural ürünün
 *    kendi muhafızında yazılı (`scripts/check-crud-ekranlari.mjs`, MUAF
 *    listesi): "gönderilmiş bir bildirimin silinmesi, gönderilmemiş gibi
 *    görünmesine yol açar ve tekil indeksin spam korumasını da bozar".
 *    Panelde de kapatma/silme düğmesi YOK — şemada `kapandi_at`, `kapatan`
 *    gibi bir kolon da yok (086). Görev "panelde kapatma varsa aynı çekirdek;
 *    yoksa uç yok" diyordu: YOK.
 *
 * 2) **`?durum=acik|kapali` SÜZGECİ YOK** → 400 `kapanis_ekseni_yok`.
 *    (1)'in doğrudan sonucu: kapanış diye bir durum olmayınca süzülecek bir
 *    eksen de yok. Sessizce yutup tüm listeyi döndürmek, istemciye "süzdüm"
 *    dedirtirdi — `{kategori, gun}` kararının aynısı (090 turu).
 *
 * 3) **"EKSİK BELGE" TESPİTİ YOK** → `belgeler` bloğu SÜRE eksenlidir.
 *    078'de bir belge türünün zorunlu olduğunu söyleyen alan yok; sistem
 *    yalnız GİRİLMİŞ belgelerin tarihini bilir. Gövde `eksikBelgeTespiti:
 *    false` ile bunu açıkça söylüyor ve `turSayisi` ile "0 satır"ın sebebini
 *    ayırt edilebilir kılıyor. Gerekçenin tamamı `mevzuatBelgeleri` başlığında.
 *
 * ═══ ÜLKE EKSENİ `kural_seti`TİR, AYRI BİR KOLON DEĞİL ═══
 * `tenant_mevzuat`ta `ulke_kodu` YOK (onu taşıyan `tenant_saklama` başka bir
 * ayardır, başka bir amaçla). Ülke bilgisi kural setinin KENDİSİNDE:
 * `AT_AZG` · `DE_ARBZG` · `EU_561`. Uydurma bir `ulke` alanı, iki ayarın
 * birbirine karışmasıyla biterdi.
 *
 * ═══ AZG mi LENKZEIT mi — `kurallar` DİZİSİ SÖYLÜYOR ═══
 * Her kuralın `temel` alanı var: `calisma_suresi` ÖLÇÜLÜR (AZG/ArbZG),
 * `surus_tahmini` TAHMİN EDİLİR (Lenkzeit, AB 561/2006). İkisi aynı sayı
 * değil ve gövdede asla tek bir "süre" alanında birleşmez.
 *
 * HATA KODLARI:
 *   401 missing_token / invalid_token / revoked / inactive
 *   403 fleet_view_required (şoför, GET) · admin_required (şef+şoför, PATCH)
 *   403 kapsam_disi (şefin filosu dışındaki `?sofor=`)
 *   400 invalid (alan: durum | sofor | gun | kuralSeti | surusTahmini | kademe)
 *       · gecersiz_govde · bos_govde
 *   503 db_error (migration 086 yok)
 */

/** Defter penceresi (gün). Panel 7 gün gösteriyor; tavan taramayı sınırlar. */
const UYARI_PENCERE_VARSAYILAN = 7;
const UYARI_PENCERE_MAX = 90;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KURAL_SETI_ADLARI = Object.keys(KURAL_SETLERI) as KuralSeti[];

const IZINLI_ALANLAR = new Set(["kuralSeti", "surusTahmini", "kademe"]);
const IZINLI_KADEME = new Set(["erken", "yaklasti", "son"]);

/** Kural tanımı → gövde. Eşikler KODDAN gelir, uçta hiçbir sayı yazılı değil. */
function kuralGovde(set: KuralSeti) {
  return KURAL_SETLERI[set].map((k) => ({
    ad: k.ad,
    temel: k.temel,
    tur: k.tur,
    esikDk: Math.round(k.esikMs / 60_000),
    geceEsikDk: k.geceEsikMs === undefined ? null : Math.round(k.geceEsikMs / 60_000),
    gerekenMolaDk: k.molaDk ?? null,
    dayanak: k.dayanak,
  }));
}

export async function GET(req: NextRequest) {
  const guard = await requireMobileFleetView(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);

  /**
   * ⚠️ TANINMAYAN SÜZGEÇ SESSİZCE YUTULMAZ. `?durum=acik` gönderen istemci
   * süzülmüş bir liste aldığını sanırdı; üründe kapanış yok (başlık §2).
   */
  if (url.searchParams.has("durum")) {
    return mobileError(400, "invalid", {
      alan: "durum",
      sebep: "kapanis_ekseni_yok",
      aciklama:
        "mevzuat_uyarilari bir defterdir ve bilerek değişmezdir: kapanış/silme ne panelde " +
        "ne şemada var (086'da kapanış kolonu yok). Açık/kapalı diye bir durum olmadığı " +
        "için süzülecek eksen de yok.",
      uyariKapatmaUcu: null,
    });
  }

  const soforHam = url.searchParams.get("sofor");
  if (soforHam !== null && !UUID.test(soforHam)) {
    return mobileError(400, "invalid", { alan: "sofor", bicim: "uuid", gelen: soforHam });
  }
  const soforId = soforHam;

  /**
   * KAPSAM ÖNCE. Şef, filosu dışındaki bir şoförün kimliğini tahmin edip
   * süzgece yazarak defterini okuyamaz — `haftalik/[id]/kapat`taki kararın
   * aynısı: 404 değil 403, çünkü kayıt VAR, yetki yok.
   */
  if (
    soforId &&
    guard.actor.fleetScope.restricted &&
    !guard.actor.fleetScope.isFleetWorker(soforId)
  ) {
    return mobileError(403, "kapsam_disi", { fleet: guard.actor.fleet });
  }

  const gunHam = url.searchParams.get("gun");
  let gunSayisi = UYARI_PENCERE_VARSAYILAN;
  if (gunHam !== null) {
    const n = Number(gunHam);
    if (!Number.isInteger(n) || n < 1 || n > UYARI_PENCERE_MAX) {
      return mobileError(400, "invalid", {
        alan: "gun",
        min: 1,
        max: UYARI_PENCERE_MAX,
        gelen: gunHam,
      });
    }
    gunSayisi = n;
  }

  const sayfa = parsePage(url);

  const ayarOn = await mevzuatAyari();
  if (ayarOn.tabloYok) {
    return mobileError(503, "db_error", { sebep: "tablo_yok", migration: "086" });
  }

  const [pano, defter, belgeler] = await Promise.all([
    mevzuatPanosu(new Date(), guard.actor.fleetScope),
    uyariListesi({
      gunSayisi,
      soforId,
      limit: sayfa.limit,
      offset: sayfa.offset,
      fleetScope: guard.actor.fleetScope,
    }),
    mevzuatBelgeleri(guard.actor.fleetScope),
  ]);

  /**
   * `?sofor=` CANLI SATIRLARA DA UYGULANIR. Tek bir süzgeç parametresinin
   * gövdenin bir yarısını süzüp diğerini süzmemesi, istemcide iki farklı
   * "şoför" anlamı doğururdu.
   */
  const canliSatirlar = soforId
    ? pano.satirlar.filter((s) => s.workerId === soforId)
    : pano.satirlar;

  /**
   * ŞOFÖR ADI SÖZLÜĞÜ — defterdeki ad panodan gelmeyebilir (uyarı gönderildiği
   * gün sahadaydı, bugün değil). Panelin `getMevzuatPanosu`su ile aynı yol ve
   * ANAHTARLI okuma (`.in("id", …)`): satır kümesi zaten kapsamdan geçti.
   */
  const adlar: Record<string, string> = {};
  for (const s of canliSatirlar) adlar[s.workerId] = s.ad;
  const eksik = [...new Set(defter.satirlar.map((u) => u.workerId))].filter((id) => !adlar[id]);
  if (eksik.length > 0) {
    const { data } = await supabaseAdmin.from("workers").select("id, name").in("id", eksik);
    for (const w of (data ?? []) as { id: string; name: string }[]) adlar[w.id] = w.name;
  }
  for (const b of belgeler.satirlar) adlar[b.workerId] = b.workerName;

  return Response.json({
    ok: true,

    ayar: {
      kuralSeti: pano.ayar.kuralSeti,
      /** Setin ekseni: `calisma_suresi` ÖLÇÜLÜR · `surus_tahmini` TAHMİN. */
      temel: setinTemeli(pano.ayar.kuralSeti),
      surusTahmini: pano.ayar.surusTahmini,
      kademe: pano.ayar.kademe,
      /** Açık kurallar + eşikleri + hukuki dayanakları (kod tek kaynak). */
      kurallar: kuralGovde(pano.ayar.kuralSeti),
      /** Seçilebilir setler — istemci listeyi GÖMMESİN. */
      kuralSetleri: KURAL_SETI_ADLARI,
      /** Set sürüş eksenli ama tahmin KAPALI → o kurallar hiç değerlendirilmiyor. */
      surusEkseniKapali: pano.surusEkseniKapali,
    },

    canli: {
      satirlar: canliSatirlar,
      vardiyasiz: pano.vardiyasiz,
      /** 24 sa+ açık kayıt: uyarı GİTMEZ, yapılacak iş vardiyayı kapatmaktır. */
      bayatVardiya: pano.bayatVardiya,
      olculduAn: pano.olculduAn,
    },

    uyarilar: {
      satirlar: defter.satirlar,
      page: pageInfo(sayfa, defter.toplam),
      pencereGun: gunSayisi,
      tabloYok: defter.tabloYok,
    },

    /** SÜRE eksenli — "eksik belge" tespiti üründe yok (başlık §3). */
    belgeler: {
      satirlar: belgeler.satirlar,
      dolmus: belgeler.dolmus,
      yaklasan: belgeler.yaklasan,
      turSayisi: belgeler.turSayisi,
      tabloYok: belgeler.tabloYok,
    },

    adlar,

    /**
     * KAPSAM GÖVDEDE GÖRÜNÜR. Şef panelde bugün TÜM açık vardiyaları görüyor
     * (`/admin/mevzuat` satırları filoya daraltmıyor), mobil uç ise daraltıyor.
     * Fark gizlenmiyor: istemci hangi kümeye baktığını okuyabilir.
     */
    kapsam: {
      filo: guard.actor.fleet,
      sef: guard.actor.isChief,
      daraltildi: guard.actor.fleetScope.restricted,
    },

    /** İstemci olmayan düğmeyi hiç çizmesin. */
    yetenekler: {
      ayarYazma: Boolean(guard.actor.worker.is_admin),
      uyariKapatma: false,
      uyariSilme: false,
      uyariKapatmaSebep: "defter_degismez",
      eksikBelgeTespiti: false,
    },

    sinirlar: {
      uyariPencereGunVarsayilan: UYARI_PENCERE_VARSAYILAN,
      uyariPencereGunMax: UYARI_PENCERE_MAX,
      varsayilanKademe: VARSAYILAN_KADEME,
      vardiyaBayatSaat: VARDIYA_BAYAT_MS / 3_600_000,
    },
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
     * TANINMAYAN ALAN SESSİZCE YUTULMAZ — `ulke` gönderen bir istemci
     * kaydettiğini sanıp hiçbir şey değiştirmemiş olurdu (başlık §ülke).
     */
    return mobileError(400, "invalid", {
      alanlar: izinsiz,
      izinli: [...IZINLI_ALANLAR],
      ...(izinsiz.includes("ulke") || izinsiz.includes("ulkeKodu")
        ? {
            sebep: "ulke_kolonu_yok",
            aciklama:
              "tenant_mevzuat'ta ülke kolonu yok; ülke ekseni kural setinin kendisidir " +
              "(AT_AZG · DE_ARBZG · EU_561). `kuralSeti` gönderin.",
          }
        : {}),
    });
  }
  if (Object.keys(yama).length === 0) {
    return mobileError(400, "bos_govde", { izinli: [...IZINLI_ALANLAR] });
  }

  const once = await mevzuatAyari();
  if (once.tabloYok) {
    return mobileError(503, "db_error", { sebep: "tablo_yok", migration: "086" });
  }

  // ── kuralSeti ────────────────────────────────────────────────────────────
  let kuralSeti = once.kuralSeti;
  if ("kuralSeti" in yama) {
    const v = String(yama.kuralSeti ?? "");
    /**
     * Geçerli küme KOD'dan okunuyor (`KURAL_SETLERI` anahtarları) — şemadaki
     * CHECK ile aynı üçlü. Uçta elle yazılmış bir liste, dördüncü set
     * eklendiğinde onu sessizce reddederdi.
     */
    if (!KURAL_SETI_ADLARI.includes(v as KuralSeti)) {
      return mobileError(400, "invalid", {
        alan: "kuralSeti",
        gecerli: KURAL_SETI_ADLARI,
        gelen: yama.kuralSeti,
      });
    }
    kuralSeti = v as KuralSeti;
  }

  // ── surusTahmini ─────────────────────────────────────────────────────────
  let surusTahmini = once.surusTahmini;
  if ("surusTahmini" in yama) {
    if (typeof yama.surusTahmini !== "boolean") {
      return mobileError(400, "invalid", {
        alan: "surusTahmini",
        bicim: "boolean",
        gelen: yama.surusTahmini,
      });
    }
    surusTahmini = yama.surusTahmini;
  }

  // ── kademe (kısmi yama: verilmeyen alan mevcudunu korur) ─────────────────
  const kademe: KademeAyari = { ...once.kademe };
  if ("kademe" in yama) {
    const k = yama.kademe;
    if (typeof k !== "object" || k === null || Array.isArray(k)) {
      return mobileError(400, "invalid", {
        alan: "kademe",
        bicim: "nesne",
        izinli: [...IZINLI_KADEME],
      });
    }
    const alt = k as Record<string, unknown>;
    const altIzinsiz = Object.keys(alt).filter((x) => !IZINLI_KADEME.has(x));
    if (altIzinsiz.length > 0) {
      return mobileError(400, "invalid", {
        alan: "kademe",
        alanlar: altIzinsiz,
        izinli: [...IZINLI_KADEME],
      });
    }
    for (const ad of IZINLI_KADEME) {
      if (!(ad in alt)) continue;
      const n = Number(alt[ad]);
      /**
       * TÜR kapısı, iş kuralı DEĞİL: kolon `integer`. Ondalık bir değer
       * PostgREST'te 22P02 ile düşerdi ve istemci sebebi anlaşılmayan bir
       * 503 görürdü.
       */
      if (!Number.isInteger(n)) {
        return mobileError(400, "invalid", {
          alan: `kademe.${ad}`,
          bicim: "tamsayi",
          gelen: alt[ad],
        });
      }
      kademe[ad as keyof KademeAyari] = n;
    }
  }

  /**
   * SIRA KURALI ÇEKİRDEKTEN. `kademeDenetle` yazma yolunun da
   * (`mevzuatAyariYaz`) çağırdığı fonksiyon; uçta ikinci bir `>`
   * karşılaştırması yok. Amaç yalnız 503 yerine 400 döndürebilmek — kararın
   * kendisi tek kaynakta kalıyor.
   */
  const sira = kademeDenetle(kademe);
  if (sira) {
    return mobileError(400, "invalid", {
      alan: "kademe",
      sebep: sira,
      kural: "erken > yaklasti > son > 0",
      gelen: kademe,
    });
  }

  const r = await mevzuatAyariYaz({ kuralSeti, surusTahmini, kademe }, guard.actor.worker.id);
  if (!r.ok) {
    if (r.hata === "kademe_sirasi") {
      return mobileError(400, "invalid", {
        alan: "kademe",
        sebep: r.hata,
        kural: "erken > yaklasti > son > 0",
      });
    }
    return mobileError(503, "db_error", {
      sebep: r.hata ?? "hata",
      ...(r.hata === "tablo_yok" ? { migration: "086" } : {}),
    });
  }

  const sonra = await mevzuatAyari();

  /**
   * İZ: eski→yeni ALAN FARKIYLA (`auditChange`). Panelin düz `audit` satırı
   * yalnız yeni değeri yazıyordu; fark, "kim neyi neye çevirdi" sorusunun
   * denetimde sorulan hâli. Kaynak hedef dizesinde: mobil mi panel mi.
   */
  await auditChange(
    guard.actor.worker.id,
    "update",
    "tenant_mevzuat (kaynak=mobil)",
    "singleton",
    {
      kural_seti: once.kuralSeti,
      surus_tahmini: once.surusTahmini,
      kademe_erken_dk: once.kademe.erken,
      kademe_yaklasti_dk: once.kademe.yaklasti,
      kademe_son_dk: once.kademe.son,
    },
    {
      kural_seti: sonra.kuralSeti,
      surus_tahmini: sonra.surusTahmini,
      kademe_erken_dk: sonra.kademe.erken,
      kademe_yaklasti_dk: sonra.kademe.yaklasti,
      kademe_son_dk: sonra.kademe.son,
    }
  );

  let panelTazelendi = true;
  try {
    revalidatePath("/admin/mevzuat");
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    once: { kuralSeti: once.kuralSeti, surusTahmini: once.surusTahmini, kademe: once.kademe },
    sonra: { kuralSeti: sonra.kuralSeti, surusTahmini: sonra.surusTahmini, kademe: sonra.kademe },
    /** Yeni setin kuralları — istemci kaydettikten sonra ikinci istek atmasın. */
    kurallar: kuralGovde(sonra.kuralSeti),
    /**
     * UYARI, RET DEĞİL: `surusTahmini` yalnız EU_561'de anlamlı. Panel de
     * reddetmiyor (şemada böyle bir kısıt yok); uç bunu SÖYLER, engellemez.
     */
    surusTahminiEtkisiz: sonra.surusTahmini && setinTemeli(sonra.kuralSeti) !== "surus_tahmini",
    surusEkseniKapali: setinTemeli(sonra.kuralSeti) === "surus_tahmini" && !sonra.surusTahmini,
    panelTazelendi,
  });
}
