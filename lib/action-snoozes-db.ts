import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu } from "@/lib/fault-reports";
import type { ErtelemeKaynak } from "@/lib/action-snoozes";

/**
 * AKSİYON ERTELEME — sorgu katmanı (migration 058).
 *
 * `lib/action-snoozes.ts` saf kurallar (muhafız orayı Node'da çalıştırıyor),
 * burası `server-only` + `supabaseAdmin`. Bölünme keyfî değil: saf tarafa tek
 * bir DB satırı sızsa muhafız betiği çalışamaz olurdu.
 *
 * `tabloYokMu` lib/fault-reports.ts'ten İÇE AKTARILIYOR, kopyalanmıyor: sınıf
 * genel bir PostgREST hata ayrımıdır (42P01 / PGRST205), arıza bildirimine özgü
 * değil. İkinci bir kopya, 11.08.2026'da orada düzeltilen "çıplak `does not
 * exist` kolon hatasını da yakalıyordu" kusurunu geri getirirdi.
 */

const SATIR_KOLONLARI =
  "id, item_source, item_id, vehicle_id, worker_id, snoozed_until, snoozed_by, created_at, cancelled_at";

type HamSatir = {
  id: string;
  item_source: string;
  item_id: string;
  vehicle_id: string | null;
  worker_id: string | null;
  snoozed_until: string;
  snoozed_by: string;
  created_at: string;
  cancelled_at: string | null;
};

export type ErtelemeSatiri = {
  id: string;
  kaynak: string;
  kalemId: string;
  /** Bu ana kadar ertelendi (ISO/UTC). */
  kadar: string;
  erteleyenId: string;
  olusturma: string;
  /** Geri alındıysa iptal anı; etkin ertelemede null. */
  iptalAni: string | null;
};

function disari(r: HamSatir): ErtelemeSatiri {
  return {
    id: r.id,
    kaynak: r.item_source,
    kalemId: r.item_id,
    kadar: r.snoozed_until,
    erteleyenId: r.snoozed_by,
    olusturma: r.created_at,
    iptalAni: r.cancelled_at,
  };
}

/** PostgreSQL `unique_violation` — kısmi benzersiz indeksin yarışta dönen kodu. */
const UNIQUE_VIOLATION = "23505";

export type ErtelemeYazma =
  | { ok: true; satir: ErtelemeSatiri; yeni: boolean }
  | { ok: false; sebep: "tablo_yok" | "hata" };

/**
 * Bir kalemi ertele. Zaten ETKİN ertelemesi varsa GÜNCELLER (upsert davranışı).
 *
 * ── NEDEN `.upsert()` DEĞİL ────────────────────────────────────────────────
 * Benzersizlik KISMİ bir indeksle kuruluyor (`where cancelled_at is null`,
 * migration 058) — iptal edilmiş satırlar aynı kalem için birikebilsin diye.
 * PostgREST'in `on_conflict` parametresi yalnız KOLON ADI taşır, indeksin WHERE
 * yüklemini taşıyamaz; dolayısıyla PostgreSQL kısmi indeksi arbiter olarak
 * seçemez ve `.upsert()` düşer. Oku-sonra-yaz bu yüzden; ölçüldü 11.08.2026.
 *
 * ── YARIŞ ──────────────────────────────────────────────────────────────────
 * İki telefon aynı anda aynı kalemi ertelerse ikisi de "etkin satır yok" görüp
 * INSERT'e gidebilir; ikincisi 23505 alır. O hata YUTULMAZ ve "yazma hatası"
 * da denmez — kaybeden istek okumayı tekrarlayıp GÜNCELLEMEYE döner. Kullanıcı
 * açısından sonuç aynı: kalem ertelendi, tek satır var.
 *
 * `created_at` güncellemede DOKUNULMAZ (ertelemenin doğduğu an), `snoozed_by`
 * ise TAZELENİR — son kararı kim verdiyse odur.
 */
export async function erteleKalem(
  kaynak: ErtelemeKaynak,
  kalemId: string,
  kadar: string,
  workerId: string
): Promise<ErtelemeYazma> {
  const etkiniOku = () =>
    supabaseAdmin
      .from("action_snoozes")
      .select(SATIR_KOLONLARI)
      .eq("item_source", kaynak)
      .eq("item_id", kalemId)
      .is("cancelled_at", null)
      .maybeSingle();

  const guncelle = async (id: string): Promise<ErtelemeYazma> => {
    const { data, error } = await supabaseAdmin
      .from("action_snoozes")
      .update({ snoozed_until: kadar, snoozed_by: workerId })
      .eq("id", id)
      .select(SATIR_KOLONLARI)
      .maybeSingle();
    if (error) return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata" };
    if (!data) return { ok: false, sebep: "hata" };
    return { ok: true, satir: disari(data as unknown as HamSatir), yeni: false };
  };

  const { data: mevcut, error: okumaHatasi } = await etkiniOku();
  if (okumaHatasi) {
    return { ok: false, sebep: tabloYokMu(okumaHatasi) ? "tablo_yok" : "hata" };
  }
  if (mevcut) return guncelle((mevcut as unknown as HamSatir).id);

  const { data, error } = await supabaseAdmin
    .from("action_snoozes")
    .insert({
      item_source: kaynak,
      item_id: kalemId,
      snoozed_until: kadar,
      snoozed_by: workerId,
      // vehicle_id / worker_id BİLEREK yazılmıyor: gövde onları taşımıyor ve
      // türetilmiş dikkat kalemlerinin ("kör araç") veritabanında bağlanacak
      // satırı yok. Kolonlar 058'de ileriki "bu aracın ertelemeleri" sorgusu
      // için duruyor; bugün dolduran bir yüzey YOK ve uydurulmuyor.
    })
    .select(SATIR_KOLONLARI)
    .maybeSingle();

  if (error) {
    // Yarış: araya giren istek etkin satırı açtı. Güncellemeye dön.
    if ((error.code ?? "") === UNIQUE_VIOLATION) {
      const { data: yeniden, error: e2 } = await etkiniOku();
      if (e2) return { ok: false, sebep: tabloYokMu(e2) ? "tablo_yok" : "hata" };
      if (yeniden) return guncelle((yeniden as unknown as HamSatir).id);
    }
    return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata" };
  }
  if (!data) return { ok: false, sebep: "hata" };
  return { ok: true, satir: disari(data as unknown as HamSatir), yeni: true };
}

