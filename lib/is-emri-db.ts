import "server-only";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { tabloYokMu } from "@/lib/fault-reports";
import { kullanimdaMi, type SilmeSonucu } from "@/lib/silme-sonucu";
import type { IsEmri, IsEmriDurum, IsEmriOncelik } from "@/lib/is-emri";

/**
 * İŞ EMRİ — veri katmanı (migration 081).
 *
 * ═══ NEDEN AYRI TABLO DEĞİL ═══
 *
 * İş emri `vehicle_fault_reports` tablosunda yaşıyor. Ölçüldü (25.08.2026):
 * o tablo canlıda VAR ama 0 satır; şoförün "arıza bildir" yüzeyi (mobil U7)
 * oraya yazıyor. Ayrı bir iş emri tablosu açsaydık "bu araçta ne sorun var"
 * sorusunun İKİ listesi olurdu ve yönetici ikisine birden bakmak zorunda
 * kalırdı. Kaynak farkı `kaynak` kolonunda: surucu · dvir · dtc · periyodik ·
 * elle.
 *
 * ═══ BU DOSYA İLE lib/fault-reports-db.ts AYRIMI ═══
 *
 * `fault-reports-db.ts` MOBİL sözleşmedir (U7): dar alan kümesi, acik/kapali.
 * Bu dosya PANEL yüzeyidir: öncelik, atanan, maliyet, servis tarihi, üçüncü
 * durum. İkisi aynı tabloyu okur; ortak olan tek şey satırın kendisi.
 * ⚠️ Mobil uç yalnız acik/kapali gönderiyor — 'serviste' panelden atanır ve
 * mobil onu "açık değil, kapalı değil" diye değil, ham değeriyle görür.
 */

// Sabitler ve satır türü `lib/is-emri.ts`te — İSTEMCİ de onları import ediyor
// ve bu dosya `server-only`. Aynı listeyi iki yerde tanımlamak yerine tek
// kaynak orada; buradan yeniden dışa aktarılıyor.
export {
  IS_EMRI_DURUMLARI,
  IS_EMRI_ONCELIKLERI,
  IS_EMRI_KAYNAKLARI,
  type IsEmriDurum,
  type IsEmriOncelik,
  type IsEmriKaynak,
  type IsEmri,
} from "@/lib/is-emri";

const COLS =
  "id, vehicle_id, reported_by, aciklama, durum, created_at, closed_at, kaynak, oncelik, atanan_id, maliyet, servis_at, kapanis_notu, dvir_yanit_id";

export type IsEmriSonuc<T> =
  | { ok: true; veri: T }
  | {
      ok: false;
      sebep: "tablo_yok" | "yok" | "hata" | "kapanis_notu_gerekli" | "bos_yama";
      mesaj?: string;
    };

/**
 * ÖNCELİK SIRASI — kritik önce, düşük sonra.
 *
 * ⚠️ NEDEN VERİTABANINDA DEĞİL: `oncelik` bir `text` kolonu ve PostgREST yalnız
 * kolonun KENDİ sırasına göre sıralayabiliyor; alfabetik sıra
 * (dusuk · kritik · normal · yuksek) bu kuyruk için ANLAMSIZ. Doğru sırayı
 * şemaya taşımak ya bir enum tipi ya da bir `oncelik_sira` kolonu ister —
 * ikisi de migration demek. Kuyruk küçük (bir yapılacaklar listesi, bir kayıt
 * defteri değil), o yüzden sıralama BELLEKTE yapılıyor ve okuma
 * `fetchAllRows` ile sayfalanıyor: 1000 satır tavanına dayanılırsa o dosya
 * yüksek sesle uyarır (bkz. lib/supabase.ts warnTruncated).
 */
const ONCELIK_SIRA: Record<string, number> = {
  kritik: 0,
  yuksek: 1,
  normal: 2,
  dusuk: 3,
};

function oncelikSirasi(o: string): number {
  return ONCELIK_SIRA[o] ?? ONCELIK_SIRA.normal;
}

/** Önce öncelik (kritik→düşük), sonra tarih (yeni→eski). */
export function siralaIsEmirleri(emirler: IsEmri[]): IsEmri[] {
  return [...emirler].sort((a, b) => {
    const f = oncelikSirasi(a.oncelik) - oncelikSirasi(b.oncelik);
    return f !== 0 ? f : b.createdAt.localeCompare(a.createdAt);
  });
}

