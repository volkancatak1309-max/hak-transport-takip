import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * DOSYA YÜKLEME ÇEKİRDEĞİ — panel ve mobil TEK yerden yükler, siler, sayar.
 *
 * `lib/worker-account-db.ts`, `lib/shift-start.ts`, `lib/shift-correct.ts` ile
 * aynı desen: karar ve yazma burada, kimlik doğrulama ve sunum çağıranda.
 *
 * ═══ NEDEN VAR — ÖLÇÜLEN ÜÇ KUSUR ═══════════════════════════════════════
 *
 * 🔴 1. YETİM DOSYA. Bugün her yükleme yolu şu şekilde:
 *       `uploadReceipt(...)` → başarılı → `insert(...)` → BAŞARISIZ → dosya
 *       Storage'da kalır, kaydı yoktur, kimse bulamaz.
 *    `app/actions/dvir.ts` bunu KATMERLİ yapıyordu: kusurlu madde başına bir
 *    dosya yüklenip DÖNGÜDE biriktiriliyor, sonra `createDvirForm` düşerse
 *    N dosyanın HEPSİ yetim kalıyordu. `yukleVeYaz` bu deseni kapatıyor.
 *
 * 🔴 2. SİLME YOLU HİÇ YOKTU. Ölçüldü (03.09.2026): kaynakta tek bir
 *    `storage.remove()` çağrısı yoktu. Kayıt silinse bile dosya kalıyordu.
 *
 * 🔴 3. HIZ SINIRI YOKTU. Dosya yükleme, bant genişliği ve DEPOLAMA harcayan
 *    ilk uç; kardeş uçlardaki "sınır yok" kararı burada geçerli değil.
 *
 * ═══ KİRACI İZOLASYONU — EK BİR ŞEY GEREKMİYOR ══════════════════════════
 *
 * Her kiracı AYRI bir Supabase projesi (ayrı URL, ayrı service anahtarı, ayrı
 * Storage). Kova adları üç kiracıda da aynı ama FARKLI projelerde, yani çapraz
 * erişim şema ya da kontrol koduyla değil ALTYAPIYLA kapalı. Yola kiracı kodu
 * eklemek, tek projede iki kiracı olduğu yanılsaması yaratırdı.
 */

/** Tavan — üç kiracıda da kovaların SUNUCU TARAFI ayarıyla aynı (ölçüldü). */
export const YUKLEME_TAVAN_BAYT = 5 * 1024 * 1024;

/**
 * Yeni uçların kabul ettiği tipler (Volkan kararı, 03.09.2026).
 *
 * ⚠️ `image/heic` BİLEREK YOK. Panelin bugünkü yolu (lib/storage.ts
 * `uploadReceipt`) onu kabul ediyor ve kova ayarı da izin veriyor; o davranış
 * DEĞİŞMEDİ. Yeni yüzeylerde dışarıda çünkü HEIC'i sunucuda çözecek bir yol
 * yok: panel istemcide JPEG'e çeviriyor (lib/image-resize.ts), çeviremezse ham
 * gönderiyor — ve o dosya hiçbir tarayıcıda GÖRÜNTÜLENEMİYOR. Kabul edilen ama
 * açılamayan bir kanıt, reddedilenden kötüdür.
 */
export const IZINLI_TIPLER = ["image/jpeg", "image/png", "image/webp"] as const;

/** Panelin geriye dönük listesi — `uploadReceipt` bunu geçiyor. */
export const IZINLI_TIPLER_PANEL = [...IZINLI_TIPLER, "image/heic"] as const;

/** Kişi başına pencere içindeki yükleme tavanı (Volkan kararı). */
export const HIZ_TAVAN = 10;
/** Sabit pencere uzunluğu (ms). */
export const HIZ_PENCERE_MS = 60_000;

export type YuklemeHatasi =
  | "dosya_yok"
  | "cok_buyuk"
  | "tip_yasak"
  | "hiz_siniri"
  | "depo_hatasi";

export type YuklemeSonuc =
  | { ok: true; yol: string; bayt: number; tip: string }
  | {
      ok: false;
      hata: YuklemeHatasi;
      ayrinti?: string;
      /** Yalnız hiz_siniri: kaç saniye sonra tekrar denenebilir. */
      retryAfter?: number;
    };

function uzanti(tip: string): string {
  if (tip.includes("png")) return "png";
  if (tip.includes("webp")) return "webp";
  if (tip.includes("heic")) return "heic";
  return "jpg";
}

