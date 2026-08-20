import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope } from "@/lib/test-data";

/**
 * ŞOFÖR KAPSAMI — "kaç şoförümüz var" sorusunun TEK cevabı (28.07.2026).
 *
 * SORUN: Analiz sayfası "ŞOFÖR 33" gösteriyordu. `workers` tablosu TÜM personeli
 * tutuyor: 34 kaydın 3'ü yönetici (Volkan/Gökhan/Hüseyin Hoca), 1'i test hesabı.
 * Gerçek şoför 30. Yöneticiler yalnız sayacı şişirmiyordu — biri kendi
 * hesabından iki demo vardiya açmıştı ve o vardiyalar 20.100 km taşıyordu
 * (2 dakikada 20.000 km); bu km filo toplamlarına gerçek gibi giriyordu.
 *
 * ── Neden burada, tek yerde ────────────────────────────────────────────────
 * Sorgulara tek tek `.eq("is_admin", false)` serpiştirmek işe yarar — nitekim
 * Günün Panosu (lib/admin-dashboard.ts) ve İzin Takvimi (app/admin/izinler)
 * tam olarak bunu yapıyordu, Analiz ve Harita ise unutmuştu. İki yer doğru,
 * iki yer yanlış: sorunun kendisi bu. lib/test-data.ts'in kalıbı:
 *   1. Şoför olmayanların kimlikleri istek başına BİR KEZ okunur.
 *   2. Her çağrı noktası aynı iki yardımcıdan birini kullanır — greplenebilir.
 *   3. scripts/check-test-filters.mjs, ŞOFÖR YÜZEYLERİNDE bu yardımcıları
 *      çağırmayan her yeni sorguda `npm run verify`'ı kırar. Asıl koruma odur.
 * ELLE İSİM LİSTESİ YASAK: burada da, çağrı noktalarında da hiçbir kişi adı
 * geçmez — küme `is_admin` bayrağından türetilir.
 *
 * ── Neden yeni kolon YOK ───────────────────────────────────────────────────
 * `role` kolonu önerildi ve REDDEDİLDİ (Volkan, 28.07.2026): bugün is_admin
 * ile şoför-olmayan kümesi birebir örtüşüyor, ikinci bir kolon aynı gerçeği
 * iki yerde saklamak olurdu ve ikisi kaçınılmaz olarak birbirinden ayrışırdı.
 * Ayrım gerçekten gerektiği gün (araç sürmeyen ama yönetici de olmayan bir
 * büro/depo personeli) burası tek dokunulacak yerdir: aşağıdaki sorguya bir
 * koşul eklenir, 20 çağrı noktasının hiçbiri değişmez. Soyutlamanın amacı bu.
 *
 * ── ARAÇ KULLANAN YÖNETİCİ — counts_as_driver (04.08.2026) ─────────────────
 * O gün geldi, ama BEKLENEN yönde değil: eksik olan "yönetici olmayan büro
 * personeli" değil, DİREKSİYONA GEÇEN YÖNETİCİ oldu. Küçük bir kurulumda patron
 * ilk (bazen tek) şoförün kendisi; hesabından açtığı gerçek vardiyalar hiçbir
 * yüzeyde görünmüyor, pano "bugün kimse çalışmadı" diyor.
 *
 * Yukarıdaki paragrafta tarif edilen şey aynen yapıldı: sorguya TEK bir koşul
 * eklendi (migration 041), 20 çağrı noktasının hiçbiri değişmedi.
 *
 * `role` kararıyla çelişmiyor: counts_as_driver bir ROL DEĞİL, tek bir kayda
 * verilen MUAFİYET işaretidir. is_admin'i ikame etmez — o kayıt hâlâ tam
 * yetkili yöneticidir; yalnız ŞOFÖR METRİKLERİNDEN düşürülmez.
 *
 * "Tüm yöneticileri say" gibi bir gevşetme YOK ve olmamalı: varsayılan false,
 * istisna yalnız işaretlenen kayıtta. Bayrak açılmadıkça hiçbir sayı oynamaz.
 *
 * ── Neden is_active/terminated_at BURAYA girmiyor ──────────────────────────
 * İşten ayrılan şoför HÂLÂ ŞOFÖRDÜR: geçmiş AZG/vardiya/yakıt raporlarında ve
 * aylık alarm arşivinde adı görünmeye devam eder (§ 132 BAO, 7 yıl — bkz.
 * migration 032). Yönetici ise HİÇ şoför olmamıştır; onun geçmişte de işi yok.
 * Bu yüzden bu kapsam is_active'ten BAĞIMSIZDIR ve is_active'in bilerek
 * uygulanmadığı GEÇMİŞ yüzeylerde de uygulanır. Canlı/ayrıldı ayrımını isteyen
 * yüzey (roster, seçiciler) is_active kontrolünü AYRICA yapar — nitekim
 * buildTodayRoster öyle yapıyor.
 *
 * ── FİLO ŞEFİ ──────────────────────────────────────────────────────────────
 * managed_fleet dolu olan çalışan ŞEFTİR (migration 029) ve is_admin=false'tur,
 * yani bu kapsamda ŞOFÖR KALIR — kalmalıdır da: canlıda iki şef var ve ikisi de
 * filonun en çok vardiya açan şoförleri arasında. managed_fleet burada ölçüt
 * DEĞİLDİR ve asla olmamalıdır.
 *
 * ── Nereye filtre KONMAZ ───────────────────────────────────────────────────
 * Çalışanlar sayfası, personel dosyası, giriş/auth, PIN yönetimi, yetki
 * kontrolleri, bildirim alıcı listeleri ve izin ONAY akışı TÜM personeli
 * görmeye devam eder. Yönetici oralarda GİZLENMEZ — yalnız ŞOFÖR
 * METRİKLERİNDEN düşer. Kural: "yönetici personeldir, şoför değildir."
 */

