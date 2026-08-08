import "server-only";
import { audit } from "@/lib/security-log";
import { SECURITY_LAYER_ENABLED } from "@/lib/tenant";

/**
 * DEĞİŞİKLİK İZİ (046 üstü) — "kim neyi NEYE çevirdi".
 *
 * Önceki sürümde audit_log yalnız "kim BAKTI"yı tutuyordu: sayfa görüntüleme,
 * PDF/CSV indirme ve patronun güvenlik eylemleri. Veri değiştiren ~60 sunucu
 * action'ının hiçbiri iz bırakmıyordu; bir kısmı dört ayrı tabloya
 * (worker_admin_log, shift_edit_log, leave_edit_log, login_unlock_log)
 * yazıyordu, geri kalanı hiçbir yere.
 *
 * ── NEDEN "DEĞİŞTİ" YETMEZ ─────────────────────────────────────────────────
 * "Araç güncellendi" satırı bir iz değildir; hangi alanın neye döndüğünü
 * söylemeyen kayıt, olayı yeniden kurmaya yaramaz. Bu yüzden meta içinde
 * ESKİ ve YENİ değer birlikte duruyor ve YALNIZ DEĞİŞEN ALANLAR yazılıyor —
 * 30 kolonluk bir satırın tamamını iki kez saklamak, gerçek değişikliği
 * gürültüde kaybettirirdi.
 *
 * ── SİLMEDE TAM KAYIT ──────────────────────────────────────────────────────
 * Silinen satırda "değişen alan" kavramı yok: kaydın kendisi gidiyor.
 * Dolayısıyla silmede tüm alanlar `before` içine yazılır — sildikten sonra
 * neyin gittiğini okuyabilmenin başka yolu kalmıyor.
 *
 * ── SIR YAZILMAZ ───────────────────────────────────────────────────────────
 * PIN hash'i, token ve gizli soru cevabı gibi alanlar ADIYLA maskelenir.
 * Bir iz kaydının sızması, izlenen şeyin kendisini ele vermemeli.
 *
 * ── BOYUT ──────────────────────────────────────────────────────────────────
 * jsonb sınırsız büyüyebilir; rota noktası ya da uzun not içeren bir satır
 * ize kilobaytlar yazardı. Dizeler kırpılır, alan sayısı tavanlanır ve
 * kırpma GÖRÜNÜR olur ("…" / _kirpildi) — sessizce eksiltmek, izin kendisine
 * güveni bitirir.
 */

/** Adıyla maskelenen alanlar — değeri ASLA ize girmez. */
const GIZLI = new Set([
  "pin",
  "pin_hash",
  "password",
  "token",
  "access_token",
  "refresh_token",
  "answer_hash",
  "session_password",
]);

/** Tek bir değerin ize yazılabilir hâli. */
const MAX_STR = 180;
/** Bir kayıttan ize giren en fazla alan sayısı. */
const MAX_ALAN = 30;

function sadelestir(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    return v.length > MAX_STR ? `${v.slice(0, MAX_STR)}…` : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) {
    // Diziler kısaltılır: uzun rota/kimlik listeleri ize sığmaz.
    const bas = v.slice(0, 10).map(sadelestir);
    return v.length > 10 ? [...bas, `…+${v.length - 10}`] : bas;
  }
  try {
    const s = JSON.stringify(v);
    return s.length > MAX_STR ? `${s.slice(0, MAX_STR)}…` : JSON.parse(s);
  } catch {
    return String(v);
  }
}

function maskele(kayit: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(kayit)) {
    if (n >= MAX_ALAN) {
      out._kirpildi = true;
      break;
    }
    out[k] = GIZLI.has(k) ? "***" : sadelestir(v);
    n++;
  }
  return out;
}

/** İki değer ize göre "aynı" mı? (null ile undefined aynı sayılır) */
function esit(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a ?? null) === null && (b ?? null) === null) return true;
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
}

/**
 * YALNIZ DEĞİŞEN ALANLAR. `after` içinde olup `before`'da farklı olan her
 * alan iki değeriyle birlikte döner.
 *
 * `after`da hiç geçmeyen alanlar DIŞARIDA kalır: action çoğu zaman satırın
 * bir bölümünü güncelliyor ve dokunulmayan kolonları "değişmedi" diye
 * yazmak izi şişirirdi.
 */
export function degisenAlanlar(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b = before ?? {};
  const a = after ?? {};
  const eski: Record<string, unknown> = {};
  const yeni: Record<string, unknown> = {};
  for (const k of Object.keys(a)) {
    if (esit(b[k], a[k])) continue;
    eski[k] = GIZLI.has(k) ? "***" : sadelestir(b[k]);
    yeni[k] = GIZLI.has(k) ? "***" : sadelestir(a[k]);
  }
  return { before: eski, after: yeni };
}

export type ChangeKind = "create" | "update" | "delete";

/**
 * Değişiklik izi yazar.
 *
 * `SECURITY_LAYER_ENABLED` kapalıyken İLK SATIRDA çıkar — HAK61 ve Sendigo'da
 * tek sorgu bile atılmaz ve hiçbir yazma yolu yavaşlamaz.
 *
 * ASLA throw etmez: `audit()` kendi try/catch'inde. Bir izin yazılamaması,
 * kullanıcının yaptığı işi geri almaz.
 *
 * @param entity  tablo/varlık adı — ekranda "Hedef" kolonunda görünür
 * @param before  update/delete öncesi satır (create'te null)
 * @param after   create/update sonrası satır (delete'te null)
 */
export async function auditChange(
  workerId: string | null,
  kind: ChangeKind,
  entity: string,
  id: string | null,
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null
): Promise<void> {
  if (!SECURITY_LAYER_ENABLED) return;

  let meta: Record<string, unknown>;
  if (kind === "create") {
    meta = { id, after: maskele(after ?? {}) };
  } else if (kind === "delete") {
    // Silmede TAM kayıt: değişen alan kavramı yok, satırın kendisi gidiyor.
    meta = { id, before: maskele(before ?? {}) };
  } else {
    const d = degisenAlanlar(before, after);
    // Hiçbir alan değişmediyse iz YAZILMAZ: "kaydet"e basıp hiçbir şey
    // değiştirmemek bir olay değildir ve ekranı boş satırlarla doldururdu.
    if (Object.keys(d.after).length === 0) return;
    meta = { id, before: d.before, after: d.after };
  }

  await audit(workerId, kind, `${entity}`, meta);
}