// ── HIZ SINIRI (migration 098) ──────────────────────────────────────────────

export type HizSonuc =
  | { ok: true; kalan: number }
  | { ok: false; retryAfter: number };

/** PostgreSQL `undefined_table` — 098 uygulanmamış kurulumu ayırt eder. */
const TABLO_YOK = "42P01";

function tabloYokMu(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false;
  return e.code === TABLO_YOK || /upload_rate/.test(e.message ?? "");
}

/**
 * Kişinin kotasını okur ve HARCAR. Tavana ulaşıldıysa `ok:false`.
 *
 * ⚠️ MIGRATION 098 YOKSA SINIRSIZ GEÇER (fail-OPEN) ve bu bilinçli. Fail-closed
 * olsaydı 098'i çalıştırmamış bir kurulumda dosya yükleme TÜMDEN kapanırdı —
 * yani bir maliyet freni, bir özellik kapısına dönüşürdü. Bedeli: o kurulumda
 * sınır yok, yani bugünkü durum. Çağıran bunu yanıtta GÖRÜR (`hizSiniri:false`)
 * ve sessiz kalmaz.
 *
 * Kimlik doğrulama kapılarındaki fail-CLOSED kuralıyla çelişmiyor: orada
 * hatanın bedeli yetkisiz erişim, burada fazla dosya.
 */
export async function hizSiniriHarca(workerId: string): Promise<HizSonuc & { uygulandi: boolean }> {
  const simdi = Date.now();
  const { data, error } = await supabaseAdmin
    .from("upload_rate")
    .select("pencere_basi, sayac")
    .eq("worker_id", workerId)
    .maybeSingle();

  if (error && tabloYokMu(error)) return { ok: true, kalan: HIZ_TAVAN, uygulandi: false };
  if (error) {
    // Geçici DB hatası — fren uygulanamadı ama yükleme engellenmez (bkz. not).
    return { ok: true, kalan: HIZ_TAVAN, uygulandi: false };
  }

  const basiMs = data?.pencere_basi ? new Date(data.pencere_basi as string).getTime() : 0;
  const pencereBitti = !data || simdi - basiMs >= HIZ_PENCERE_MS;
  const sayac = pencereBitti ? 0 : ((data?.sayac as number | null) ?? 0);

  if (sayac >= HIZ_TAVAN) {
    const retryAfter = Math.max(1, Math.ceil((basiMs + HIZ_PENCERE_MS - simdi) / 1000));
    return { ok: false, retryAfter, uygulandi: true };
  }

  const pencereBasi = pencereBitti ? new Date(simdi).toISOString() : (data!.pencere_basi as string);
  const { error: yazErr } = await supabaseAdmin.from("upload_rate").upsert(
    {
      worker_id: workerId,
      pencere_basi: pencereBasi,
      sayac: sayac + 1,
      updated_at: new Date(simdi).toISOString(),
    },
    { onConflict: "worker_id" }
  );
  // Yazma düşerse sayaç ilerlemez; yükleme yine de geçer (fren yaklaşıktır).
  return { ok: true, kalan: HIZ_TAVAN - (sayac + 1), uygulandi: !yazErr };
}

/**
 * Harcanmış bir kotayı GERİ VERİR — yükleme sonrası bir adım düştüğünde.
 *
 * Olmasaydı, sunucu hatası yüzünden başarısız olan bir istek kullanıcının
 * kotasını yerdi: "yükleyemedim ama hakkım gitti".
 */
export async function hizSiniriIadeEt(workerId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("upload_rate")
    .select("pencere_basi, sayac")
    .eq("worker_id", workerId)
    .maybeSingle();
  if (!data) return;
  const sayac = Math.max(0, ((data.sayac as number | null) ?? 0) - 1);
  await supabaseAdmin
    .from("upload_rate")
    .update({ sayac })
    .eq("worker_id", workerId)
    .then(
      () => {},
      () => {}
    );
}

// ── YÜKLEME ─────────────────────────────────────────────────────────────────

/**
 * TEK YÜKLEME YOLU. Sıra tartışma dışı:
 *   1. dosya var mı  2. boyut  3. tip  4. hız sınırı  5. Storage'a yaz
 *
 * Hız sınırı doğrulamalardan SONRA: bozuk bir istek kullanıcının kotasını
 * yememeli. Storage'a yazmadan ÖNCE: kota tükenmişse bant genişliği harcanmaz.
 *
 * Yol deseni `{workerId}/{yyyy}/{mm}/{uuid}.{ext}` — panelin bugünkü deseniyle
 * BİREBİR aynı (lib/storage.ts). Değiştirmek, var olan dosyaları iki desenli
 * bir kovada bırakırdı.
 */
