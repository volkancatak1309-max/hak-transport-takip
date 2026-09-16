import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { markKmMeasured, type KmShiftRow } from "@/lib/km-quality";
import { kmDiff } from "@/lib/format";
import { MAX_PLAUSIBLE_KM_PER_DAY } from "@/lib/analytics";

/**
 * VARDİYA KM'SİNİN EKSENİ — TEK KARAR NOKTASI (13. madde, 16.09.2026).
 *
 * ═══ İKİ EKSEN, İKİSİ AYNI SAYI DEĞİL ═════════════════════════════════════
 *
 *   B · CİHAZ  — `shift_odometer_spans` (052): vardiya penceresi içindeki
 *                ilk ve son odometre okumasının farkı.
 *   A · SAYAÇ  — `end_km - start_km` (lib/format.ts kmDiff): vardiya
 *                satırındaki iki uç. Uçlar da cihazdan yazılır ama vardiya
 *                AÇILIŞ/KAPANIŞ anındaki en son okumadan, yaş sınırı olmadan.
 *
 * ÖLÇÜLDÜ (HAK61, son 30 gün): ikisi de ölçülebilen 324 vardiyanın yalnız
 * %27,2'si birebir aynı. Filo geneli Σ A 17.278 km · Σ B 16.579 km (−%4,0);
 * ama KİŞİ bazında aylık toplam 23 şoförün 6'sında %20'den fazla oynuyor
 * (uçlar: 516→111 = −%78,5 ve 472→714 = +%51,3).
 *
 * ═══ NEDEN B OTOMATİK OLARAK "DAHA DOĞRU" DEĞİL ═══════════════════════════
 *
 * B, ATFETME sorusunda kesin olarak daha doğru: hangi vardiyada, hangi şoför
 * direksiyondaydı. Ama BÜYÜKLÜK sorusunda eksik sayabilir — cihaz vardiyanın
 * yalnız bir bölümünde konuştuysa pencere içindeki ilk ve son okuma birbirine
 * yakın olur ve gerçek yolun bir dilimi ölçülür. Canlıdaki en uç örnek
 * A=348 km → B=37 km (−311).
 *
 * KAPSAMA KAPISI tam bu yüzden var: B'ye ancak cihaz vardiyanın BAŞINDAN
 * SONUNA konuştuysa güvenilir.
 *
 * ═══ KURAL ════════════════════════════════════════════════════════════════
 *
 *   1. B ölçülebilir (iki uç dolu, fark ≥ 0) VE kapsama yeterli
 *      VE sahte-0 değil                        → km = B, kaynak "cihaz"
 *   2. aksi hâlde A ölçülebilir (kmDiff null değil — km_measured kapısı
 *      lib/km-quality.ts'te zaten uygulanmış)   → km = A, kaynak "sayac"
 *   3. ikisi de yok                             → km = null, kaynak "olculmedi"
 *
 * ═══ SAHTE 0 KAPISI İKİ EKSENE DE UYGULANIR ═══════════════════════════════
 *
 * `km_measured=false` "bu vardiyanın 0'ı ölçüm değil" demektir (cihaz sessizdi
 * ya da araç hareket etti ama sayaç izlemedi — lib/km-quality.ts). Kapı
 * A ekseni için yazılmıştı; ÖLÇÜLDÜ ki B'ye de gerekiyor: HAK61'de son 30
 * günde B'si 0 çıkan 14 vardiyanın 1'inde araç GERÇEKTEN hareket etmişti.
 * Yani B de sahte 0 üretebiliyor ve kapı ikisine de uygulanıyor.
 *
 * ⚠️ Kapının ① numaralı kolu (pencerede hiç telemetri yok) B'de yapısal
 * olarak zaten çalışıyor: okuma yoksa 052 `first_km`/`last_km` NULL döner,
 * A'nın bayat değer yazma kusuru burada YOK.
 */

/** Kapsama eşiği — ilk okuma başlangıçtan, son okuma bitişten en çok bu kadar uzakta. */
export const KAPSAMA_TOLERANS_DK = 15;
const KAPSAMA_TOLERANS_MS = KAPSAMA_TOLERANS_DK * 60_000;

