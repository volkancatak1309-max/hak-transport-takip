import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { tabloYokMu } from "@/lib/fault-reports";
import { isFleetVisible } from "@/lib/tenant";
import { fleetLabeller } from "@/lib/mobile-labels";
import {
  FILO_TAVANI,
  LEGACY_FILO_KODLARI,
  filoKoduUret,
  varsayilanFiloAdi,
} from "@/lib/fleets";

/**
 * FİLO YÖNETİMİ — sorgu katmanı (migration 059).
 *
 * `lib/fleets.ts` saf kurallar (muhafız orayı Node'da çalıştırıyor), burası
 * `server-only` + `supabaseAdmin`. Bölünme keyfî değil: saf tarafa tek bir DB
 * satırı sızsa muhafız betiği çalışamaz olurdu (lib/action-snoozes-db.ts ile
 * aynı düzen).
 *
 * ── ÜYELİĞİN TEK KAYNAĞI DEĞİŞMEDİ ─────────────────────────────────────────
 * Araç → filo:      `vehicles.fleet` (metin kod)
 * Personel → filo:  TÜRETİLİR — `vehicles.fleet` → `vehicles.assigned_worker_id`
 *
 * İkincisi lib/fleet-scope.ts'in 22.07.2026'da yazılı kararıdır: `workers`
 * üzerine ikinci bir filo kolonu koymak, araç filosu değiştiğinde SESSİZCE
 * eskiyen bir kopya üretirdi. Bu modül o kararı DEĞİŞTİRMEZ, üstüne yazmaz;
 * yalnız aynı türetmeyi sayar. Sonucu: "personeli taşımak" = O KİŞİNİN
 * ARACINI taşımak, ve aracı olmayan kişi taşınamaz — bu bir eksiklik değil,
 * modelin doğrudan sonucudur ve yanıtta SÖYLENİR.
 *
 * ── `tabloYokMu` İÇE AKTARILIYOR, KOPYALANMIYOR ────────────────────────────
 * Sınıf genel bir PostgREST hata ayrımıdır (42P01 / PGRST205), arıza
 * bildirimine özgü değil. İkinci bir kopya, 11.08.2026'da orada düzeltilen
 * "çıplak `does not exist` kolon hatasını da yakalıyordu" kusurunu geri getirirdi.
 */

const FILO_KOLONLARI = "code, name, sort_order, created_at";

type HamFilo = {
  code: string;
  name: string | null;
  sort_order: number;
  created_at: string | null;
};

/** Filo TANIMI — sayım YOK (sayım yalnız listeleme ucunun işi). */
export type FiloTanimi = {
  kod: string;
  /** Görünen ad: kiracının verdiği ad, yoksa türetilmiş varsayılan. */
  ad: string;
  /** Ad kiracı tarafından mı verildi? false ise `ad` türetilmiştir. */
  adOzel: boolean;
  sira: number;
  /** Kiracının arayüzünde gösteriliyor mu (ACTIVE_FLEETS, lib/tenant.ts)? */
  gorunur: boolean;
  /** Tablo yokken null — türetilmiş filonun doğum anı diye bir şey yok. */
  olusturma: string | null;
};

export type FiloSatiri = FiloTanimi & {
  aracSayisi: number;
  personelSayisi: number;
};

/** `fleets` okunabildi mi; okunamadıysa liste TÜRETİLDİ mi yoksa sorgu mu düştü. */
type TanimSonucu =
  | { ok: true; satirlar: HamFilo[]; tabloDurumu: "var" | "tablo_yok" }
  | { ok: false };

/**
 * Filo tanımları. Tablo YOKSA (migration 059 çalıştırılmamış) 023/029 CHECK
 * kümesinden TÜRETİLİR — yani okuma ve taşıma uçları bugün de çalışır.
 *
 * Türetilmiş listede `name` daima null'dır: ad verecek yer yoktur, görünen ad
 * i18n/env'den gelir. Sıra 1=bordo, 2=mavi — migration'ın tohumladığı sırayla
 * BİREBİR aynı, böylece 059 çalıştığında liste yeniden dizilmez.
 */
async function filoTanimlari(): Promise<TanimSonucu> {
  const { data, error } = await supabaseAdmin
    .from("fleets")
    .select(FILO_KOLONLARI)
    .order("sort_order", { ascending: true });

  if (error) {
    if (!tabloYokMu(error)) return { ok: false };
    return {
      ok: true,
      tabloDurumu: "tablo_yok",
      satirlar: LEGACY_FILO_KODLARI.map((kod, i) => ({
        code: kod,
        name: null,
        sort_order: i + 1,
        created_at: null,
      })),
    };
  }
  return {
    ok: true,
    tabloDurumu: "var",
    satirlar: (data ?? []) as unknown as HamFilo[],
  };
}