export async function dosyaYukle(
  kova: string,
  workerId: string,
  file: File | null | undefined,
  secenek?: { izinliTipler?: readonly string[]; hizSiniri?: boolean }
): Promise<YuklemeSonuc & { hizUygulandi?: boolean }> {
  const izinli = secenek?.izinliTipler ?? IZINLI_TIPLER;

  if (!file || file.size === 0) return { ok: false, hata: "dosya_yok" };
  if (file.size > YUKLEME_TAVAN_BAYT) {
    return { ok: false, hata: "cok_buyuk", ayrinti: `${file.size}/${YUKLEME_TAVAN_BAYT}` };
  }
  const tip = file.type || "image/jpeg";
  if (!izinli.includes(tip)) {
    return { ok: false, hata: "tip_yasak", ayrinti: tip };
  }

  let hizUygulandi = false;
  if (secenek?.hizSiniri !== false) {
    const h = await hizSiniriHarca(workerId);
    hizUygulandi = h.uygulandi;
    if (!h.ok) return { ok: false, hata: "hiz_siniri", retryAfter: h.retryAfter, hizUygulandi };
  }

  const now = new Date();
  const yol = `${workerId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${uzanti(tip)}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabaseAdmin.storage
    .from(kova)
    .upload(yol, buffer, { contentType: tip, upsert: false });

  if (error) {
    // Depo yazamadıysa kota iade edilir: kullanıcının suçu değil.
    if (hizUygulandi) await hizSiniriIadeEt(workerId);
    return { ok: false, hata: "depo_hatasi", ayrinti: error.message, hizUygulandi: false };
  }
  return { ok: true, yol, bayt: file.size, tip, hizUygulandi };
}

// ── SİLME ───────────────────────────────────────────────────────────────────

/**
 * Storage'dan dosya(ları) siler. **Bu depodaki tek silme yolu.**
 *
 * Best-effort DEĞİL: sonuç DÖNER ve çağıran onu yutmamalı. "Kaç dosya
 * silinemedi" sorusunun cevabı olmayan bir silme, silme sözü vermez.
 */
export async function dosyaSil(
  kova: string,
  yollar: (string | null | undefined)[]
): Promise<{ ok: boolean; silinen: number; hata?: string }> {
  const liste = yollar.filter((y): y is string => typeof y === "string" && y.length > 0);
  if (liste.length === 0) return { ok: true, silinen: 0 };
  const { data, error } = await supabaseAdmin.storage.from(kova).remove(liste);
  if (error) return { ok: false, silinen: 0, hata: error.message };
  return { ok: true, silinen: Array.isArray(data) ? data.length : liste.length };
}

// ── YÜKLE + YAZ, YETİM BIRAKMADAN ───────────────────────────────────────────

export type YukleVeYazSonuc<T> =
  | { ok: true; yol: string; kayit: T }
  | {
      ok: false;
      hata: YuklemeHatasi | "yazma_hatasi";
      ayrinti?: string;
      retryAfter?: number;
      /** Yazma düştüğünde yüklenen dosya geri alındı mı. */
      dosyaTemizlendi?: boolean;
    };

/**
 * 🔑 YETİM DOSYA KAPISI — dosyayı yükler, kaydı yazdırır, YAZMA DÜŞERSE
 * dosyayı SİLER.
 *
 * `yaz` geri çağrısı yolu alır ve kaydı yazar. `null` döndürmesi ya da
 * fırlatması "yazamadım" demektir; her iki hâlde de dosya geri alınır ve
 * kullanıcının kotası iade edilir.
 *
 * Bu fonksiyon olmadan her çağıran aynı üç satırı kendi yazmak zorunda kalır
 * ve biri unuttuğunda kusur SESSİZDİR: yükleme çalışır, kayıt düşer, dosya
 * kimsenin görmediği bir yerde durur.
 */
export async function yukleVeYaz<T>(
  kova: string,
  workerId: string,
  file: File | null | undefined,
  yaz: (yol: string) => Promise<T | null>,
  secenek?: { izinliTipler?: readonly string[] }
): Promise<YukleVeYazSonuc<T>> {
  const up = await dosyaYukle(kova, workerId, file, secenek);
  if (!up.ok) {
    return { ok: false, hata: up.hata, ayrinti: up.ayrinti, retryAfter: up.retryAfter };
  }

  let kayit: T | null = null;
  let ayrinti: string | undefined;
  try {
    kayit = await yaz(up.yol);
  } catch (e) {
    ayrinti = e instanceof Error ? e.message : String(e);
  }

  if (kayit === null || kayit === undefined) {
    const sil = await dosyaSil(kova, [up.yol]);
    if (up.hizUygulandi) await hizSiniriIadeEt(workerId);
    return {
      ok: false,
      hata: "yazma_hatasi",
      ayrinti,
      dosyaTemizlendi: sil.ok && sil.silinen > 0,
    };
  }

  return { ok: true, yol: up.yol, kayit };
}

/**
 * ÇOK DOSYALI YÜKLEME — hepsi ya da hiçbiri.
 *
 * DVIR formu için: kusurlu madde başına bir fotoğraf yüklenir, sonra TEK bir
 * kayıt yazılır. Herhangi bir adım düşerse O ANA KADAR yüklenen dosyaların
 * TAMAMI silinir. Eski kod bunu yapmıyordu ve N dosya birden yetim kalıyordu
 * (app/actions/dvir.ts, ölçüldü).
 */
export const COKLU_DOSYA_TAVAN = 30;

export async function coklaYukleVeYaz<T>(
  kova: string,
  workerId: string,
  dosyalar: { anahtar: string; file: File | null | undefined }[],
  yaz: (yollar: Map<string, string>) => Promise<T | null>,
  secenek?: { izinliTipler?: readonly string[] }
): Promise<YukleVeYazSonuc<T> & { anahtar?: string }> {
  const yuklenen: string[] = [];
  const harita = new Map<string, string>();
  let hizHarcandi = false;

  const geriAl = async () => {
    if (yuklenen.length) await dosyaSil(kova, yuklenen);
    if (hizHarcandi) await hizSiniriIadeEt(workerId);
  };

  /**
   * ⚠️ KOTA İSTEK BAŞINA, DOSYA BAŞINA DEĞİL — ve bu bir gevşetme değil,
   * DOĞRU BİRİM.
   *
   * DVIR formu TEK bir kullanıcı eylemidir ama kusurlu madde sayısı kadar
   * dosya taşır. Kontrol listesi 15-20 maddelik; hepsi kusurluysa dosya
   * başına kota o formu 10. maddede REDDEDERDİ — yani bir maliyet freni,
   * yasal bir kontrol formunu tamamlanamaz hâle getirirdi.
   *
   * Maliyet yine de sınırlı: dosya SAYISI `COKLU_DOSYA_TAVAN` ile, dosya
   * BOYUTU `YUKLEME_TAVAN_BAYT` ile kapalı. Bir istekle en fazla 30 × 5 MB.
   */
  if (dosyalar.length > COKLU_DOSYA_TAVAN) {
    return { ok: false, hata: "hiz_siniri", ayrinti: `${dosyalar.length}/${COKLU_DOSYA_TAVAN}` };
  }
  const h = await hizSiniriHarca(workerId);
  hizHarcandi = h.uygulandi;
  if (!h.ok) return { ok: false, hata: "hiz_siniri", retryAfter: h.retryAfter };

  for (const d of dosyalar) {
    // hizSiniri:false — kota yukarıda BİR KEZ harcandı.
    const up = await dosyaYukle(kova, workerId, d.file, { ...secenek, hizSiniri: false });
    if (!up.ok) {
      await geriAl();
      return {
        ok: false,
        hata: up.hata,
        ayrinti: up.ayrinti,
        retryAfter: up.retryAfter,
        anahtar: d.anahtar,
        dosyaTemizlendi: true,
      };
    }
    yuklenen.push(up.yol);
    harita.set(d.anahtar, up.yol);
  }

  let kayit: T | null = null;
  let ayrinti: string | undefined;
  try {
    kayit = await yaz(harita);
  } catch (e) {
    ayrinti = e instanceof Error ? e.message : String(e);
  }

  if (kayit === null || kayit === undefined) {
    await geriAl();
    return { ok: false, hata: "yazma_hatasi", ayrinti, dosyaTemizlendi: true };
  }

  return { ok: true, yol: yuklenen[0] ?? "", kayit };
}
