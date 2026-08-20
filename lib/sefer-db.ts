import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * SEFER VERİ KATMANI (migration 066).
 *
 * Yönetici gün için sefer oluşturur ve şoföre atar; şoför telefonda görür,
 * durum çizgisini ilerletir. Durak listesi YOK — sefer bir GÜN birimidir.
 *
 * ⚠️ KAPI BURADA YOK. Çağıran yetkiyi KENDİ denetler (uçlar
 * `app/api/mobile/sefer/**`). Bu dosyayı kapısız bir yerden çağırmak, sefer
 * yazmasını herkese açmaktır — lib/geofences-db.ts ile aynı kural.
 *
 * ⚠️ DİĞER ZİNCİRE TEMAS YOK. `zone_id` yalnız YAPISAL bir FK; bu dosya
 * `zone_visits`'e ne yazar ne okur, `geofences.purpose`a dokunmaz. Otomatik
 * "varıldı" köprüsü Tur 3'ün işi.
 */

export const SEFER_DURUMLARI = [
  "atandi",
  "kabul",
  "yolda",
  "tamamlandi",
  "iptal",
] as const;
export type SeferDurum = (typeof SEFER_DURUMLARI)[number];

/** Şoförün ilerletebildiği geçişler — "Reddet" YOK (Volkan kararı 3). */
export const SOFOR_GECISLERI = ["kabul", "yolda", "tamamlandi"] as const;
export type SoforGecis = (typeof SOFOR_GECISLERI)[number];

/**
 * DURUM ÇİZGİSİ — tek kaynak.
 *
 * atandi → kabul → yolda → tamamlandi
 * iptal yalnız yöneticiden ve YALNIZ açık bir seferde (PATCH).
 *
 * Haritada olmayan her geçiş 409'dur: sıra atlamak da (atandi → yolda), geri
 * gitmek de (yolda → kabul), kapanmış bir seferi oynatmak da
 * (tamamlandi/iptal → herhangi bir şey).
 */
const SONRAKI: Record<SeferDurum, SeferDurum | null> = {
  atandi: "kabul",
  kabul: "yolda",
  yolda: "tamamlandi",
  tamamlandi: null,
  iptal: null,
};

/** Her durumun kendi zaman damgası — geçiş onu yazar, başkasını değil. */
const DAMGA: Record<SeferDurum, string> = {
  atandi: "atandi_at",
  kabul: "kabul_at",
  yolda: "yolda_at",
  tamamlandi: "tamamlandi_at",
  iptal: "iptal_at",
};

/** AÇIK sayılan durumlar: iş hâlâ sürüyor. */
export const ACIK_DURUMLAR: SeferDurum[] = ["atandi", "kabul", "yolda"];

export type SeferRow = {
  id: string;
  tarih: string;
  worker_id: string;
  vehicle_id: string | null;
  zone_id: string | null;
  paket_hedef: number | null;
  notlar: string | null;
  durum: SeferDurum;
  atandi_at: string;
  kabul_at: string | null;
  yolda_at: string | null;
  tamamlandi_at: string | null;
  iptal_at: string | null;
  /** OTOMATİK (Tur 3, migration 070) — hedef bölgeye varış anı. */
  vardi_at: string | null;
  /** OTOMATİK (Tur 3) — o günün vardiyasından bağlanan teslim sayısı. */
  paket_gerceklesen: number | null;
  created_by: string | null;
  created_at: string;
};

const COLS =
  "id, tarih, worker_id, vehicle_id, zone_id, paket_hedef, notlar, durum, atandi_at, kabul_at, yolda_at, tamamlandi_at, iptal_at, vardi_at, paket_gerceklesen, created_by, created_at";

