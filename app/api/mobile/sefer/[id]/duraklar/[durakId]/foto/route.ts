import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileWorker } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { yukleVeYaz } from "@/lib/upload-core";
import { getSeferById, ACIK_DURUMLAR } from "@/lib/sefer-db";
import { getDurak } from "@/lib/sefer-duraklari";
import {
  TESLIMAT_KOVASI,
  getTeslimatByDurak,
  addTeslimatFoto,
  createTaslak,
  type TaslakTur,
} from "@/lib/teslimat-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/sefer/[id]/duraklar/[durakId]/foto
 * — ŞOFÖR TESLİMAT KANITINA FOTOĞRAF EKLER.
 *
 * **multipart/form-data** · alanlar: `foto` (zorunlu), `lat`, `lng`, `accuracy`.
 * Mobil API'nin İLK multipart ucu (ölçüldü 03.09.2026: o güne dek 0 dosya ucu).
 *
 * Panelde karşılığı `teslimatFotoEkle`; kurallar KOPYALANMADI —
 * `lib/upload-core.ts` ikisinin de tek kaynağı.
 *
 * ── DURAK EKSENİ, TESLİMAT EKSENİ DEĞİL ────────────────────────────────────
 * Panel `teslimatId` alıyor; şoför telefonda o kimliği bilmiyor, DURAKTA
 * duruyor. Uç bu çeviriyi `getTeslimatByDurak` ile yapar: `durak_id` ile arar
 * (`durak_no` ile DEĞİL — sıra değişebilir, kalıcı bağ id'dir) ve İPTAL
 * EDİLMİŞ kanıtı döndürmez.
 *
 * Durakta henüz kanıt yoksa `409 kanit_yok`: fotoğraf bir kanıta eklenir,
 * kanıdın kendisi değildir. Şoför önce teslimatı kaydeder.
 *
 * ── TASLAK YOLU (109) — AYNI UÇ, AÇIK RIZAYLA ──────────────────────────────
 * `taslak=1` gönderilirse kural TERSİNE döner: kanıt YOKKEN yükleme KABUL
 * edilir ve dosya bir TASLAK satırına bağlanır (`teslimat_taslak_dosyalari`).
 * Dönen `id` sonra `POST …/kanit` gövdesindeki `fotoIds[]` / `imzaId` olur.
 *
 * Sebebi telefonun akışı: şoför kapıda ÖNCE fotoğrafı çeker; "teslim ettim"e
 * bastığı an işin SONUDUR. Panelin sırası (önce kanıt, sonra fotoğraf) telefona
 * dayatılsaydı, fotoğraf yüklenmeden yarım bir delil kaydı açmak gerekirdi.
 *
 * ⚠️ NEDEN BAYRAKLA, SESSİZCE DEĞİL: `taslak` gönderilmeyen istek ESKİSİ GİBİ
 * 409 alır. Davranışı sessizce değiştirmek, bugünkü bir istemcinin 409 beklediği
 * yerde 200 görmesi demekti — fotoğraf "eklendi" sanılır, oysa hiçbir kanıta
 * bağlı değildir ve `…/kanit` çağrılmazsa bağlanmadan kalır. Bayrak, istemcinin
 * yeni akışı bildiğini söyler.
 *
 * ⚠️ TASLAK DELİL DEĞİLDİR: değişebilir ve silinebilir. Kanıt tablolarındaki
 * değişmezliğe (HK080) DOKUNULMADI — bağlama anında `teslimat_fotograflari`na
 * INSERT edilir.
 *
 * ── KAPI: KANITI BIRAKAN KİŞİ ──────────────────────────────────────────────
 * `requireMobileWorker` + kanıdın `workerId`si token sahibiyle aynı olmalı —
 * panelin cümlesinin aynısı. Yönetici bile başkasının kanıtına fotoğraf
 * ekleyemez: delilin kim tarafından üretildiği delilin parçasıdır.
 *
 * ── 🔴 SİLME UCU YOK, VE BU BİR EKSİK DEĞİL ────────────────────────────────
 * `teslimatlar` ve `teslimat_fotograflari` DEĞİŞMEZ (080, `HK080`
 * tetikleyicileri). Yanlış bir kanıt silinmez, İPTAL edilir — sebebiyle
 * birlikte kayıtta kalır. Fotoğrafı silebilen bir uç o değişmezliği
 * çiğnerdi: bir delili silmek, onu değiştirmekten kötüdür.
 *
 * Yetim koruması yine de burada ve GEREKLİ: `addTeslimatFoto` düşerse
 * yüklenen dosya SİLİNİR (`yukleVeYaz`). Silinen bir kayıt değil, hiç
 * kaydedilmemiş bir dosyadır.
 *
 * ── HATA KODLARI ───────────────────────────────────────────────────────────
 *   401 missing_token / invalid_token / revoked / inactive   (ortak kapı)
 *   403 kanit_senin_degil · sefer_sizin_degil               (taslak yolu)
 *   404 sefer_yok             — durakta geçerli kanıt yok
 *       not_found             — sefer/durak yok (taslak yolu)
 *   409 kanit_yok             — önce teslimat kaydedilmeli (taslak=1 YOKSA)
 *       sefer_kapali          — kapanmış sefere ne taslak ne fotoğraf (ÜÇ yol da)
 *       ozellik_kapali        — migration 080/082/109 uygulanmamış
 *   400 dosya_yok · cok_buyuk · tip_yasak · gecersiz_govde · gecersiz_tur
 *   429 hiz_siniri            + Retry-After
 *   503 depo_hatasi · yazma_hatasi
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; durakId: string }> }
) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;
  const { worker } = guard.actor;

  const { id: seferId, durakId } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    // multipart olmayan gövde: içerik türü yanlış ya da bozuk sınır.
    return mobileError(400, "gecersiz_govde", { beklenen: "multipart/form-data" });
  }

  const file = form.get("foto");
  if (!(file instanceof File)) {
    return mobileError(400, "dosya_yok", { alan: "foto" });
  }

  const sayi = (v: FormDataEntryValue | null): number | null => {
    if (v === null) return null;
    const n = Number(String(v));
    return Number.isFinite(n) ? n : null;
  };

  const konum = {
    latitude: sayi(form.get("lat")),
    longitude: sayi(form.get("lng")),
    dogrulukM: sayi(form.get("accuracy")),
  };

  /**
   * TASLAK yolu açık rızayla seçilir; `taslak` alanı YOKSA aşağıdaki eski
   * davranış (kanıt yoksa 409) aynen sürer.
   */
  const taslakIstendi = ["1", "true", "evet"].includes(
    String(form.get("taslak") ?? "").toLowerCase()
  );

  // ── HANGİ KANIT ────────────────────────────────────────────────────────
  const bulundu = await getTeslimatByDurak(seferId, durakId);
  if (bulundu.tabloYok) {
    return mobileError(409, "ozellik_kapali", { migration: "080" });
  }
  if (bulundu.kolonYok) {
    return mobileError(409, "ozellik_kapali", { migration: "082" });
  }

  // ── TASLAK: KANIT YOKKEN YÜKLEME ───────────────────────────────────────
  if (!bulundu.teslimat && taslakIstendi) {
    return taslakYukle({ seferId, durakId, worker, form, file, konum });
  }

  if (!bulundu.teslimat) {
    return mobileError(409, "kanit_yok", {
      sebep: "durakta_gecerli_kanit_yok",
      taslakIcin: "multipart alanına taslak=1 ekleyin (109)",
    });
  }
  const kanit = bulundu.teslimat;

  // Kanıtı bırakan kişi DEĞİLSE fotoğraf ekleyemez (panelin aynı cümlesi).
  if (kanit.workerId !== worker.id) {
    return mobileError(403, "kanit_senin_degil");
  }

  /**
   * 🔴 KAPANMIŞ SEFERE FOTOĞRAF DA YOK (109 turunda eklendi).
   *
   * ÖLÇÜLDÜ: bu yol `ACIK_DURUMLAR`ı HİÇ okumuyordu. Yani şoför seferi
   * `tamamlandi`ya getirdikten sonra bile mevcut kanıda yeni fotoğraf
   * ekleyebiliyordu — kanıt ucu ve taslak yolu aynı istekte 409 `sefer_kapali`
   * verirken üçüncü yol açık kalıyordu. "Olayın kendisinden sonra delil
   * üretilmez" kuralının üç kapıda da AYNI olması gerekiyor; biri açıkken
   * diğer ikisinin kapalı olması kuralı değil yalnız görüntüsünü korur.
   */
  const sefer = await getSeferById(seferId);
  if (!sefer) return mobileError(404, "not_found");
  if (!ACIK_DURUMLAR.includes(sefer.durum)) {
    return mobileError(409, "sefer_kapali", { mevcutDurum: sefer.durum });
  }

  // ── YÜKLE + YAZ, YETİM BIRAKMADAN ──────────────────────────────────────
  let yazmaSebep: string | null = null;
  const c = await yukleVeYaz(TESLIMAT_KOVASI, worker.id, file, async (yol) => {
    const r = await addTeslimatFoto(kanit.id, yol, konum);
    if (!r.ok) {
      yazmaSebep = r.sebep;
      return null;
    }
    return r.id;
  });

  if (!c.ok) return yuklemeHatasi(c, yazmaSebep);

  let panelTazelendi = true;
  try {
    revalidatePath("/panel/seferler");
    revalidatePath("/admin/seferler");
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    foto: { id: c.kayit, yol: c.yol },
    teslimatId: kanit.id,
    panelTazelendi,
  });
}