export type KmKaynak = "cihaz" | "sayac" | "olculmedi" | "bilinmiyor";

export type KmKarari = {
  km: number | null;
  kaynak: KmKaynak;
  /**
   * B neden kullanılmadı — `kaynak !== "cihaz"` iken doludur. Sessiz düşüş
   * yok: "cihaz ölçmedi" ile "cihaz ölçtü ama yarısını kaçırdı" farklı şeyler.
   */
  bSebep?:
    | "okuma_yok"
    | "kapsama_yetersiz"
    | "negatif"
    | "sahte_sifir"
    | "makul_disi"
    | "zaman_bilinmiyor";
};

/** 052 + 100'ün döndürdüğü satır. `ilk_an`/`son_an` 100 uygulanmadan gelmez. */
export type SpanRow = {
  time_entry_id: string;
  worker_id: string | null;
  vehicle_id: string | null;
  started_at: string;
  ended_at: string | null;
  first_km: number | null;
  last_km: number | null;
  ilk_an?: string | null;
  son_an?: string | null;
};

export type KmEkseniSonucu = {
  /** vardiya kimliği → karar. */
  karar: Map<string, KmKarari>;
  /**
   * 052 okunamadıysa sebep; okunduysa null. `rpc_yok` = migration 052 hiç
   * çalışmamış, `zaman_yok` = 052 var ama 100 uygulanmamış (kapsama
   * sorulamıyor → B'ye güvenilmiyor).
   */
  bDurumu: null | "rpc_yok" | "zaman_yok" | "zaman_asimi" | "hata";
};

/** PostgreSQL / PostgREST: fonksiyon yok. */
const RPC_YOK = new Set(["PGRST202", "42883"]);

function zamanAsimiMi(e: { code?: string | null; message?: string | null }) {
  const c = (e.code ?? "").toUpperCase();
  return c === "57014" || /timeout|canceling statement/i.test(e.message ?? "");
}

/**
 * Bir pencere içindeki vardiyalar için km kararını üretir.
 *
 * `entries` çağıranın ELİNDEKİ vardiya satırlarıdır (A ekseni ve sahte-0
 * kapısı oradan gelir). 052 aynı pencere için TEK çağrıyla okunur — vardiya
 * başına RPC YOK. Ölçüldü (HAK61): 30 günlük pencere 425 vardiya / 153 ms,
 * 30 vardiyalık liste sayfası 84 ms.
 *
 * ⚠️ `entries` içinde `km_measured` YOKSA burada hesaplanır; varsa yeniden
 * hesaplanmaz (çağıran zaten `markKmMeasured`den geçirmişse ikinci turu
 * ödemesin).
 */
export async function kmEkseniCoz<T extends KmShiftRow & { id: string }>(
  entries: T[],
  pencere: { from: string; to: string }
): Promise<KmEkseniSonucu> {
  const karar = new Map<string, KmKarari>();
  if (entries.length === 0) return { karar, bDurumu: null };

  // A ekseni + sahte-0 bayrağı. Zaten işaretliyse ikinci sorgu atılmaz.
  const isaretli = entries.every((e) => "km_measured" in e)
    ? (entries as (T & { km_measured: boolean })[])
    : await markKmMeasured(entries);

  // ── B ekseni: TEK RPC ────────────────────────────────────────────────────
  let spans: SpanRow[] = [];
  let bDurumu: KmEkseniSonucu["bDurumu"] = null;
  const { data, error } = await supabaseAdmin.rpc("shift_odometer_spans", {
    p_from: pencere.from,
    p_to: pencere.to,
  });
  if (error) {
    const c = (error.code ?? "").toUpperCase();
    bDurumu = RPC_YOK.has(c) ? "rpc_yok" : zamanAsimiMi(error) ? "zaman_asimi" : "hata";
  } else {
    spans = (data ?? []) as SpanRow[];
    /**
     * 100 UYGULANMADI MI? `ilk_an` alanı hiç gelmiyorsa kapsama sorulamaz ve
     * B'ye GÜVENİLMEZ — hepsi A'ya düşer. Sessizce "kapsama tamam" saymak,
     * ölçülmemiş bir kapıyı geçmiş gibi göstermek olurdu.
     */
    if (spans.length > 0 && !("ilk_an" in spans[0])) bDurumu = "zaman_yok";
  }
  const bById = new Map(spans.map((s) => [s.time_entry_id, s]));

  for (const e of isaretli) {
    karar.set(
      e.id,
      kmKarariVer(e, bById.get(e.id) ?? null, bDurumu === "zaman_yok")
    );
  }

  return { karar, bDurumu };
}