export async function getSeferById(id: string): Promise<SeferRow | null> {
  const { data, error } = await supabaseAdmin
    .from("seferler")
    .select(COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  return (data as unknown as SeferRow) ?? null;
}

/**
 * Bir günün seferleri. `workerId` verilirse yalnız o şoförünkiler.
 *
 * ⚠️ TEST ELEMESİ ÇAĞIRANIN İŞİ: `seferler`in kendi `is_test` kolonu yok
 * (bilerek — migration 066 başlığı). Eleme `worker_id` üzerinden, depodaki
 * ortak süzgeçle yapılır.
 */
export async function listSeferByDay(
  tarih: string,
  workerId?: string
): Promise<SeferRow[]> {
  let q = supabaseAdmin.from("seferler").select(COLS).eq("tarih", tarih);
  if (workerId) q = q.eq("worker_id", workerId);
  const { data, error } = await q
    .order("atandi_at", { ascending: true })
    .order("id");
  if (error) throw new Error(`sefer_list:${error.code}:${error.message}`);
  return (data ?? []) as unknown as SeferRow[];
}

/**
 * İŞ KURALI 1 — aynı şoföre aynı gün İKİNCİ AÇIK sefer açılamaz.
 *
 * Neden sunucuda ve neden DB kısıtı değil: kural "açık olanlar arasında tek"
 * demek, yani kısmi bir tekillik (`unique … where durum in (…)`). Postgres bunu
 * kısmi tekil indeksle yapabilirdi ama o zaman ihlal `23505` diye dönerdi ve
 * uç, kullanıcıya "bu şoförün bugün açık seferi var" diyemeden ham bir DB
 * hatası taşırdı. Burada okuyup 409 + `acik_sefer_var` döndürmek, hatayı
 * KULLANICININ diline çeviriyor.
 *
 * ⚠️ Yarış penceresi kabul edildi: iki yönetici aynı anda aynı şoföre sefer
 * açarsa ikisi de geçebilir. Bedeli bir fazladan satır; alternatifi kısmi
 * tekil indeks + ham hata çevirisi. Gerçek kullanımda sefer günde bir kez ve
 * tek kişi tarafından açılıyor (ölçüm: 30 şoför, 20 vardiya/gün).
 */
export async function acikSeferVarMi(
  workerId: string,
  tarih: string
): Promise<SeferRow | null> {
  const { data, error } = await supabaseAdmin
    .from("seferler")
    .select(COLS)
    .eq("worker_id", workerId)
    .eq("tarih", tarih)
    .in("durum", ACIK_DURUMLAR)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as unknown as SeferRow) ?? null;
}

export type SeferOlustur = {
  tarih: string;
  worker_id: string;
  vehicle_id?: string | null;
  zone_id?: string | null;
  paket_hedef?: number | null;
  notlar?: string | null;
  created_by: string;
};

/** Yeni sefer — `durum` daima 'atandi', `atandi_at` DB varsayılanından. */
export async function insertSefer(g: SeferOlustur): Promise<SeferRow> {
  const { data, error } = await supabaseAdmin
    .from("seferler")
    .insert({
      tarih: g.tarih,
      worker_id: g.worker_id,
      vehicle_id: g.vehicle_id ?? null,
      zone_id: g.zone_id ?? null,
      paket_hedef: g.paket_hedef ?? null,
      notlar: g.notlar ?? null,
      created_by: g.created_by,
    })
    .select(COLS)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`sefer_insert:${error?.code ?? "?"}:${error?.message ?? "insert"}`);
  }
  return data as unknown as SeferRow;
}

/** KISMİ güncelleme — `undefined` "dokunma" demek. Durum BURADAN değişmez. */
export type SeferYama = Partial<
  Pick<SeferRow, "tarih" | "worker_id" | "vehicle_id" | "zone_id" | "paket_hedef" | "notlar">
>;

export async function patchSefer(id: string, yama: SeferYama): Promise<SeferRow | null> {
  const alanlar = Object.fromEntries(
    Object.entries(yama).filter(([, v]) => v !== undefined)
  );
  if (Object.keys(alanlar).length === 0) return getSeferById(id);
  const { data, error } = await supabaseAdmin
    .from("seferler")
    .update(alanlar)
    .eq("id", id)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(`sefer_patch:${error.code}:${error.message}`);
  return (data as unknown as SeferRow) ?? null;
}

export type GecisSonuc =
  | { ok: true; satir: SeferRow }
  | { ok: false; kod: "gecersiz_gecis" | "kapali_sefer"; mevcut: SeferDurum; sonraki: SeferDurum | null };

