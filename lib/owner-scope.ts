import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";
import { SECURITY_LAYER_ENABLED } from "@/lib/tenant";

/**
 * PATRONUN GÖRÜNMEZLİĞİ (migration 045) — is_owner olmayan yöneticilerden gizle.
 *
 * ── NE ÇÖZÜYOR ─────────────────────────────────────────────────────────────
 * Güvenlik ekranını yalnız patron açabiliyor (requireOwner), ama patronun
 * KENDİSİ panelin personel listelerinde sıradan bir kayıt olarak duruyordu:
 * Çalışanlar sayfası, mobil /workers ucu, Telegram alıcıları. Yani izlenen
 * kişi, izleyeni listede görebiliyordu.
 *
 * ── ÜÇÜNCÜ EKSEN ───────────────────────────────────────────────────────────
 * Depoda iki kapsam ekseni vardı: test (lib/test-data.ts) ve şoför
 * (lib/driver-scope.ts). Bu üçüncüsü ve ikisinden ÖNEMLİ BİR FARKI var:
 *
 *   test/şoför ekseni  → HERKESE aynı şeyi gizler (izleyen kim olursa olsun)
 *   patron ekseni      → İZLEYENE GÖRE değişir
 *
 * Patron kendi ekranında kendini GÖRÜR — yönetim için gerekli (kendi PIN'ini
 * değiştirmek, kendi iznini görmek). Gizlenme yalnız is_owner OLMAYANLARA
 * karşıdır. Bu yüzden kapsam `viewerId` alır; test/şoför kapsamları almaz.
 *
 * ── NEREYE UYGULANIR: KİMLİK YÜZEYLERİ ─────────────────────────────────────
 * "Bu kişi bir kullanıcıdır" diyen listeler: Çalışanlar, personel dosyası,
 * şoför/atama seçicileri, izin listeleri, Telegram alıcıları, mobil /workers.
 *
 * ── NEREYE UYGULANMAZ: İŞLETME VE HUKUK KAYITLARI ──────────────────────────
 * Vardiya geçmişi, AZG, CO₂, yakıt, performans, mesafe raporları ve harita
 * izleri. Gerekçe ölçümle verildi (08.08.2026, canlı HAK61): patron
 * `is_admin=true, counts_as_driver=false`, yani lib/driver-scope.ts onu bu
 * yüzeylerin HEPSİNDEN ZATEN eliyor — gizlenecek bir satır yok.
 *
 * Yarın `counts_as_driver=true` yapılırsa (patron direksiyona geçerse) o
 * satırlar görünür olur ve BURAYA filtre eklemek CAZİP gelecek. EKLENMEMELİ:
 * AZG raporu Avusturya çalışma süresi kaydıdır, PDF şirket antetiyle ve
 * UID-Nr ile çıkar (lib/report-de.ts). Direksiyona geçmiş bir sürücüyü o
 * rapordan sessizce düşürmek, raporu YANLIŞ yapar — görünmezlik uğruna
 * yapılacak şey değil. Kişiyi gizlemek isteyen, onu şoför kadrosuna
 * sokmamalıdır; kadrodaysa kaydı da eksiksiz olmalıdır.
 *
 * ── KATMAN KAPALIYKEN SIFIR SORGU ──────────────────────────────────────────
 * `SECURITY_LAYER_ENABLED` kapalıyken ilk satırda boş kapsama döner: HAK61 ve
 * Sendigo'da tek sorgu bile atılmaz ve hiçbir liste değişmez.
 */

export type OwnerScope = {
  /** Bu izleyiciden gizlenecek kayıtların id'leri. */
  hiddenIds: string[];
  /** Bu kimlik bu izleyiciye görünür mü? null/undefined → görünür. */
  isVisible: (id: string | null | undefined) => boolean;
  /** Gizlenecek en az bir kayıt var mı. */
  active: boolean;
  /** İzleyicinin kendisi patron mu (o zaman hiçbir şey gizlenmez). */
  viewerIsOwner: boolean;
};

const EMPTY: OwnerScope = {
  hiddenIds: [],
  isVisible: () => true,
  active: false,
  viewerIsOwner: false,
};

const OWNER_VIEW: OwnerScope = { ...EMPTY, viewerIsOwner: true };

/**
 * Patron id'leri. React `cache()` ile istek başına tek sorgu — bir sayfa birkaç
 * yerde çağırsa da Supabase'e bir kez gidilir (getTestScope / getDriverScope
 * ile aynı kalıp).
 *
 * Sorgu hata verirse (migration 045 yok, kolon yok) BOŞ kapsama düşer: listeler
 * bugünkü hâliyle çalışır, yalnız gizleme olmaz. Tek bir sorgu hatası personel
 * sayfasını boşaltmamalı — lib/test-data.ts'teki fail-safe gerekçenin aynısı.
 * ⚠️ YAZMA yolu bu gevşekliği PAYLAŞMAZ: bkz. assertOwnerWritable.
 */
export const getOwnerScope = cache(
  async (viewerId: string | null | undefined): Promise<OwnerScope> => {
    if (!SECURITY_LAYER_ENABLED) return EMPTY;
    try {
      // owner-visible: gizlemenin KENDİSİ — patronları bulan sorgu bu.
      // test-visible: patron kaydı test hesabı olamaz; eleme burada anlamsız.
      const { data, error } = await supabaseAdmin
        .from("workers")
        .select("id")
        .eq("is_owner", true);
      if (error) return EMPTY;

      const ownerIds = ((data ?? []) as { id: string }[]).map((w) => w.id);
      if (ownerIds.length === 0) return EMPTY;

      // Patron kendini ve diğer patronları görür: yönetim için gerekli.
      if (viewerId && ownerIds.includes(viewerId)) return OWNER_VIEW;

      const set = new Set(ownerIds);
      return {
        hiddenIds: ownerIds,
        isVisible: (id) => (id ? !set.has(id) : true),
        active: true,
        viewerIsOwner: false,
      };
    } catch {
      return EMPTY;
    }
  }
);