/**
 * Yükleme çekirdeğinin hata varyantlarını HTTP'ye çeviren TEK yer.
 *
 * İki yol (kanıta ekleme · taslak) aynı çekirdeği çağırıyor; çeviriyi
 * kopyalasaydık biri `Retry-After` başlığını ya da `dosyaTemizlendi` alanını
 * unuttuğunda fark SESSİZ olurdu.
 */
function yuklemeHatasi(
  c: Extract<Awaited<ReturnType<typeof yukleVeYaz>>, { ok: false }>,
  yazmaSebep: string | null
): Response {
  if (c.hata === "hiz_siniri") {
    return Response.json(
      { ok: false, error: "hiz_siniri", retryAfter: c.retryAfter },
      { status: 429, headers: { "Retry-After": String(c.retryAfter ?? 60) } }
    );
  }
  if (c.hata === "dosya_yok" || c.hata === "cok_buyuk" || c.hata === "tip_yasak") {
    return mobileError(400, c.hata, { ayrinti: c.ayrinti });
  }
  if (c.hata === "yazma_hatasi") {
    // `dosyaTemizlendi` YUTULMUYOR: temizlik başarısızsa yetim VARDIR ve
    // yanıt bunu söyler — sessiz kalmak, sözü tutmadan tutmuş görünmektir.
    return mobileError(503, "yazma_hatasi", {
      sebep: yazmaSebep ?? undefined,
      dosyaTemizlendi: c.dosyaTemizlendi === true,
    });
  }
  return mobileError(503, "depo_hatasi", { ayrinti: c.ayrinti });
}