/**
 * KARARIN SAF HÂLİ — ağ yok, yan etki yok.
 *
 * Ayrı durmasının sebebi ölçülebilirlik: hem muhafız hem canlı ölçüm betiği
 * BU fonksiyonu çağırır, kuralın kopyasını yazmaz. Kopyalanan bir kural, ilk
 * değişiklikte ölçümün gerçeği doğrulamayı bırakması demektir.
 */
export function kmKarariVer(
  entry: KmShiftRow & { km_measured?: boolean },
  span: SpanRow | null,
  zamanBilinmiyor = false
): KmKarari {
  const a = kmDiff(entry); // km_measured=false ise zaten null

  let bKm: number | null = null;
  let bSebep: KmKarari["bSebep"];
  if (zamanBilinmiyor) {
    bSebep = "zaman_bilinmiyor";
  } else if (!span || span.first_km === null || span.last_km === null) {
    bSebep = "okuma_yok";
  } else if (span.last_km - span.first_km < 0) {
    // Odometre geri gitmiş — cihaz değişimi ya da bozuk okuma. Guard'ın
    // negatif kolu (lib/analytics.ts) ile aynı karar.
    bSebep = "negatif";
  } else if (!makulMu(span)) {
    /**
     * 🔴 BU KAPI ÖLÇÜMLE EKLENDİ (16.09.2026). İlk yazımda yoktu ve
     * galzura-demo'da 30 günlük toplam 20.850 km yerine 118.264 km çıktı
     * (+%467) — tek bir bozuk odometre okuması. HAK61'de hiç ısırmıyordu,
     * yani yalnız gerçek veriye bakmak kusuru gösteremezdi.
     *
     * Eşik `MAX_PLAUSIBLE_KM_PER_DAY` (lib/analytics.ts) — KOPYALANMADI, içe
     * aktarıldı: iki dosyada iki farklı "makul km" tanımı olsaydı aynı vardiya
     * Analiz'de elenip burada geçebilirdi.
     */
    bSebep = "makul_disi";
  } else if (!kapsamaYeterli(span)) {
    bSebep = "kapsama_yetersiz";
  } else if (span.last_km - span.first_km === 0 && entry.km_measured === false) {
    // Sahte 0: araç hareket etmiş ama odometre kıpırdamamış.
    bSebep = "sahte_sifir";
  } else {
    bKm = span.last_km - span.first_km;
  }

  if (bKm !== null) return { km: bKm, kaynak: "cihaz" };
  if (a !== null) return { km: a, kaynak: "sayac", bSebep };
  return { km: null, kaynak: "olculmedi", bSebep };
}

/**
 * CİHAZ VARDİYANIN BAŞINDAN SONUNA KONUŞTU MU.
 *
 * İlk okuma başlangıçtan en çok KAPSAMA_TOLERANS_DK sonra, son okuma bitişten
 * en çok o kadar önce olmalı. Eşik TEK YERDE (KAPSAMA_TOLERANS_DK) — iki
 * dosyada iki farklı "yeterli kapsama" tanımı olmasın.
 *
 * ⚠️ AÇIK VARDİYA: `ended_at` null iken bitiş kenarı DENETLENMEZ. Açık
 * vardiyanın sonu henüz yok; "bitişten 15 dk önce" sorusunun cevabı da yok.
 * Başlangıç kenarı yine denetlenir.
 */