export type DriverScope = {
  /**
   * Şoför SAYILMAYAN çalışanların id'leri: yöneticiler (is_admin) ∪ test
   * hesapları (is_test). İkisi tek kümede birleşti çünkü şoför yüzeylerinde
   * ikisi de aynı anda ve aynı gerekçeyle elenir; ayrı tutmak her çağrı
   * noktasında iki sarmalayıcı yazmayı gerektirirdi.
   */
  excludedIds: string[];
  /**
   * Bu kimlik şoför metriklerine girer mi?
   *
   * null/undefined → TRUE. Soru "bu kişi şoför mü" değil, "bu satır ŞOFÖR
   * OLMAYAN BİRİNE ait olduğu için elenmeli mi"dir; sahipsiz bir satır
   * yöneticiye ait olamaz, dolayısıyla bu filtre onu ELEMEZ (başka bir kural
   * eleyecekse kendi yerinde eler). lib/test-data.ts'teki isTestWorker de aynı
   * yönde davranır: null → "test değil" → satır kalır. Boş kapsamda true,
   * dolu kapsamda false dönseydi migration/veri durumuna göre satır sessizce
   * kaybolurdu.
   */
  isDriver: (id: string | null | undefined) => boolean;
  /** Elenecek en az bir kayıt var mı. */
  active: boolean;
};

const EMPTY: DriverScope = {
  excludedIds: [],
  isDriver: () => true,
  active: false,
};

/**
 * Şoför olmayanların kimlikleri. React `cache()` ile istek başına tek sorgu:
 * bir sayfa on ayrı yerde çağırsa da Supabase'e bir kez gidilir (getTestScope
 * de aynı şekilde cache'li, dolayısıyla test tarafı ek sorgu doğurmaz).
 *
 * Sorgu hata verirse boş kümeye düşer — panel bugünkü hâliyle çalışır, yalnız
 * yöneticiler elenmemiş olur (lib/test-data.ts ile aynı fail-safe gerekçe:
 * tek bir sorgu hatası yönetici panelini boşaltmamalı).
 */
export const getDriverScope = cache(async (): Promise<DriverScope> => {
  const testScope = await getTestScope();

  // test-visible: elemenin KENDİSİ — şoför sayılmayanları bulan sorgu bu.
  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("id")
    .eq("is_admin", true)
    // MUAFİYET (migration 041): işaretli yönetici direksiyona geçiyor → ŞOFÖR
    // SAYILIR, elenmez. Kolon `not null default false` olduğu için bu koşul
    // işaretsiz her yöneticiyi bugünkü gibi yakalamaya devam eder.
    .eq("counts_as_driver", false);

  if (error) return EMPTY;

  const adminIds = ((data ?? []) as { id: string }[]).map((w) => w.id);
  const excludedIds = [...new Set([...adminIds, ...testScope.workerIds])];
  if (excludedIds.length === 0) return EMPTY;

  const set = new Set(excludedIds);
  return {
    excludedIds,
    isDriver: (id) => (id ? !set.has(id) : true),
    active: true,
  };
});

/**
 * `.not(col, "in", ...)` uygulayabilen her PostgREST builder'ı. Özyineli kısıt
 * VERİLMEZ — bkz. lib/test-data.ts'teki aynı not (TypeScript "excessively
 * deep" ile derlemeyi kırıyor).
 */
type Excludable = {
  not(column: string, operator: string, value: unknown): unknown;
};

/**
 * SORGU DÜZEYİNDE eleme: satırlar hiç taşınmaz. Büyük tablolarda (time_entries)
 * tercih edilen yol. Kapsam boşsa sorguya DOKUNMAZ.
 *
 *   onlyDrivers(vardiyaSorgusu, "worker_id", driverScope)
 */
export function onlyDrivers<Q>(query: Q, column: string, scope: DriverScope): Q {
  if (scope.excludedIds.length === 0) return query;
  return (query as Excludable).not(
    column,
    "in",
    `(${scope.excludedIds.join(",")})`
  ) as Q;
}

/**
 * SATIR DÜZEYİNDE eleme: sorgu zaten çekilmişse ya da eleme türetilmiş bir
 * alana bakıyorsa (araç → atanmış şoför).
 *
 *   dropNonDrivers(rows, (r) => r.worker_id, scope)
 */
export function dropNonDrivers<Row>(
  rows: Row[],
  pickWorkerId: (row: Row) => string | null | undefined,
  scope: DriverScope
): Row[] {
  if (!scope.active) return rows;
  return rows.filter((row) => scope.isDriver(pickWorkerId(row)));
}