/**
 * TASLAK YÜKLEME (109) — kanıt açılmadan önce dosyayı park eder.
 *
 * ═══ 🔴 KAPI: `…/kanit` UCUYLA BİREBİR AYNI CÜMLE ═══
 *
 * YALNIZ SEFERİN ŞOFÖRÜ. **Yönetici de 403 alır** — kanıt ucunun kuralının
 * aynısı (Volkan kararı 21.09.2026).
 *
 * Taslak sonradan KANITA DÖNÜŞÜYOR; kapı kanıt ucundan gevşek olsaydı, kanıt
 * ucunun reddettiği kişi dosyayı yine de sisteme sokar ve o dosya birinin
 * delili olurdu. İki kapının aynı cümleyi kurması tesadüf değil, şart.
 *
 * ⚠️ KAPANMIŞ SEFERE TASLAK DA YOK: kanıt ucunun kuralının aynısı. Bitmiş bir
 * işin dosyasını sonradan yüklemek, olayın kendisinden sonra delil üretmenin
 * ilk adımıdır.
 */
async function taslakYukle(a: {
  seferId: string;
  durakId: string;
  worker: { id: string };
  form: FormData;
  file: File;
  konum: { latitude: number | null; longitude: number | null; dogrulukM: number | null };
}): Promise<Response> {
  const turHam = String(a.form.get("tur") ?? "foto").toLowerCase();
  if (turHam !== "foto" && turHam !== "imza") {
    return mobileError(400, "gecersiz_tur", { alan: "tur", gecerli: ["foto", "imza"] });
  }
  const tur = turHam as TaslakTur;

  const sefer = await getSeferById(a.seferId);
  if (!sefer) return mobileError(404, "not_found");
  // ⚠️ `is_admin` HİÇ OKUNMUYOR — yazma tarafında yönetici muafiyeti YOK.
  if (sefer.worker_id !== a.worker.id) {
    return mobileError(403, "sefer_sizin_degil");
  }
  if (!ACIK_DURUMLAR.includes(sefer.durum)) {
    return mobileError(409, "sefer_kapali", { mevcutDurum: sefer.durum });
  }

  // Durak GERÇEKTEN bu seferin mi — yol/gövde uyuşmazlığı imkânsız olmalı.
  const durak = await getDurak(a.durakId);
  if (!durak || durak.sefer_id !== a.seferId) return mobileError(404, "not_found");

  let yazmaSebep: string | null = null;
  const c = await yukleVeYaz(TESLIMAT_KOVASI, a.worker.id, a.file, async (yol) => {
    const r = await createTaslak(
      { seferId: a.seferId, durakId: a.durakId, workerId: a.worker.id, tur, storagePath: yol },
      a.konum
    );
    if (!r.ok) {
      yazmaSebep = r.sebep;
      return null;
    }
    return r.id;
  });

  if (!c.ok) {
    // 109 uygulanmamışsa yazma `tablo_yok` der ve dosya zaten geri alınmıştır.
    if (c.hata === "yazma_hatasi" && yazmaSebep === "tablo_yok") {
      return mobileError(409, "ozellik_kapali", {
        migration: "109",
        dosyaTemizlendi: c.dosyaTemizlendi === true,
      });
    }
    return yuklemeHatasi(c, yazmaSebep);
  }

  return Response.json({
    ok: true,
    taslak: { id: c.kayit, tur, yol: c.yol },
    /** Kanıt HENÜZ YOK — istemci bunu `…/kanit` gövdesine taşımak zorunda. */
    teslimatId: null,
    sonrakiAdim: "POST …/kanit gövdesinde " + (tur === "imza" ? "imzaId" : "fotoIds[]"),
  });
}