async function zenginlestir(satirlar: Record<string, unknown>[]): Promise<IsEmri[]> {
  if (satirlar.length === 0) return [];
  const aracIds = [...new Set(satirlar.map((r) => String(r.vehicle_id)))];
  const kisiIds = [
    ...new Set(
      satirlar.flatMap((r) => [String(r.reported_by), r.atanan_id ? String(r.atanan_id) : null])
    ),
  ].filter(Boolean) as string[];

  const [{ data: vRows }, { data: wRows }] = await Promise.all([
    supabaseAdmin.from("vehicles").select("id, plate").in("id", aracIds),
    kisiIds.length
      ? supabaseAdmin.from("workers").select("id, name").in("id", kisiIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const plaka = new Map(((vRows ?? []) as { id: string; plate: string }[]).map((v) => [v.id, v.plate]));
  const ad = new Map(((wRows ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));

  return satirlar.map((r) => ({
    id: String(r.id),
    vehicleId: String(r.vehicle_id),
    plaka: plaka.get(String(r.vehicle_id)) ?? "—",
    aciklama: String(r.aciklama),
    durum: String(r.durum) as IsEmriDurum,
    oncelik: String(r.oncelik ?? "normal") as IsEmriOncelik,
    kaynak: String(r.kaynak ?? "surucu"),
    bildirenId: String(r.reported_by),
    bildirenAd: ad.get(String(r.reported_by)) ?? "—",
    atananId: r.atanan_id ? String(r.atanan_id) : null,
    atananAd: r.atanan_id ? (ad.get(String(r.atanan_id)) ?? "—") : null,
    maliyet: r.maliyet == null ? null : Number(r.maliyet),
    servisAt: r.servis_at ? String(r.servis_at) : null,
    kapanisNotu: r.kapanis_notu ? String(r.kapanis_notu) : null,
    createdAt: String(r.created_at),
    closedAt: r.closed_at ? String(r.closed_at) : null,
  }));
}

/** Liste süzgeci — `hepsi` = durum süzmesi YOK (kapalılar dahil). */
export type IsEmriDurumSuzgec = IsEmriDurum | "hepsi";

/**
 * İş emirleri.
 *
 * `yalnizAcik` varsayılan TRUE: yöneticinin ekranı bir KUYRUKTUR, arşiv değil.
 * Kapanmışları görmek isteyen açıkça ister. `durum` verilirse `yalnizAcik`
 * YOK SAYILIR — ikisi aynı soruyu soruyor ve çakışmaları sessizce çözmek
 * yerine biri açıkça kazanıyor.
 *
 * SIRA: önce öncelik (kritik→düşük), sonra tarih (yeni→eski). Sıralama
 * bellekte (bkz. ONCELIK_SIRA başlığı), okuma `fetchAllRows` ile sayfalı —
 * yani PostgREST'in 1000 satır tavanına sessizce takılmıyor.
 *
 * `toplam` SÜZÜLMÜŞ kümenin gerçek uzunluğudur, sayfanın değil: istemci
 * "kaç tane var" sorusunu tahmin etmesin.
 */
export async function listIsEmirleri(opts?: {
  vehicleIds?: string[] | null;
  yalnizAcik?: boolean;
  durum?: IsEmriDurumSuzgec;
  oncelik?: IsEmriOncelik;
  vehicleId?: string | null;
  limit?: number;
  offset?: number;
}): Promise<{ emirler: IsEmri[]; tabloYok: boolean; toplam: number }> {
  if (opts?.vehicleIds && opts.vehicleIds.length === 0) {
    return { emirler: [], tabloYok: false, toplam: 0 };
  }
  // Kapsam DIŞI bir araç istendi: boş küme, 403 DEĞİL — liste ucu bir varlık
  // sorgusu değil; "senin filonda böyle bir araç yok" cevabı da bir sızıntıdır.
  if (opts?.vehicleId && opts.vehicleIds && !opts.vehicleIds.includes(opts.vehicleId)) {
    return { emirler: [], tabloYok: false, toplam: 0 };
  }

  const { data, error } = await fetchAllRows<Record<string, unknown>>((from, to) => {
    let q = supabaseAdmin.from("vehicle_fault_reports").select(COLS);
    if (opts?.vehicleIds) q = q.in("vehicle_id", opts.vehicleIds);
    if (opts?.vehicleId) q = q.eq("vehicle_id", opts.vehicleId);
    if (opts?.oncelik) q = q.eq("oncelik", opts.oncelik);
    if (opts?.durum && opts.durum !== "hepsi") q = q.eq("durum", opts.durum);
    else if (!opts?.durum && opts?.yalnizAcik !== false) q = q.neq("durum", "kapali");
    return q.order("created_at", { ascending: false }).range(from, to);
  }, "listIsEmirleri");

  if (error) return { emirler: [], tabloYok: tabloYokMu(error), toplam: 0 };

  const tumu = siralaIsEmirleri(await zenginlestir(data));
  const offset = Math.max(0, opts?.offset ?? 0);
  const limit = opts?.limit ?? 100;
  return { emirler: tumu.slice(offset, offset + limit), tabloYok: false, toplam: tumu.length };
}

/**
 * ŞOFÖRÜN YAZABİLECEĞİ ARAÇLAR — açık vardiyasının aracı + kendisine ATANMIŞ araç.
 *
 * ═══ NEDEN "HER ARAÇ" DEĞİL ═══
 *
 * Arıza bildirimi bir YAZMA ucudur ve araç kimliğini çağıran gönderiyor. Şoföre
 * serbest araç seçimi vermek, filodaki her aracın kimliğini deneyerek kayıt
 * açabilmek demekti — hem çöp kuyruk, hem "hangi araçlar var" sorusunun
 * dolaylı cevabı. Bu yüzden yazma ANAHTARLI: şoför yalnız BUGÜN kullandığı ya
 * da kendisine atanmış araç için bildirim açabilir.
 *
 * ═══ NEDEN İKİ KAYNAK ═══
 *
 * Atanmış araç kalıcı bağdır; açık vardiya ANLIK gerçektir. Geçici araçla
 * (bkz. lib/fleet-scope.ts) çıkan şoför atamasından farklı bir araç kullanıyor
 * olabilir ve arızayı tam o araçta görür. Yalnız atamaya baksaydık, o bildirim
 * hiç açılamazdı.
 *
 * FAIL-CLOSED: okuma hata verirse BOŞ küme döner — yani yazma reddedilir.
 */
export async function soforAracKapsami(workerId: string): Promise<Set<string>> {
  const [{ data: vardiya }, { data: atanan }] = await Promise.all([
    supabaseAdmin
      .from("time_entries")
      .select("vehicle_id")
      .eq("worker_id", workerId)
      .is("ended_at", null)
      .not("vehicle_id", "is", null)
      .order("started_at", { ascending: false })
      .limit(1),
    supabaseAdmin.from("vehicles").select("id").eq("assigned_worker_id", workerId),
  ]);

  const kume = new Set<string>();
  for (const r of (vardiya ?? []) as { vehicle_id: string | null }[]) {
    if (r.vehicle_id) kume.add(r.vehicle_id);
  }
  for (const r of (atanan ?? []) as { id: string }[]) kume.add(r.id);
  return kume;
}

/**
 * "BU AKTÖR BU ARACA İŞ EMRİ / ARIZA YAZABİLİR Mİ" — TEK KURAL, İKİ ÇAĞIRAN.
 *
 * Yeni mobil uç (`POST /api/mobile/is-emirleri`) ve arıza bildirimi ucu
 * (`POST /api/mobile/vehicles/[id]/ariza-bildir`) aynı soruyu soruyor. Kuralı
 * iki yere yazmak, birini sonradan gevşetip diğerini unutmanın garantisiydi.
 *
 * Dönen `kaynak`, satıra yazılacak köken: yönetici/şef eliyle açılan emir
 * `elle`, şoförün bildirdiği `surucu`. Kaynak İSTEMCİDEN ALINMAZ — rolden
 * türer; "elle" yazan bir şoför isteği kurulamaz çünkü alanı yok.
 */
export type IsEmriYazmaIzni =
  | { ok: true; kaynak: "elle" | "surucu"; sofor: boolean }
  | { ok: false; sebep: "kapsam_disi" };

export async function isEmriYazmaIzni(aktor: {
  workerId: string;
  isAdmin: boolean;
  isChief: boolean;
  isFleetVehicle: (id: string) => boolean;
}, vehicleId: string): Promise<IsEmriYazmaIzni> {
  if (aktor.isAdmin) return { ok: true, kaynak: "elle", sofor: false };
  if (aktor.isChief) {
    return aktor.isFleetVehicle(vehicleId)
      ? { ok: true, kaynak: "elle", sofor: false }
      : { ok: false, sebep: "kapsam_disi" };
  }
  const kume = await soforAracKapsami(aktor.workerId);
  return kume.has(vehicleId)
    ? { ok: true, kaynak: "surucu", sofor: true }
    : { ok: false, sebep: "kapsam_disi" };
}

/**
 * AÇIK iş emri olan araçlar — "sorunlu" rozetinin tek kaynağı.
 *
 * ⚠️ `vehicles`a bayrak yazılmıyor: açık emrin varlığı zaten gerçeğin kendisi.
 * Bayrak koysaydık kapanışta güncellemeyi unutan bir yol, sonsuza dek sorunlu
 * görünen bir araç bırakırdı.
 */
export async function sorunluAraclar(
  vehicleIds?: string[] | null
): Promise<{ harita: Map<string, number>; tabloYok: boolean }> {
  let q = supabaseAdmin.from("vehicle_fault_reports").select("vehicle_id").neq("durum", "kapali");
  if (vehicleIds) {
    if (vehicleIds.length === 0) return { harita: new Map(), tabloYok: false };
    q = q.in("vehicle_id", vehicleIds);
  }
  const { data, error } = await q;
  if (error) return { harita: new Map(), tabloYok: tabloYokMu(error) };
  const harita = new Map<string, number>();
  for (const r of (data ?? []) as { vehicle_id: string }[]) {
    harita.set(r.vehicle_id, (harita.get(r.vehicle_id) ?? 0) + 1);
  }
  return { harita, tabloYok: false };
}

export async function getIsEmri(id: string): Promise<IsEmri | null> {
  const { data, error } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select(COLS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const [e] = await zenginlestir([data as Record<string, unknown>]);
  return e ?? null;
}

/**
 * İş emri yaratır.
 *
 * `kaynak` emrin KÖKENİ: panelden/mobilden elle açılan `elle`, şoförün
 * bildirdiği `surucu`, DTC'den çevrilen `dtc`, bakım planından doğan
 * `periyodik`. Kökenin sonucu var: `deleteIsEmri` YALNIZ `elle` olanı siler.
 * Bu yüzden kaynak hiçbir zaman istemciden gelmez, çağıranın rolünden türer
 * (bkz. isEmriYazmaIzni).
 */
export async function createIsEmri(
  g: {
    vehicleId: string;
    aciklama: string;
    oncelik?: IsEmriOncelik;
    kaynak?: "elle" | "surucu" | "dtc" | "periyodik";
    atananId?: string | null;
  },
  actorWorkerId: string
): Promise<IsEmriSonuc<{ id: string }>> {
  const { data, error } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .insert({
      vehicle_id: g.vehicleId,
      reported_by: actorWorkerId,
      aciklama: g.aciklama.trim().slice(0, 1000),
      durum: "acik",
      kaynak: g.kaynak ?? "elle",
      oncelik: g.oncelik ?? "normal",
      atanan_id: g.atananId ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, sebep: error && tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error?.message };
  }
  return { ok: true, veri: { id: String((data as { id: string }).id) } };
}

/**
 * İş emrini günceller: durum, öncelik, atanan, maliyet, servis tarihi, kapanış.
 *
 * ⚠️ AÇIKLAMA DEĞİŞTİRİLEMEZ. Kusurun ne olduğu, bildirildiği andaki hâliyle
 * kalır — DVIR yolunda o metin kontrol formundaki kanıttan doğuyor ve onu
 * sonradan yeniden yazmak, kanıtı yeniden yazmak olurdu.
 */
export async function updateIsEmri(
  id: string,
  yama: {
    durum?: IsEmriDurum;
    oncelik?: IsEmriOncelik;
    atananId?: string | null;
    maliyet?: number | null;
    servisAt?: string | null;
    kapanisNotu?: string | null;
  },
  actorWorkerId: string | null,
  opts?: {
    /**
     * Kapatırken kapanış notu ZORUNLU olsun mu.
     *
     * ⚠️ POLİTİKA ÇAĞIRANDA, KURAL BURADA. Mobil uç bunu AÇIK gönderiyor;
     * panel GÖNDERMİYOR ve bugünkü davranışını koruyor (bugün notsuz
     * kapatabiliyor — canlı HAK61/Sendigo'da çalışan bir akış). Kuralın
     * gövdesi tek yerde (burada), sıkılığı yüzeyin kararı. Paneli de
     * sıkmak ayrı ve bilinçli bir karar olmalı.
     */
    kapanisNotuZorunlu?: boolean;
    /** Çağıran kaydı zaten okuduysa ikinci okumayı atlamak için. */
    mevcut?: IsEmri | null;
  }
): Promise<IsEmriSonuc<{ id: string }>> {
  if (opts?.kapanisNotuZorunlu && yama.durum === "kapali") {
    // Yeni not gövdede yoksa KAYITTAKİNE bakılır: notu zaten yazılmış bir emri
    // yeniden kapatmak (ya da kapalıyken başka bir alanını düzeltmek) not
    // istemesin — zorunluluk "kapanış gerekçesiz kalmasın" demek, "her istekte
    // tekrar yaz" demek değil.
    const yeni = yama.kapanisNotu?.trim();
    const eskiNot = opts.mevcut?.kapanisNotu?.trim();
    if (!yeni && !eskiNot) return { ok: false, sebep: "kapanis_notu_gerekli" };
  }

  const satir: Record<string, unknown> = {};
  if (yama.durum) satir.durum = yama.durum;
  if (yama.oncelik) satir.oncelik = yama.oncelik;
  if (yama.atananId !== undefined) satir.atanan_id = yama.atananId;
  if (yama.maliyet !== undefined) satir.maliyet = yama.maliyet;
  if (yama.servisAt !== undefined) satir.servis_at = yama.servisAt;
  if (yama.kapanisNotu !== undefined) satir.kapanis_notu = yama.kapanisNotu?.slice(0, 500) ?? null;

  /**
   * KAPANIŞ DAMGASI kapanışla birlikte düşer, tekrar açılışta SİLİNİR.
   * 057'nin kuralı: "aynı durum ikinci kez YAZMAZ" — burada da kapalıyı
   * kapalıya çekmek damgayı tazelemesin diye koşul aşağıda `.neq`.
   */
  if (yama.durum === "kapali") {
    satir.closed_at = new Date().toISOString();
    satir.closed_by = actorWorkerId;
  } else if (yama.durum) {
    satir.closed_at = null;
    satir.closed_by = null;
  }

  if (Object.keys(satir).length === 0) return { ok: false, sebep: "bos_yama" };

  let q = supabaseAdmin.from("vehicle_fault_reports").update(satir).eq("id", id);
  // Kapalıyı tekrar kapatmak damgayı tazelemesin.
  if (yama.durum === "kapali") q = q.neq("durum", "kapali");

  const { data, error } = await q.select("id").maybeSingle();
  if (error) {
    return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error.message };
  }
  // `data` null = satır zaten o durumdaydı. Hata DEĞİL: istenen sonuç zaten var.
  return { ok: true, veri: { id: data ? String((data as { id: string }).id) : id } };
}

/**
 * İŞ EMRİNİ SİLER — YALNIZ elle açılmış ve HENÜZ KAPANMAMIŞ olanı.
 *
 * ═══ NEDEN HERKESİ DEĞİL ═══
 *
 * Kontrol formundan doğan emir (`kaynak='dvir'`) bir KANIT zincirinin
 * halkasıdır: `dvir_yanit_id` ile o kusurun fotoğrafına ve notuna bağlı.
 * Silinseydi, "kusur bildirildi ama ne yapıldı" sorusunun cevabı kaybolurdu —
 * kontrol formunun kendisi de bu yüzden değişmez (HK081). Aynı gerekçe DTC ve
 * periyodik bakımdan doğan emirler için de geçerli: onların geri alınabilir
 * yolu SİLME değil, DURUM DEĞİŞTİRMEDİR (kapat ↔ yeniden aç).
 *
 * Elle açılan emir ise yalnız bir yönetici girdisidir; yanlış araca açılmış
 * olabilir ve kullanıcı onu geri alabilmelidir.
 *
 * KAPANMIŞ emir de silinmez: kapanış maliyeti ve servis tarihi taşır.
 */
export async function deleteIsEmri(id: string): Promise<SilmeSonucu> {
  const { data, error: okumaHatasi } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("id, kaynak, durum")
    .eq("id", id)
    .maybeSingle();
  if (okumaHatasi) {
    return {
      ok: false,
      sebep: tabloYokMu(okumaHatasi) ? "tablo_yok" : "hata",
      mesaj: okumaHatasi.message,
    };
  }
  if (!data) return { ok: false, sebep: "yok" };

  const satir = data as { kaynak: string | null; durum: string };
  if ((satir.kaynak ?? "surucu") !== "elle") return { ok: false, sebep: "silinemez", mesaj: "kaynak" };
  if (satir.durum === "kapali") return { ok: false, sebep: "silinemez", mesaj: "kapali" };

  const { error } = await supabaseAdmin.from("vehicle_fault_reports").delete().eq("id", id);
  if (error) {
    return {
      ok: false,
      sebep: tabloYokMu(error) ? "tablo_yok" : kullanimdaMi(error) ? "kullanimda" : "hata",
      mesaj: error.message,
    };
  }
  return { ok: true };
}