export type ErtelemeGeriAlma =
  | { ok: true; satir: ErtelemeSatiri; degisti: boolean }
  | { ok: false; sebep: "yok" | "tablo_yok" | "hata" };

/**
 * "Şimdi geri al" — `cancelled_at = now()`. SATIR SİLİNMEZ.
 *
 * Silmek "kim ertelemişti, kim geri aldı" izini yok ederdi; erteleme bir
 * yönetici kararıdır (057'deki `closed_at` ile aynı gerekçe).
 *
 * ── AYNI SATIRI İKİNCİ KEZ GERİ ALMAK HATA DEĞİL ───────────────────────────
 * İki telefonun aynı düğmeye basması olağandır. İstek 200 döner ve
 * `degisti:false` der; İLK iptal anı TAZELENMEZ — yoksa "ne zaman geri
 * alındı" sorusunun cevabı her dokunuşta kayardı.
 */
export async function ertelemeyiGeriAl(id: string): Promise<ErtelemeGeriAlma> {
  const { data: onceki, error: okumaHatasi } = await supabaseAdmin
    .from("action_snoozes")
    .select(SATIR_KOLONLARI)
    .eq("id", id)
    .maybeSingle();
  if (okumaHatasi) {
    return { ok: false, sebep: tabloYokMu(okumaHatasi) ? "tablo_yok" : "hata" };
  }
  if (!onceki) return { ok: false, sebep: "yok" };
  const oncekiSatir = onceki as unknown as HamSatir;

  // Zaten iptalliyse DB'ye HİÇ dokunma — ilk iptal anı korunur.
  if (oncekiSatir.cancelled_at !== null) {
    return { ok: true, satir: disari(oncekiSatir), degisti: false };
  }

  const { data, error } = await supabaseAdmin
    .from("action_snoozes")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .select(SATIR_KOLONLARI)
    .maybeSingle();
  if (error) return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata" };
  if (!data) return { ok: false, sebep: "yok" };
  return { ok: true, satir: disari(data as unknown as HamSatir), degisti: true };
}

/** Etkin erteleme listesinde taşınacak en fazla satır. Aşılırsa SÖYLENİR. */
export const ERTELEME_LISTE_TAVANI = 200;

export type ErtelemeListesi = {
  satirlar: ErtelemeSatiri[];
  /** `var` liste gerçek · `tablo_yok` migration 058 uygulanmamış · `hata` sorgu düştü. */
  durum: "var" | "tablo_yok" | "hata";
  /** Etkin erteleme TOPLAMI (tavandan bağımsız). Hata hâlinde null. */
  toplam: number | null;
  kirpildi: boolean;
};

/**
 * ŞU AN ETKİN ertelemeler: `cancelled_at is null` VE `snoozed_until > now()`.
 *
 * ── BOŞ LİSTE ÜÇ AYRI ŞEY OLABİLİR ─────────────────────────────────────────
 * "erteleme yok" · "migration 058 bu kurulumda uygulanmamış" · "sorgu düştü".
 * Üçü yöneticiye farklı iş yaptırır, bu yüzden `durum` alanı taşınır. 058 yeni
 * kurulumların install SQL'inde YOK — Sendigo/galzura-demo'da bu blok gerçekten
 * boş döner ve sebebini söylemezse "hiçbir şey ertelenmemiş" gibi okunur.
 *
 * SÜRESİ GEÇEN KALEM KENDİLİĞİNDEN DÜŞER: `snoozed_until > now()` koşulu her
 * istekte yeniden değerlendiği için zamanlanmış bir işe (cron) gerek yok.
 */
export async function listActiveSnoozes(): Promise<ErtelemeListesi> {
  const { data, error, count } = await supabaseAdmin
    .from("action_snoozes")
    .select(SATIR_KOLONLARI, { count: "exact" })
    .is("cancelled_at", null)
    .gt("snoozed_until", new Date().toISOString())
    .order("snoozed_until", { ascending: true })
    .order("id", { ascending: true }) // eş anlı kayıtlarda deterministik sıra
    .limit(ERTELEME_LISTE_TAVANI);

  if (error) {
    return {
      satirlar: [],
      durum: tabloYokMu(error) ? "tablo_yok" : "hata",
      toplam: null,
      kirpildi: false,
    };
  }
  const rows = (data ?? []) as unknown as HamSatir[];
  const toplam = count ?? rows.length;
  return {
    satirlar: rows.map(disari),
    durum: "var",
    toplam,
    kirpildi: toplam > rows.length,
  };
}