/**
 * İŞ KURALI 2 — DURUM GEÇİŞİ + DAMGA TUTARLILIĞI.
 *
 * Her geçiş YALNIZ kendi damgasını yazar; önceki damgalar korunur, sonrakiler
 * boş kalır. Böylece bir satıra bakan kişi "kabul 07:12'de, yola 07:40'ta
 * çıktı" diyebilir — tek bir `updated_at` bunu asla söyleyemezdi.
 *
 * Geçiş haritada yoksa YAZILMAZ:
 *   · kapanmış sefer (tamamlandi/iptal) → `kapali_sefer`
 *   · sıra atlama ya da geri gitme      → `gecersiz_gecis`
 * İkisi de çağıranda 409'a çevrilir ve MEVCUT durumu + BEKLENEN sonraki adımı
 * gövdede taşır: istemci "şu an kabul, sıradaki yolda" diyebilsin.
 */
export async function ilerletSefer(id: string, hedef: SoforGecis): Promise<GecisSonuc | null> {
  const mevcut = await getSeferById(id);
  if (!mevcut) return null;

  const sonraki = SONRAKI[mevcut.durum];
  if (sonraki === null) {
    return { ok: false, kod: "kapali_sefer", mevcut: mevcut.durum, sonraki };
  }
  if (hedef !== sonraki) {
    return { ok: false, kod: "gecersiz_gecis", mevcut: mevcut.durum, sonraki };
  }

  const { data, error } = await supabaseAdmin
    .from("seferler")
    .update({ durum: hedef, [DAMGA[hedef]]: new Date().toISOString() })
    .eq("id", id)
    // Yarış emniyeti: satır hâlâ beklediğimiz durumdaysa yaz. Araya giren bir
    // güncelleme olduysa 0 satır etkilenir ve `data` null döner.
    .eq("durum", mevcut.durum)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(`sefer_gecis:${error.code}:${error.message}`);
  if (!data) {
    return { ok: false, kod: "gecersiz_gecis", mevcut: mevcut.durum, sonraki };
  }
  return { ok: true, satir: data as unknown as SeferRow };
}

/**
 * İPTAL — yalnız yönetici, yalnız AÇIK sefer.
 *
 * Kapanmış (tamamlandi) ya da zaten iptal edilmiş bir seferi iptal etmek,
 * bitmiş bir işin kaydını geriye dönük değiştirmek olurdu.
 */
export async function iptalSefer(id: string): Promise<GecisSonuc | null> {
  const mevcut = await getSeferById(id);
  if (!mevcut) return null;
  if (!ACIK_DURUMLAR.includes(mevcut.durum)) {
    return { ok: false, kod: "kapali_sefer", mevcut: mevcut.durum, sonraki: null };
  }
  const { data, error } = await supabaseAdmin
    .from("seferler")
    .update({ durum: "iptal", iptal_at: new Date().toISOString() })
    .eq("id", id)
    .eq("durum", mevcut.durum)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(`sefer_iptal:${error.code}:${error.message}`);
  if (!data) return { ok: false, kod: "gecersiz_gecis", mevcut: mevcut.durum, sonraki: null };
  return { ok: true, satir: data as unknown as SeferRow };
}

/** Mobil JSON gövdesi — dört uç da bunu döndürür. */
export function seferGovdesi(s: SeferRow) {
  return {
    id: s.id,
    tarih: s.tarih,
    soforId: s.worker_id,
    aracId: s.vehicle_id,
    bolgeId: s.zone_id,
    paketHedef: s.paket_hedef,
    notlar: s.notlar,
    durum: s.durum,
    /** Sıradaki adım; kapalı seferde null → istemci butonu gizler. */
    sonrakiDurum: SONRAKI[s.durum],
    acik: ACIK_DURUMLAR.includes(s.durum),
    damgalar: {
      atandi: s.atandi_at,
      kabul: s.kabul_at,
      yolda: s.yolda_at,
      tamamlandi: s.tamamlandi_at,
      iptal: s.iptal_at,
    },
    /**
     * OTOMATİK KÖPRÜLER (Tur 3). İkisi de `damgalar` DIŞINDA duruyor: o blok
     * ŞOFÖRÜN bastığı durum çizgisinin damgaları, bunlar sistemin türettiği
     * bilgi. Aynı torbaya koymak "şoför vardı'ya bastı" izlenimi verirdi.
     */
    vardiAt: s.vardi_at,
    paketGerceklesen: s.paket_gerceklesen,
    olusturan: s.created_by,
    olusturuldu: s.created_at,
  };
}