/**
 * Ham satırı dışarıya çevir. Ad çözümü tek yerde:
 *   1. `fleets.name` dolu       → kiracının verdiği ad
 *   2. ESKİ kod (bordo/mavi)    → bugünkü etiket kaynağı (env ezmesi → i18n)
 *   3. geri kalan               → "N. Filo"
 *
 * (2) ve (3) neden ayrı: `filo3` için i18n sözlüğünde karşılık YOKTUR ve
 * next-intl eksik anahtarda anahtarın kendisini döndürüp gürültü üretir —
 * "vehicles.fleet.filo3" adında bir filo görünürdü. Etiket kaynağına yalnız
 * karşılığı OLDUĞU BİLİNEN iki kod sorulur.
 */
function disari(r: HamFilo, etiket: ((kod: string) => string) | null): FiloTanimi {
  const ozel = (r.name ?? "").trim();
  const eski = (LEGACY_FILO_KODLARI as readonly string[]).includes(r.code);
  return {
    kod: r.code,
    ad: ozel || (eski && etiket ? etiket(r.code) : varsayilanFiloAdi(r.sort_order)),
    adOzel: ozel.length > 0,
    sira: r.sort_order,
    gorunur: isFleetVisible(r.code),
    olusturma: r.created_at,
  };
}

