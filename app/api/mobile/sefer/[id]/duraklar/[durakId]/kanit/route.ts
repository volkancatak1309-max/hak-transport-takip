import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileWorker } from "@/lib/mobile-scope";
import { mobileError, type MobileWorker } from "@/lib/mobile-auth";
import { getSeferById, ACIK_DURUMLAR } from "@/lib/sefer-db";
import {
  getDurak,
  listDuraklar,
  ilerletDurak,
  durakGovdesi,
  durakOzetGovdesi,
} from "@/lib/sefer-duraklari";
import { signedReceiptUrls } from "@/lib/storage";
import {
  TESLIMAT_KOVASI,
  TESLIMAT_SONUCLARI,
  createTeslimat,
  addTeslimatFoto,
  getTeslimat,
  getTeslimatByDurak,
  getTaslaklar,
  deleteTaslaklar,
  listTaslakByDurak,
  imzaliKanitlar,
  type TeslimatSonuc,
} from "@/lib/teslimat-db";
import { govdeOku } from "../../../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/sefer/[id]/duraklar/[durakId]/kanit — TESLİMAT KANITI BIRAK
 * GET  aynı yol                                        — kanıt + imzalı URL'ler
 *
 * ePOD'un eksik son halkası. 080 kanıt şemasını, 082 durak bağını, 03.09'daki
 * fotoğraf ucu dosya yolunu getirdi; kanıdın KENDİSİNİ açan mobil uç yoktu
 * (ölçüldü 21.09.2026: `createTeslimat`ı çağıran tek yer panelin sunucu
 * eylemiydi — `app/actions/teslimat.ts`).
 *
 * ═══ GÖVDE ═══
 *
 *   {
 *     "sonuc":   "teslim" | "teslim_edilemedi",
 *     "sebep":   "kapı kapalıydı",        // teslim_edilemedi'de ZORUNLU (≥3)
 *     "aliciAd": "M. Huber",              // opsiyonel (safe drop'ta yok)
 *     "not":     "arka kapıya bırakıldı", // opsiyonel
 *     "konum":   { "lat": 47.4, "lng": 9.7, "at": "2026-09-21T09:12:00Z" },
 *     "fotoIds": ["<taslak-id>", …],      // en fazla 5, önceden yüklenmiş
 *     "imzaId":  "<taslak-id>"            // opsiyonel, PNG taslağı
 *   }
 *
 * `fotoIds`/`imzaId` **taslak** kimlikleridir: şoför kapıda önce dosyayı
 * `POST …/foto` ucuna `taslak=1` ile yükler, dönen `id`leri buraya taşır.
 * Sıranın neden ters olduğu ve taslağın neden ayrı bir tabloda durduğu
 * migration 109 başlığında ÖLÇÜMLE yazılı.
 *
 * ⚠️ `konum.at` KAYDEDİLMİYOR ve bu bilerek. Teslim anını 080'in kuralı gereği
 * VERİTABANI yazıyor (`teslim_at default now()`): "İstemciden gelen bir zaman
 * damgası, telefonun saati kadar güvenilirdir" — telefon saati elle
 * değiştirilebilir ve delilin zamanı tartışmaya açık olamaz. Alan gövdede
 * KABUL EDİLİYOR (istemci sözleşmesi bozulmasın) ama sunucu son sözü söylüyor;
 * yanıttaki `kanit.teslimAt` gerçekten yazılan değerdir, istemci onu görsün.
 *
 * ⚠️ `konum` ZORUNLU DEĞİL. GPS kilidi kapalıyken ya da bodrumda teslimat
 * yapılmaya devam ediyor; konumu şart koşmak, delili sinyale bağlamak — yani
 * en çok ihtiyaç duyulan anda kaydı reddetmek olurdu. Panel de nullable
 * gönderiyor (`getGeoFix` null dönebilir).
 *
 * ═══ 🔴 KAPI: KANITI YALNIZ SEFERİN ŞOFÖRÜ BIRAKIR ═══
 *
 * POST → `requireMobileWorker` + `sefer.worker_id === worker.id`. **YÖNETİCİ
 * DE 403 ALIR** (Volkan kararı 21.09.2026). Görme ve İPTAL yöneticide kalır.
 *
 * Panelin ePOD kuralının BİREBİR aynısı (`app/actions/teslimat.ts`):
 * *"teslimatı yapan kişi kanıtı da bırakan kişidir, aksi hâlde delilin kaynağı
 * bulanıklaşır."* Sefer ağacındaki dört yazma yüzeyinin dördü de aynı cümleyi
 * kuruyor — `…/durum`, `/sefer/[id]/durum`, `app/actions/duraklar.ts` ve panel
 * kanıt eylemi. Bu uç o sıranın beşincisi.
 *
 * ⚠️ YÖNETİCİ MUAFİYETİ AÇILSAYDI KENDİ KENDİNİ KİLİTLERDİ — ÖLÇÜLDÜ: kanıt
 * `teslimatlar.worker_id`ye YÖNETİCİNİN kimliğiyle yazılır; foto ucunun
 * `kanit.workerId !== worker.id → 403 kanit_senin_degil` kapısı yüzünden
 * SEFERİN ŞOFÖRÜ kendi teslimatının fotoğrafını o kanıta EKLEYEMEZ, ve
 * `teslimat_durak_id_uq` (082) yüzünden ikinci kanıt da açamaz. Tek çıkış yolu
 * yöneticinin kanıtı iptal etmesi olurdu.
 *
 * ⚠️ AMA KAPIYI DARALTMAK TEK BAŞINA YETMİYORDU — ARKA KAPI VARDI (ölçüldü,
 * 21.09.2026): `PATCH /api/mobile/sefer/[id]` gövdesindeki `soforId` seferin
 * şoförünü SONRADAN değiştirebiliyor ve kanıt hiç sorulmuyordu. Yönetici seferi
 * kendine devredip kanıt yazıp geri devredebilir, ya da kanıt bırakılmış bir
 * seferi başkasına devredip o şoföru kilitleyebilirdi. O uç artık geçerli kanıt
 * varken şoför değişimini 409 `kanit_var` ile reddediyor
 * (`seferdeGecerliKanitVarMi`). İki kapı birlikte, kanıdın sahibi ile seferin
 * şoförünü ayrılmaz kılıyor.
 *
 * GET → yönetici muaf (`GET …/duraklar` ucunun aynı cümlesi). Okuma yetkisi
 * yazma yetkisi değildir: yönetici delili GÖRÜR, üretmez.
 *
 * ⚠️ KAPANMIŞ SEFERE KANIT YOK (409 `sefer_kapali`) — panelin cümlesinin
 * aynısı: olayın kendisinden sonra delil üretilmez.
 *
 * ═══ DURAK DURUMU PANEL KURALIYLA İLERLER ═══
 *
 *   teslim           → `tamamlandi`
 *   teslim_edilemedi → `atlandi` (SEBEBİYLE — 082'nin `atlama_sebep`i)
 *
 * Geçiş çekirdekten (`ilerletDurak`) geçer, burada YENİDEN YAZILMAZ: izinli
 * geçiş haritası, sebep alt sınırı ve yarış emniyeti (`.eq("durum", mevcut)`)
 * orada tek kaynak.
 *
 * ⚠️ GEÇİŞ DÜŞERSE KANIT YİNE DE DURUR. Durak zaten kapalıysa (şoför önce
 * "tamam"a basıp sonra kanıt bırakıyorsa) `ilerletDurak` `kapali_durak` der;
 * bunu hata sayıp kanıdı reddetmek, ELDEKİ DELİLİ bir plan satırının durumu
 * yüzünden çöpe atmak olurdu. Yanıt `durumIlerledi:false` + `durumSebep` ile
 * ne olduğunu SÖYLER — sessiz geçmez.
 *
 * ⚠️ `kaynak` GÖNDERİLMİYOR: o kolon yalnız `varildi` geçişinde yazılıyor
 * (lib/sefer-duraklari.ts) ve bu uç hiç `varildi` göndermiyor. Göndermek,
 * okunmayan bir alanı doldurup "yazılıyor" izlenimi bırakırdı.
 *
 * ═══ AYNI DURAĞA İKİNCİ KANIT → 409 ═══
 *
 * Garantiyi UYGULAMA DEĞİL VERİTABANI veriyor: `teslimat_durak_id_uq`
 * (082) — `(durak_id) where durak_id is not null and iptal_at is null`.
 * Çakışma 23505 olarak gelir ve `durak_dolu`ya çevrilir. Önce SELECT edip
 * "var mı" diye bakmak yarış açardı: iki telefon aynı anda yazarsa ikisi de
 * "yok" görür. Kısmi indeks yarışı kaybedeni kesin olarak reddeder.
 *
 * İPTAL EDİLMİŞ kanıt yeni denemeyi ENGELLEMEZ (indeksin `iptal_at is null`
 * şartı) — yanlış kanıt sebebiyle kayıtta durur, üstüne doğrusu yazılabilir.
 *
 * ═══ HATA KODLARI ═══
 *   401 missing_token / invalid_token / revoked / inactive   (ortak kapı)
 *   403 sefer_sizin_degil    — POST'ta YÖNETİCİ DE bunu alır (yazma muafiyeti yok)
 *   404 not_found             — sefer ya da durak yok / durak bu seferin değil
 *   409 sefer_kapali · kanit_zaten_var
 *       ozellik_kapali        — migration 080/082/109 uygulanmamış
 *   400 invalid_body · invalid_field · sebep_gerekli · sebep_gereksiz
 *       foto_tavan · taslak_yok · kanit_yok
 *   503 db_error
 */

type Yol = { params: Promise<{ id: string; durakId: string }> };

/** Panelin istemci tavanıyla aynı (app/panel/seferler/TeslimatKanitiDialog.tsx). */
const FOTO_TAVAN = 5;

/**
 * Seferi ve durağı çözer, kapıyı uygular. POST ve GET AYNI gövdeyi kullansın
 * diye tek yerde — TEK FARKLA: yönetici muafiyeti.
 *
 * `yoneticiMuaf` bir parametre, çünkü iki yüzeyin kuralı GERÇEKTEN farklı ve
 * bu fark yazıyla sabit: **yazma yalnız seferin şoförü, okuma yöneticiye de
 * açık.** Tek bir bayrakta toplanması, ikisinin yanlışlıkla ayrışmasını
 * (ya da yazmanın sessizce gevşemesini) tek satırda görünür kılıyor.
 */
async function kapiVeDurak(
  seferId: string,
  durakId: string,
  worker: MobileWorker,
  secenek: { seferAcikOlmali: boolean; yoneticiMuaf: boolean }
) {
  const { seferAcikOlmali, yoneticiMuaf } = secenek;
  const sefer = await getSeferById(seferId);
  if (!sefer) return { ok: false as const, response: mobileError(404, "not_found") };

  // ⚠️ YAZMADA MUAFİYET YOK: `yoneticiMuaf` false ise `is_admin` HİÇ okunmaz.
  const yonetici = yoneticiMuaf && worker.is_admin === true;
  if (!yonetici && sefer.worker_id !== worker.id) {
    return { ok: false as const, response: mobileError(403, "sefer_sizin_degil") };
  }
  if (seferAcikOlmali && !ACIK_DURUMLAR.includes(sefer.durum)) {
    return {
      ok: false as const,
      response: mobileError(409, "sefer_kapali", { mevcutDurum: sefer.durum }),
    };
  }

  // Durak GERÇEKTEN bu seferin mi — yol uyuşmazlığı imkânsız olmalı.
  const durak = await getDurak(durakId);
  if (!durak || durak.sefer_id !== seferId) {
    return { ok: false as const, response: mobileError(404, "not_found") };
  }
  return { ok: true as const, sefer, durak };
}

export async function POST(req: NextRequest, { params }: Yol) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;
  const { worker } = guard.actor;
  const { id: seferId, durakId } = await params;

  const govde = await govdeOku(req);
  if (!govde) return mobileError(400, "invalid_body", { bicim: "json_nesne" });

  // ── SONUÇ ───────────────────────────────────────────────────────────────
  const sonucHam = typeof govde.sonuc === "string" ? govde.sonuc : "";
  if (!(TESLIMAT_SONUCLARI as readonly string[]).includes(sonucHam)) {
    return mobileError(400, "invalid_field", {
      alan: "sonuc",
      gecerli: TESLIMAT_SONUCLARI,
    });
  }
  const sonuc = sonucHam as TeslimatSonuc;

  // ── SEBEP: BAŞARISIZLIĞIN TEK KANITI ───────────────────────────────────
  // Şemadaki `teslimat_sebep_butun` ÇİFT YÖNLÜ; uç da çift yönlü denetler ki
  // kullanıcı 23514 yerine hangi alanın yanlış olduğunu okusun.
  const sebep = typeof govde.sebep === "string" ? govde.sebep.trim() : "";
  if (sonuc === "teslim_edilemedi" && sebep.length < 3) {
    return mobileError(400, "sebep_gerekli", {
      alan: "sebep",
      enAz: 3,
      aciklama: "Sebepsiz bir başarısız teslimat iz bırakmayan bir 'olmadı'dır.",
    });
  }
  if (sonuc === "teslim" && sebep.length > 0) {
    return mobileError(400, "sebep_gereksiz", {
      alan: "sebep",
      aciklama: "Başarılı teslimatın sebebi olmaz; rapor iki anlamlı satırı sayamaz.",
    });
  }

  /**
   * ── METİN TAVANLARI: 23514'Ü 503 OLARAK DÖNDÜRMEMEK İÇİN ────────────────
   *
   * ⚠️ ÖLÇÜLDÜ: `teslimatlar`da üç CHECK var (`alici_ad` 1-80 · `notlar` ≤500 ·
   * 109'un `sebep` 3-300) ve çekirdeğin hata haritası YALNIZ 23505'i tanıyor
   * (`cakismaMi`). Bir CHECK ihlali `sebep:"hata"`ya, oradan **503 db_error**'a
   * düşerdi — yani istemcinin kendi gövdesindeki bir hata, sunucu arızası gibi
   * görünürdü ve hangi alanın yanlış olduğu SÖYLENMEZDİ.
   *
   * ⚠️ KIRPMA DEĞİL RED: `ilerletDurak` sebebi 300'e kırpıyor (o bir DURUM
   * alanı). Burası DELİL: şoförün yazdığı metnin sessizce kesilmiş hâlini
   * kanıt diye saklamak, kaydı sahibinin söylemediği bir şeye çevirir.
   */
  const uzunluk: { alan: string; deger: string; enAz: number; enCok: number }[] = [
    { alan: "sebep", deger: sebep, enAz: 0, enCok: 300 },
    {
      alan: "aliciAd",
      deger: typeof govde.aliciAd === "string" ? govde.aliciAd.trim() : "",
      enAz: 0,
      enCok: 80,
    },
    {
      alan: "not",
      deger: typeof govde.not === "string" ? govde.not.trim() : "",
      enAz: 0,
      enCok: 500,
    },
  ];
  for (const u of uzunluk) {
    if (u.deger.length > u.enCok) {
      return mobileError(400, "invalid_field", {
        alan: u.alan,
        enCok: u.enCok,
        gelen: u.deger.length,
      });
    }
  }

  // ── TASLAK KİMLİKLERİ ──────────────────────────────────────────────────
  const fotoIdsHam = govde.fotoIds;
  if (fotoIdsHam !== undefined && !Array.isArray(fotoIdsHam)) {
    return mobileError(400, "invalid_field", { alan: "fotoIds", bicim: "dizi" });
  }
  const fotoIds = (Array.isArray(fotoIdsHam) ? fotoIdsHam : [])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (fotoIds.length > FOTO_TAVAN) {
    return mobileError(400, "foto_tavan", { tavan: FOTO_TAVAN, gelen: fotoIds.length });
  }
  const imzaId = typeof govde.imzaId === "string" && govde.imzaId ? govde.imzaId : null;

  // ── KONUM ──────────────────────────────────────────────────────────────
  // ⚠️ ZORUNLU DEĞİL ve bu ölçülmüş bir karar: GPS kilidi kapalıyken ya da
  // bodrumda teslimat yapılmaya devam ediyor. Konumu şart koşmak, delili
  // sinyale bağlamak — yani en çok ihtiyaç duyulan anda kaydı reddetmek olurdu.
  // Panel de nullable gönderiyor (`getGeoFix` null dönebilir).
  const konumCoz = (): { ok: true; lat: number | null; lng: number | null; acc: number | null } | { ok: false; alan: string } => {
    const k = govde.konum;
    if (k === undefined || k === null) return { ok: true, lat: null, lng: null, acc: null };
    if (typeof k !== "object" || Array.isArray(k)) return { ok: false, alan: "konum" };
    const o = k as Record<string, unknown>;
    const say = (v: unknown): number | null => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const lat = say(o.lat);
    const lng = say(o.lng);
    // Yarım koordinat koordinat değildir — `duraklar` ucundaki aynı kural.
    if ((lat === null) !== (lng === null)) return { ok: false, alan: "konum.lat|lng" };
    if (lat !== null && (lat < -90 || lat > 90)) return { ok: false, alan: "konum.lat" };
    if (lng !== null && (lng < -180 || lng > 180)) return { ok: false, alan: "konum.lng" };
    const acc = say(o.dogrulukM ?? o.accuracy);
    if (acc !== null && acc < 0) return { ok: false, alan: "konum.dogrulukM" };
    return { ok: true, lat, lng, acc };
  };
  const konum = konumCoz();
  if (!konum.ok) return mobileError(400, "invalid_field", { alan: konum.alan });

  // ── KAPI + DURAK ───────────────────────────────────────────────────────
  // 🔴 YAZMA: yönetici muafiyeti YOK — kanıtı yalnız seferin şoförü bırakır.
  const c = await kapiVeDurak(seferId, durakId, worker, {
    seferAcikOlmali: true,
    yoneticiMuaf: false,
  });
  if (!c.ok) return c.response;
  const { sefer, durak } = c;

  // ── TASLAKLARI TOPLA ───────────────────────────────────────────────────
  // Sahiplik SORGUDA süzülüyor (`getTaslaklar`): başkasının ya da başka durağın
  // taslağı HİÇ GELMEZ ve sayı tutmazsa istek reddedilir. "Sonra kontrol
  // ederim" diyen bir akış, unutulan bir `if` ile yabancı dosyayı kanıta
  // bağlardı.
  const istenen = [...fotoIds, ...(imzaId ? [imzaId] : [])];
  const t = await getTaslaklar(istenen, { durakId, workerId: worker.id });
  if (t.tabloYok) return mobileError(409, "ozellik_kapali", { migration: "109" });
  /**
   * 🔴 GEÇİCİ ARIZA "TASLAĞIN YOK" DEĞİLDİR. Sorgu düştüyse dosyalar yerinde
   * duruyor; şoföre 400 demek onu fotoğrafları yeniden çekmeye ve kotasını
   * ikinci kez harcamaya iter. 503, "tekrar dene" demenin dürüst yoludur.
   */
  if (t.dbHatasi) return mobileError(503, "db_error", { adim: "taslak_okuma" });
  if (!t.tamamMi) {
    return mobileError(400, "taslak_yok", {
      istenen: istenen.length,
      bulunan: t.taslaklar.length,
      aciklama: "Taslak bu durağa ait olmalı ve sizin yüklemeniz olmalı.",
    });
  }
  const fotoTaslaklari = t.taslaklar.filter((x) => fotoIds.includes(x.id));
  const imzaTaslak = imzaId ? (t.taslaklar.find((x) => x.id === imzaId) ?? null) : null;
  if (imzaTaslak && imzaTaslak.tur !== "imza") {
    return mobileError(400, "invalid_field", { alan: "imzaId", beklenen: "tur=imza" });
  }
  const yanlisTur = fotoTaslaklari.find((x) => x.tur !== "foto");
  if (yanlisTur) {
    return mobileError(400, "invalid_field", { alan: "fotoIds", beklenen: "tur=foto" });
  }

  // ── KANIT ──────────────────────────────────────────────────────────────
  const y = await createTeslimat(
    {
      seferId,
      workerId: worker.id,
      durakId: durak.id,
      durakNo: durak.sira,
      // Kanıt hangi sahada bırakıldıysa o: durağın bölgesi, yoksa seferin
      // eski tek hedefi (panelin aynı cümlesi).
      zoneId: durak.zone_id ?? sefer.zone_id,
      aliciAd: typeof govde.aliciAd === "string" ? govde.aliciAd : null,
      notlar: typeof govde.not === "string" ? govde.not : null,
      // 080'in RASTER YEDEK yolu; vektör imza (imza_svg) panelin yolu.
      imzaYol: imzaTaslak?.storagePath ?? null,
      sonuc,
      sebep: sonuc === "teslim_edilemedi" ? sebep : null,
      latitude: konum.lat,
      longitude: konum.lng,
      dogrulukM: konum.acc,
    },
    fotoTaslaklari.length > 0
  );

  if (!y.ok) {
    if (y.sebep === "durak_dolu") {
      return mobileError(409, "kanit_zaten_var", {
        durakId,
        aciklama: "Bir durağın tek GEÇERLİ kanıtı olur; düzeltme için kanıt iptal edilir.",
      });
    }
    if (y.sebep === "tablo_yok") return mobileError(409, "ozellik_kapali", { migration: "080" });
    if (y.sebep === "kolon_yok") return mobileError(409, "ozellik_kapali", { migration: "109" });
    if (y.sebep === "kanit_yok") {
      return mobileError(400, "kanit_yok", {
        aciklama: "İmzasız, fotoğrafsız, notsuz, alıcısız bir teslimat hiçbir şeyi kanıtlamaz.",
      });
    }
    return mobileError(503, "db_error", { sebep: y.mesaj?.slice(0, 120) });
  }

  // ── FOTOĞRAFLARI BAĞLA ─────────────────────────────────────────────────
  // ⚠️ KANIT ARTIK VAR VE DEĞİŞMEZ. Bir bağlama düşerse geri alınamaz (kanıdı
  // silmek 080'in tüm duruşuna aykırı); bu yüzden SAYILAR DÖNÜYOR. Sessizce
  // "ok:true" demek, eksik bir delili tam göstermek olurdu.
  let fotoBagli = 0;
  const dusenTaslaklar: string[] = [];
  for (const f of fotoTaslaklari) {
    const r = await addTeslimatFoto(y.id, f.storagePath, {
      latitude: f.latitude,
      longitude: f.longitude,
      dogrulukM: f.dogrulukM,
    });
    if (r.ok) fotoBagli++;
    else dusenTaslaklar.push(f.id);
  }

  // Bağlananların taslağı silinir; DÜŞENLERİNKİ DURUR — dosyası hâlâ yalnız o
  // satırda tutuluyor, silmek onu yetim bırakırdı.
  const baglanan = [
    ...fotoTaslaklari.filter((f) => !dusenTaslaklar.includes(f.id)).map((f) => f.id),
    ...(imzaTaslak ? [imzaTaslak.id] : []),
  ];
  const silme = await deleteTaslaklar(baglanan);

  // ── DURAK DURUMU (panel kuralı) ────────────────────────────────────────
  const hedefDurum = sonuc === "teslim" ? "tamamlandi" : "atlandi";
  const g = await ilerletDurak(durak.id, hedefDurum, { sebep: sebep || null });
  const { duraklar } = await listDuraklar(seferId);

  let panelTazelendi = true;
  try {
    revalidatePath("/panel/seferler");
    revalidatePath("/admin/seferler");
  } catch {
    panelTazelendi = false;
  }

  const kanit = await getTeslimat(y.id);
  const gorunum = kanit ? (await imzaliKanitlar([kanit]))[0] : null;

  return Response.json({
    ok: true,
    /**
     * ⚠️ `kanitId` GÖVDEDEN AYRI DURUYOR. Geri okuma (`getTeslimat`) geçici bir
     * hatayla düşerse `kanit` null olur — ama KAYIT YAZILMIŞTIR. Kimliği yalnız
     * gövdenin içinde vermek, o durumda istemciyi "yazılmadı" sanmaya iterdi;
     * oysa yeniden denerse 409 alır. Kimlik her hâlde dönüyor.
     */
    kanitId: y.id,
    kanit: gorunum,
    foto: {
      istenen: fotoTaslaklari.length,
      bagli: fotoBagli,
      dusen: dusenTaslaklar.length,
      dusenTaslakIdleri: dusenTaslaklar,
    },
    taslakSilindi: silme.silinen,
    durumIlerledi: g.ok,
    durumSebep: g.ok ? null : g.sebep,
    durak: g.ok ? durakGovdesi(g.durak) : durakGovdesi(durak),
    ozet: durakOzetGovdesi(duraklar),
    panelTazelendi,
  });
}