/**
 * BU KİŞİ PATRON MU — bayraktan BAĞIMSIZ, anahtarlı tek okuma.
 *
 * ⚠️ Bilerek `SECURITY_LAYER_ENABLED` denetlemez. Erişim kapıları (046) ayrı
 * bir bayrağa bağlı ve muafiyet ölçütleri is_owner; burada güvenlik katmanının
 * bayrağına baksaydık, kapılar açık ama güvenlik katmanı kapalı bir kurulumda
 * patron "patron değil" sayılır ve KENDİ SİSTEMİNDEN KİLİTLENİRDİ. Çağıran
 * kendi bayrağını denetler; bu fonksiyon yalnız gerçeği söyler.
 *
 * Kolon yoksa (045 çalışmamış) ya da hata varsa `false`.
 */
export async function isOwnerWorker(
  workerId: string | null | undefined
): Promise<boolean> {
  if (!workerId) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from("workers")
      .select("is_owner")
      .eq("id", workerId)
      .maybeSingle();
    if (error || !data) return false;
    return data.is_owner === true;
  } catch {
    return false;
  }
}

/**
 * `.not(col, "in", ...)` uygulayabilen her PostgREST builder'ı. Özyineli kısıt
 * VERİLMEZ — bkz. lib/test-data.ts'teki aynı not (TypeScript "excessively
 * deep" ile derlemeyi kırıyor).
 */
type Excludable = {
  not(column: string, operator: string, value: unknown): unknown;
};

/**
 * SORGU DÜZEYİNDE gizleme: satır hiç taşınmaz — istemciye gönderilip orada
 * saklanmaz. Kapsam boşsa sorguya DOKUNMAZ.
 *
 *   withoutOwner(personelSorgusu, "id", ownerScope)
 *
 * ⚠️ Örnek BİLEREK değişken üzerinden yazıldı: buraya gerçek sorgu zinciri
 * yazılsaydı scripts/check-test-filters.mjs onu bir sorgu sanıp "test filtresi
 * yok" diye kırardı (bir kez oldu). Muhafızı gevşetmek yerine örnek değişti.
 */
export function withoutOwner<Q>(query: Q, column: string, scope: OwnerScope): Q {
  if (scope.hiddenIds.length === 0) return query;
  return (query as Excludable).not(
    column,
    "in",
    `(${scope.hiddenIds.join(",")})`
  ) as Q;
}

/** SATIR DÜZEYİNDE gizleme: sorgu zaten çekilmişse ya da alan türetilmişse. */
export function dropOwnerRows<Row>(
  rows: Row[],
  pickWorkerId: (row: Row) => string | null | undefined,
  scope: OwnerScope
): Row[] {
  if (!scope.active) return rows;
  return rows.filter((row) => scope.isVisible(pickWorkerId(row)));
}

/**
 * YAZMA KAPISI — patron kaydına başka bir yönetici DOKUNAMAZ.
 *
 * Görünmezlik tek başına yarım önlemdir: Çalışanlar listesinden gizlenen bir
 * kaydın id'si bir kez öğrenildiğinde (eski bir ekran görüntüsü, bir URL, bir
 * rapor) `updateWorkerAction` / `setWorkerPinAction` doğrudan çağrılabilir.
 * PIN'i değiştirilebilen bir hesap gizlenmiş sayılmaz.
 *
 * ── BURADA FAIL-CLOSED, LİSTELERDE FAIL-OPEN ───────────────────────────────
 * Okuma tarafı hata durumunda gizlemeden devam eder (liste boşalmasın). Yazma
 * tarafı TERSİ: hedefin patron olup olmadığı ÇÖZÜLEMİYORSA yazma reddedilir.
 * İki taraf farklı, çünkü hatanın bedeli farklı — okumada bedel "bir satır
 * fazla göründü", yazmada bedel "patronun PIN'i değişti". Kapsam TEK KAYIT
 * için çözülür (anahtarlı okuma), yani bir hata tüm personel düzenlemesini
 * değil yalnız o hedefi kilitler.
 *
 * Katman kapalıyken (HAK61/Sendigo) HİÇ sorgu atmaz ve ASLA engellemez.
 */
export async function assertOwnerWritable(
  viewerId: string | null | undefined,
  targetWorkerId: string
): Promise<{ ok: true } | { ok: false; error: "owner_protected" }> {
  if (!SECURITY_LAYER_ENABLED) return { ok: true };
  if (!targetWorkerId) return { ok: true };
  // Kendi kaydına dokunmak her zaman serbest (patron kendi PIN'ini değiştirir).
  if (viewerId && viewerId === targetWorkerId) return { ok: true };

  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("is_owner")
    .eq("id", targetWorkerId)
    .maybeSingle();

  // Kolon yok (045 çalışmamış) → patron kavramı da yok, engelleme yok.
  if (error?.code === "42703") return { ok: true };
  // Başka bir hata: çözemedik → DOKUNMA.
  if (error) return { ok: false, error: "owner_protected" };
  if (data?.is_owner !== true) return { ok: true };

  // Hedef patron. İzleyici de patronsa serbest, değilse red.
  const scope = await getOwnerScope(viewerId);
  return scope.viewerIsOwner ? { ok: true } : { ok: false, error: "owner_protected" };
}