/** Etiket çözücüyü YALNIZ gerektiğinde kur (i18n sözlüğü boşuna yüklenmesin). */
async function etiketciGerekirse(
  satirlar: HamFilo[]
): Promise<((kod: string) => string) | null> {
  const gerek = satirlar.some(
    (r) =>
      !(r.name ?? "").trim() &&
      (LEGACY_FILO_KODLARI as readonly string[]).includes(r.code)
  );
  return gerek ? await fleetLabeller() : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// LİSTELEME
// ─────────────────────────────────────────────────────────────────────────────

export type FiloListesi = {
  filolar: FiloSatiri[];
  /** `var` tablo okundu · `tablo_yok` 059 çalışmamış, liste TÜRETİLDİ. */
  tabloDurumu: "var" | "tablo_yok";
  /**
   * Hiçbir filoya girmeyen aktif personel. Filo üyeliği araçtan türetildiği
   * için ARACI OLMAYAN kişinin filosu yoktur (lib/fleet-scope.ts'te yazılı
   * bilinçli boşluk). Sayı taşınmazsa filo sayılarının toplamı kadroyu
   * TUTMAZ ve fark sessizce kaybolur.
   */
  filosuzPersonel: number;
  /**
   * `vehicles.fleet` içinde olup tanımlı filolarda OLMAYAN kodlar. Bugün boş
   * olmalı (CHECK/FK izin vermez); doluysa veri ile tanım ayrışmış demektir ve
   * bu SÖYLENİR — araçlar hiçbir filonun sayısında görünmüyor olurdu.
   */
  bilinmeyenFilolar: { kod: string; aracSayisi: number }[];
  /**
   * Sayım PostgREST'in 1000 satır tavanına takıldı mı? Takıldıysa sayılar
   * EKSİKTİR ve bu gizlenmez (25.07.2026'da `.limit(40000)`in sessizce 1000'e
   * kırpıldığı ölçümüyle aynı ders).
   */
  sayimKirpildi: boolean;
};

export type FiloListeSonucu =
  | { ok: true; liste: FiloListesi }
  | { ok: false; sebep: "hata" };

/**
 * Filolar + her birinde araç ve personel sayısı.
 *
 * ── SAYIM KURALI ───────────────────────────────────────────────────────────
 * araç      : o filodaki TEST OLMAYAN araçlar (panelin araç listesiyle aynı eleme)
 * personel  : o filonun test olmayan araçlarına ATANMIŞ, AKTİF ve test olmayan
 *             kişiler — tekilleştirilmiş (bir kişide iki araç varsa bir kez sayılır)
 *
 * Yönetici hesapları BİLEREK elenmiyor (`lib/driver-scope.ts` uygulanmıyor):
 * o kapsam "kim ŞOFÖR sayılır" sorusunun cevabıdır ve şoför metriklerine aittir.
 * Burada soru "bu filoda kim ÇALIŞIYOR" — aracı olan yönetici (Sendigo'daki
 * counts_as_driver durumu) o filonun personelidir. HAK61'de fark sıfır: üç
 * yöneticinin hiçbirine araç atanmamış (ölçüldü 11.08.2026).
 */
export async function listFleets(): Promise<FiloListeSonucu> {
  const tanim = await filoTanimlari();
  if (!tanim.ok) return { ok: false, sebep: "hata" };

  const scope = await getTestScope();

  // test-filtered: withoutTestRows — panelin araç listesiyle (app/actions/vehicles.ts
  // listVehicles) AYNI eleme. Test aracı bir filonun sayısını şişirmemeli.
  const { data: vData, error: vErr, count: vCount } = await withoutTestRows(
    supabaseAdmin
      .from("vehicles")
      .select("id, fleet, assigned_worker_id", { count: "exact" }),
    "id",
    scope.vehicleIds
  );
  // Sessiz eksik YASAK: bu sorgu düşerse tüm filolar "0 araç" görünürdü.
  if (vErr) return { ok: false, sebep: "hata" };

  // test-filtered: withoutTestRows — test şoförü hiçbir filonun personelinde
  // sayılmaz (mobil personel listesiyle aynı eleme).
  const { data: wData, error: wErr, count: wCount } = await withoutTestRows(
    supabaseAdmin.from("workers").select("id", { count: "exact" }).eq("is_active", true),
    "id",
    scope.workerIds
  );
  if (wErr) return { ok: false, sebep: "hata" };

  const araclar = (vData ?? []) as { id: string; fleet: string; assigned_worker_id: string | null }[];
  const aktifPersonel = new Set(((wData ?? []) as { id: string }[]).map((w) => w.id));

  const etiket = await etiketciGerekirse(tanim.satirlar);
  const tanimliKodlar = new Set(tanim.satirlar.map((r) => r.code));

  const aracSayisi = new Map<string, number>();
  const personelKumeleri = new Map<string, Set<string>>();
  const filoluPersonel = new Set<string>();

  for (const v of araclar) {
    aracSayisi.set(v.fleet, (aracSayisi.get(v.fleet) ?? 0) + 1);
    const w = v.assigned_worker_id;
    if (!w || !aktifPersonel.has(w)) continue;
    if (!personelKumeleri.has(v.fleet)) personelKumeleri.set(v.fleet, new Set());
    personelKumeleri.get(v.fleet)!.add(w);
    filoluPersonel.add(w);
  }

  const filolar: FiloSatiri[] = tanim.satirlar.map((r) => ({
    ...disari(r, etiket),
    aracSayisi: aracSayisi.get(r.code) ?? 0,
    personelSayisi: personelKumeleri.get(r.code)?.size ?? 0,
  }));

  const bilinmeyenFilolar = [...aracSayisi.entries()]
    .filter(([kod]) => !tanimliKodlar.has(kod))
    .map(([kod, aracSayisi]) => ({ kod, aracSayisi }))
    .sort((a, b) => a.kod.localeCompare(b.kod));

  return {
    ok: true,
    liste: {
      filolar,
      tabloDurumu: tanim.tabloDurumu,
      filosuzPersonel: [...aktifPersonel].filter((id) => !filoluPersonel.has(id)).length,
      bilinmeyenFilolar,
      sayimKirpildi:
        (vCount != null && araclar.length < vCount) ||
        (wCount != null && aktifPersonel.size < wCount),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// YENİ FİLO
// ─────────────────────────────────────────────────────────────────────────────

/** PostgreSQL `unique_violation` — sıra/kod yarışında dönen kod. */
const UNIQUE_VIOLATION = "23505";

export type FiloAcma =
  | { ok: true; filo: FiloTanimi }
  | {
      ok: false;
      sebep: "tablo_yok" | "tavan" | "cakisma" | "hata";
      /** `tavan` sebebinde bugünkü filo sayısı. */
      mevcut?: number;
    };

/**
 * Yeni filo aç. Kod SUNUCU ÜRETİR, sıra EN KÜÇÜK BOŞ YUVA olur.
 *
 * ── NEDEN EN KÜÇÜK BOŞ YUVA ────────────────────────────────────────────────
 * "En büyük + 1" deseydik, ileride bir filo silindiğinde (bu turda silme YOK)
 * yuva kalıcı olarak ölürdü ve tavan fiilen 5'in altına düşerdi. En küçük boş
 * yuva ayrıca kararlıdır: aynı durumda aynı isteği iki kez göndermek aynı
 * sırayı hedefler.
 *
 * ── AD YAZILMIYOR, TÜRETİLİYOR ─────────────────────────────────────────────
 * `ad` null geçilirse `fleets.name` NULL kalır ve görünen ad "N. Filo" olur.
 * "3. Filo" metnini tabloya YAZMAK, filonun sırası değişirse eskiyecek bir
 * kopya bırakırdı; varsayılan her okumada yeniden türetilir.
 *
 * ── TAVAN ──────────────────────────────────────────────────────────────────
 * Asıl uygulayıcı ŞEMA (059: sort_order 1..5 + unique). Buradaki erken denetim
 * yalnız DÜZGÜN CEVAP içindir. Yarışta kaybeden istek 23505 alır ve `cakisma`
 * döner — ham veritabanı hatası olarak sızmaz.
 */
export async function createFleet(ad: string | null): Promise<FiloAcma> {
  const { data, error } = await supabaseAdmin
    .from("fleets")
    .select(FILO_KOLONLARI)
    .order("sort_order", { ascending: true });
  if (error) return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata" };

  const rows = (data ?? []) as unknown as HamFilo[];
  const dolu = new Set(rows.map((r) => r.sort_order));
  let sira = 0;
  for (let i = 1; i <= FILO_TAVANI; i++) {
    if (!dolu.has(i)) {
      sira = i;
      break;
    }
  }
  if (sira === 0) return { ok: false, sebep: "tavan", mevcut: rows.length };

  const kod = filoKoduUret(sira);
  // Yuva boş ama kod dolu: yalnız yuva/kod eşlemesi elle bozulduysa olur.
  // Sessizce başka bir kod uydurmak, kodun sıradan türediği sözünü bozardı.
  if (rows.some((r) => r.code === kod)) return { ok: false, sebep: "cakisma" };

  const { data: yeni, error: e2 } = await supabaseAdmin
    .from("fleets")
    .insert({ code: kod, name: ad, sort_order: sira })
    .select(FILO_KOLONLARI)
    .maybeSingle();

  if (e2) {
    if ((e2.code ?? "") === UNIQUE_VIOLATION) return { ok: false, sebep: "cakisma" };
    return { ok: false, sebep: tabloYokMu(e2) ? "tablo_yok" : "hata" };
  }
  if (!yeni) return { ok: false, sebep: "hata" };

  const satir = yeni as unknown as HamFilo;
  return { ok: true, filo: disari(satir, await etiketciGerekirse([satir])) };
}

// ─────────────────────────────────────────────────────────────────────────────
// YENİDEN ADLANDIRMA
// ─────────────────────────────────────────────────────────────────────────────

export type FiloAdlandirma =
  | { ok: true; filo: FiloTanimi; degisti: boolean }
  | { ok: false; sebep: "tablo_yok" | "yok" | "hata" };

/**
 * Filoyu yeniden adlandır. `ad === null` → VARSAYILANA DÖN (`fleets.name = null`).
 *
 * ── AYNI AD İKİNCİ KEZ YAZILMAZ ────────────────────────────────────────────
 * İstek 200 döner ve `degisti:false` der; DB'ye hiç dokunulmaz. Aynı gerekçe
 * ertelemeyi geri almada da yazılı: iki telefonun aynı düğmeye basması
 * olağandır ve gereksiz yazma iz/önbellek gürültüsü üretir.
 *
 * ── KOD DEĞİŞMEZ ───────────────────────────────────────────────────────────
 * Yeniden adlandırma `code`a DOKUNMAZ. Kod 30 araç satırında yazılı; onu
 * değiştirmek adı değiştirmenin yan etkisi olamaz.
 */
export async function renameFleet(
  kod: string,
  ad: string | null
): Promise<FiloAdlandirma> {
  const { data: onceki, error } = await supabaseAdmin
    .from("fleets")
    .select(FILO_KOLONLARI)
    .eq("code", kod)
    .maybeSingle();
  if (error) return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata" };
  if (!onceki) return { ok: false, sebep: "yok" };

  const oncekiSatir = onceki as unknown as HamFilo;
  if ((oncekiSatir.name ?? null) === ad) {
    return {
      ok: true,
      filo: disari(oncekiSatir, await etiketciGerekirse([oncekiSatir])),
      degisti: false,
    };
  }

  const { data, error: e2 } = await supabaseAdmin
    .from("fleets")
    .update({ name: ad })
    .eq("code", kod)
    .select(FILO_KOLONLARI)
    .maybeSingle();
  if (e2) return { ok: false, sebep: tabloYokMu(e2) ? "tablo_yok" : "hata" };
  if (!data) return { ok: false, sebep: "yok" };

  const satir = data as unknown as HamFilo;
  return {
    ok: true,
    filo: disari(satir, await etiketciGerekirse([satir])),
    degisti: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TAŞIMA (araç + personel, tek uçta)
// ─────────────────────────────────────────────────────────────────────────────

/** PostgreSQL: CHECK ihlali (059 öncesi bilinmeyen filo) / FK ihlali (059 sonrası). */
const CHECK_VIOLATION = "23514";
const FK_VIOLATION = "23503";

export type TasinanArac = {
  id: string;
  plaka: string;
  /** Taşınmadan önce hangi filodaydı — "3 araç bordo'dan geldi" cümlesi için. */
  oncekiFilo: string;
};

export type PersonelSonucu = {
  id: string;
  tasindi: boolean;
  /** Bu kişi üzerinden taşınan araçlar (kişinin kendi kaydı taşınmaz). */
  araclar: string[];
  /** `yok` böyle bir personel yok · `arac_yok` atanmış aracı yok · `zaten_orada`. */
  sebep?: "yok" | "arac_yok" | "zaten_orada";
};

export type TasimaSonucu =
  | {
      ok: true;
      filo: FiloTanimi;
      arac: {
        istenen: number;
        tasindi: TasinanArac[];
        zatenOrada: string[];
        bulunamadi: string[];
      };
      personel: PersonelSonucu[];
    }
  | { ok: false; sebep: "filo_yok" | "gecersiz_filo" | "hata" };

/**
 * Araçları ve/veya personeli hedef filoya taşı — TEK istek, TEK güncelleme.
 *
 * ── PERSONEL TAŞIMA NE DEMEK ───────────────────────────────────────────────
 * Personelin filosu ayrı bir kolonda TUTULMUYOR, aracından türetiliyor (dosya
 * başındaki not). Dolayısıyla "Ahmet'i 3. Filo'ya taşı" = "Ahmet'e ATANMIŞ
 * aracı 3. Filo'ya taşı". Bu bir yorum değil, modelin tek olası okuması:
 * başka türlüsü ya yeni bir kolon (fleet-scope.ts'in reddettiği eskiyen kopya)
 * ya da hiçbir şey yapmayan bir uç olurdu.
 *
 * ARACI OLMAYAN KİŞİ TAŞINAMAZ ve bu SESSİZ GEÇİLMEZ: yanıtta o kişi
 * `tasindi:false, sebep:"arac_yok"` ile döner. HAK61'de bugün 5 aktif kişi bu
 * durumda (3'ü yönetici) — yani gerçek ve ölçülmüş bir durum.
 *
 * BUGÜN ÖDÜNÇ KULLANILAN ARAÇ TAŞINMAZ: yalnız `assigned_worker_id` bağı
 * dikkate alınır. Vardiyada geçici olarak kullanılan yabancı araç o kişinin
 * malı değildir; onu taşımak karşı filonun aracını çalmak olurdu.
 *
 * ── AYNI ARAÇ İKİ YOLDAN GELİRSE ───────────────────────────────────────────
 * `aracIdleri` ile gelen araç aynı zamanda `personelIdleri`ndeki birinin aracı
 * olabilir. Kümeler BİRLEŞTİRİLİR, güncelleme TEK sorgudur; araç iki kez
 * sayılmaz.
 *
 * ── ZATEN HEDEFTE OLAN ARAÇ ────────────────────────────────────────────────
 * `.neq("fleet", kod)` ile güncellemenin DIŞINDA bırakılır: dönen satır sayısı
 * "gerçekten ne değişti"nin ta kendisi olsun. Yanıtta ayrıca `zatenOrada`
 * listesinde görünür — "taşındı" denip hiçbir şey olmaması yerine.
 */
export async function moveToFleet(
  kod: string,
  aracIdleri: string[],
  personelIdleri: string[]
): Promise<TasimaSonucu> {
  const tanim = await filoTanimlari();
  if (!tanim.ok) return { ok: false, sebep: "hata" };
  const hedef = tanim.satirlar.find((r) => r.code === kod);
  if (!hedef) return { ok: false, sebep: "filo_yok" };

  // ── İstenen araçlar (anahtarlı okuma: .in("id", ...)) ────────────────────
  const aracBilgi = new Map<string, { plaka: string; filo: string }>();
  if (aracIdleri.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("vehicles")
      .select("id, plate, fleet")
      .in("id", aracIdleri);
    if (error) return { ok: false, sebep: "hata" };
    for (const v of (data ?? []) as { id: string; plate: string; fleet: string }[]) {
      aracBilgi.set(v.id, { plaka: v.plate, filo: v.fleet });
    }
  }

  // ── İstenen personel: önce VAR MI ────────────────────────────────────────
  // "Aracı yok" ile "böyle biri yok" aynı cevabı almamalı: ilki bir veri
  // durumu, ikincisi istemcinin hatası.
  const varOlanPersonel = new Set<string>();
  const personelAraclari = new Map<string, string[]>();
  if (personelIdleri.length > 0) {
    const { data: wRows, error: wErr } = await supabaseAdmin
      .from("workers")
      .select("id")
      .in("id", personelIdleri);
    if (wErr) return { ok: false, sebep: "hata" };
    for (const w of (wRows ?? []) as { id: string }[]) varOlanPersonel.add(w.id);

    // test-visible: ANAHTARLI okuma — kimlikler isteğin GÖVDESİNDEN geliyor,
    // liste taraması değil. Test elemesi buraya KONMAZ: yönetici test şoförünü
    // bilerek taşımak isterse çalışmalı (lib/test-data.ts'in "yazma yollarına
    // filtre konmaz" kuralı). Test kaydını GÖSTERMEYEN yer listeleme ucudur.
    const { data: vRows, error: vErr } = await supabaseAdmin
      .from("vehicles")
      .select("id, plate, fleet, assigned_worker_id")
      .in("assigned_worker_id", personelIdleri);
    if (vErr) return { ok: false, sebep: "hata" };
    for (const v of (vRows ?? []) as {
      id: string;
      plate: string;
      fleet: string;
      assigned_worker_id: string;
    }[]) {
      aracBilgi.set(v.id, { plaka: v.plate, filo: v.fleet });
      const liste = personelAraclari.get(v.assigned_worker_id) ?? [];
      liste.push(v.id);
      personelAraclari.set(v.assigned_worker_id, liste);
    }
  }

  const bulunamadi = aracIdleri.filter((id) => !aracBilgi.has(id));
  const hepsi = [...aracBilgi.keys()];
  const zatenOrada = hepsi.filter((id) => aracBilgi.get(id)!.filo === kod);
  const tasinacak = hepsi.filter((id) => aracBilgi.get(id)!.filo !== kod);

  let tasinanIdler: string[] = [];
  if (tasinacak.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("vehicles")
      .update({ fleet: kod })
      .in("id", tasinacak)
      // Yarışta araya giren bir güncelleme aracı zaten hedefe koymuşsa satır
      // dönmesin: "değişti" sayısı gerçekten değişeni saysın.
      .neq("fleet", kod)
      .select("id");
    if (error) {
      const c = error.code ?? "";
      // 059 öncesi tanınmayan filo (CHECK) ya da 059 sonrası olmayan filo (FK).
      if (c === CHECK_VIOLATION || c === FK_VIOLATION) {
        return { ok: false, sebep: "gecersiz_filo" };
      }
      return { ok: false, sebep: "hata" };
    }
    tasinanIdler = ((data ?? []) as { id: string }[]).map((v) => v.id);
  }

  const tasinanKume = new Set(tasinanIdler);
  const personel: PersonelSonucu[] = personelIdleri.map((id) => {
    if (!varOlanPersonel.has(id)) {
      return { id, tasindi: false, araclar: [], sebep: "yok" };
    }
    const araclar = personelAraclari.get(id) ?? [];
    if (araclar.length === 0) {
      return { id, tasindi: false, araclar: [], sebep: "arac_yok" };
    }
    const tasinan = araclar.filter((a) => tasinanKume.has(a));
    if (tasinan.length === 0) {
      return { id, tasindi: false, araclar, sebep: "zaten_orada" };
    }
    return { id, tasindi: true, araclar: tasinan };
  });

  return {
    ok: true,
    filo: disari(hedef, await etiketciGerekirse([hedef])),
    arac: {
      istenen: aracIdleri.length,
      tasindi: tasinanIdler.map((id) => ({
        id,
        plaka: aracBilgi.get(id)!.plaka,
        oncekiFilo: aracBilgi.get(id)!.filo,
      })),
      zatenOrada,
      bulunamadi,
    },
    personel,
  };
}