/**
 * GET — durağın GEÇERLİ kanıtı (iptal edilmiş kanıt DÖNMEZ) + kısa ömürlü
 * imzalı URL'ler.
 *
 * ⚠️ KANIT YOKSA 404 DEĞİL, 200 + `kanit:null`. "Henüz kanıt bırakılmadı"
 * normal bir hâldir, hata değil — `GET …/duraklar`ın boş listeyi 200 ile
 * döndürmesiyle aynı kural.
 *
 * ⚠️ BEKLEYEN TASLAKLAR DA DÖNÜYOR. Fotoğrafını yükleyip uygulaması kapanan
 * şoför, neyin yüklü olduğunu göremezse aynı fotoğrafı yeniden yükler ve
 * kotasını ikinci kez yer. Taslak bu ucun açtığı bir kavram; onu görünür
 * kılmak da bu ucun işi.
 *
 * Gövde panelin gördüğüyle AYNI çekirdekten üretiliyor (`imzaliKanitlar`) —
 * `app/actions/teslimat.ts` de onu çağırıyor, kopya yok.
 */
export async function GET(req: NextRequest, { params }: Yol) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;
  const { worker } = guard.actor;
  const { id: seferId, durakId } = await params;

  // Okuma kapanmış seferde de meşru: bitmiş bir işin delili sorulabilir.
  // Yönetici MUAF — delili görmek onu üretmek değildir.
  const c = await kapiVeDurak(seferId, durakId, worker, {
    seferAcikOlmali: false,
    yoneticiMuaf: true,
  });
  if (!c.ok) return c.response;

  const bulundu = await getTeslimatByDurak(seferId, durakId);
  if (bulundu.tabloYok) return mobileError(409, "ozellik_kapali", { migration: "080" });
  if (bulundu.kolonYok) return mobileError(409, "ozellik_kapali", { migration: "082" });

  const gorunum = bulundu.teslimat ? (await imzaliKanitlar([bulundu.teslimat]))[0] : null;

  // Bekleyen taslaklar — yalnız İSTEK SAHİBİNİNKİLER. Yöneticinin şoförün
  // yarım kalmış yüklemesini görmesi, bitmemiş bir işi delil sanmasına
  // yol açardı.
  const taslak = await listTaslakByDurak(durakId, worker.id);
  const taslakUrl = taslak.taslaklar.length
    ? await signedReceiptUrls(TESLIMAT_KOVASI, taslak.taslaklar.map((x) => x.storagePath))
    : new Map<string, string>();

  return Response.json({
    ok: true,
    seferId,
    durakId,
    durak: durakGovdesi(c.durak),
    kanit: gorunum,
    bekleyenTaslaklar: taslak.taslaklar.map((x) => ({
      id: x.id,
      tur: x.tur,
      alindiAt: x.takenAt,
      url: taslakUrl.get(x.storagePath) ?? null,
    })),
    ozellikKapali: taslak.tabloYok ? { migration: "109" } : null,
  });
}