/**
 * MAKUL KM KAPISI — vardiya süresine göre üst sınır.
 *
 * `getWorkerShiftDistance` ile AYNI formül (lib/analytics.ts:526-531): süre
 * saat cinsinden en az 1/24 gün sayılır, fark o gün sayısı ×
 * MAX_PLAUSIBLE_KM_PER_DAY'i aşarsa ölçüm güvenilmez.
 */
function makulMu(s: SpanRow): boolean {
  if (s.first_km === null || s.last_km === null) return false;
  const bit = s.ended_at ? Date.parse(s.ended_at) : Date.now();
  const gunSayisi = Math.max(1 / 24, (bit - Date.parse(s.started_at)) / 86_400_000);
  return s.last_km - s.first_km <= gunSayisi * MAX_PLAUSIBLE_KM_PER_DAY;
}

function kapsamaYeterli(s: SpanRow): boolean {
  if (!s.ilk_an) return false;
  const bas = Date.parse(s.started_at);
  const ilk = Date.parse(s.ilk_an);
  if (!Number.isFinite(bas) || !Number.isFinite(ilk)) return false;
  if (ilk - bas > KAPSAMA_TOLERANS_MS) return false;

  if (s.ended_at === null) return true; // açık vardiya: bitiş kenarı yok
  if (!s.son_an) return false;
  const bit = Date.parse(s.ended_at);
  const son = Date.parse(s.son_an);
  if (!Number.isFinite(bit) || !Number.isFinite(son)) return false;
  return bit - son <= KAPSAMA_TOLERANS_MS;
}

/**
 * Bir küme içinde her kaynağın kaç vardiyada seçileceği.
 *
 * TOPLAM km tek bir eksenden gelmez — ay toplamı gibi bir sayının yanına tek
 * bir `kmKaynak` yazmak yalan olurdu. Dağılım, "bu toplamın ne kadarı cihazdan
 * gelirdi" sorusunu dürüstçe cevaplar.
 */
export function kaynakSay(
  entries: { id: string }[],
  karar: Map<string, KmKarari>
): Record<KmKaynak, number> {
  const out: Record<KmKaynak, number> = {
    cihaz: 0,
    sayac: 0,
    olculmedi: 0,
    bilinmiyor: 0,
  };
  for (const e of entries) out[karar.get(e.id)?.kaynak ?? "bilinmiyor"]++;
  return out;
}

/**
 * Bir vardiya kümesini KAPSAYAN en dar pencere.
 *
 * 052 aralık eksenli olduğu için çağıranın penceresi elle kurulmamalı: her
 * yüzey kendi sınırını yazsaydı biri `ended_at`i unutur ve gece yarısını aşan
 * vardiya sessizce kapsam dışı kalırdı. Boş küme → null (RPC hiç çağrılmaz).
 */
export function kmPencere(
  entries: { started_at: string; ended_at: string | null }[]
): { from: string; to: string } | null {
  if (entries.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const e of entries) {
    const b = Date.parse(e.started_at);
    if (Number.isFinite(b)) min = Math.min(min, b);
    // Açık vardiyanın sonu "şimdi" — pencere onu da kapsamalı.
    const s = e.ended_at ? Date.parse(e.ended_at) : Date.now();
    if (Number.isFinite(s)) max = Math.max(max, s);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { from: new Date(min).toISOString(), to: new Date(max).toISOString() };
}

/**
 * Tek vardiya için kolaylık sarmalayıcısı — pencere vardiyanın kendisidir.
 *
 * ⚠️ RPC aralık eksenli olduğu için bu çağrı pencereyle KESİŞEN tüm vardiyaları
 * döndürür (ölçüldü: tek vardiya isteğinde HAK61'de 21 satır, demo'da 16).
 * Maliyeti ölçüldü ve küçük (~84 ms); id dizisi alan bir aşırı yükleme
 * gerekmiyor.
 */
export async function kmEkseniTek<T extends KmShiftRow & { id: string }>(
  entry: T
): Promise<KmKarari> {
  const to = entry.ended_at ?? new Date().toISOString();
  const { karar } = await kmEkseniCoz([entry], { from: entry.started_at, to });
  return karar.get(entry.id) ?? { km: null, kaynak: "olculmedi" };
}
