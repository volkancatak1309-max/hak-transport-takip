import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { SECURITY_LAYER_ENABLED } from "@/lib/tenant";
import { getTestScope, withoutTestRows } from "@/lib/test-data";

/**
 * GÜVENLİK EKRANI OKUMA KATMANI (045).
 *
 * Katman kapalıyken ya da migration 045 çalıştırılmamışken BOŞ döner —
 * ekran "kayıt yok" gösterir, hata vermez. Bu deponun eksik-tabloya dayanıklı
 * okuma deseninin aynısı (bkz. selectZones, readTokenVersion).
 */

export type SessionRow = {
  id: string;
  worker_id: string;
  worker_name: string;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  ip: string | null;
  user_agent: string | null;
  device_hash: string | null;
  city: string | null;
  country: string | null;
  new_device: boolean;
  concurrent: boolean;
  /** Hangi kapıdan girildi: tarayıcı çerezi ('web') ya da mobil token uçları. */
  source: "web" | "mobile" | string;
  /**
   * AÇIK ama CANLI mı? (son 30 dakikada iz bıraktı mı)
   *
   * SUNUCUDA hesaplanıyor, istemcide değil: "şu an"a bağlı bir değeri istemci
   * bileşeninde üretmek SSR ile ilk render arasında hidrasyon uyuşmazlığı
   * doğurur. Eşik lib/security-log.ts → CANLI_PENCERE_MS ile aynı.
   */
  live: boolean;
};

/** Canlılık eşiği — lib/security-log.ts → CANLI_PENCERE_MS ile aynı olmalı. */
const CANLI_PENCERE_MS = 30 * 60 * 1000;

export type AuditRow = {
  id: string;
  worker_id: string | null;
  worker_name: string;
  at: string;
  action: string;
  target: string | null;
  ip: string | null;
  /**
   * Değişiklik ayrıntısı — ALAN ALAN, tek dize DEĞİL.
   *
   * Önce tek satırlık bir özet dizesiydi ("plate: A → B · model: C → D") ve
   * ekranda okunmuyordu: dört değişiklik yan yana dizilince satır bir metin
   * bloğuna dönüşüyordu. Dize istemcide GÜVENLE bölünemez (değerlerin içinde
   * de "·" ya da "→" geçebilir), bu yüzden bölme işi kaynağa alındı.
   *
   * Ham jsonb yine istemciye İNMEZ: maskeleme ve kırpma burada yapılır.
   */
  degisim: ChangeField[];
  /** Satır hangi tablodan geldi — birleşik zaman çizgisinde kaynağı gösterir. */
  kaynak: TimelineSource;
};

/**
 * İZİN DAĞILDIĞI YERLER.
 *
 * "Kim neyi değiştirdi" sorusunun cevabı bu depoda BEŞ ayrı tabloya dağılmış
 * durumda: audit_log (046 ile gelen genel iz) ve ondan önce yazılmış dört özel
 * tablo. Tabloları birleştirmek (taşımak/silmek) YAPILMADI — her biri kendi
 * ekranında da kullanılıyor (vardiya düzenleme izi vardiya detayında, izin izi
 * izin arşivinde). Burada yalnız OKUNUP tek zaman çizgisinde birleştiriliyor.
 */
/** Tek bir alanın eski→yeni hâli. Boş değer "—" ile temsil edilir. */
export type ChangeField = {
  /** Ham kolon adı — ekranda Türkçeleştirilir, sözlükte yoksa ham hâli görünür. */
  alan: string;
  eski: string;
  yeni: string;
};

export type TimelineSource =
  | "audit_log"
  | "worker_admin_log"
  | "shift_edit_log"
  | "leave_edit_log"
  | "login_unlock_log";

export type SecurityWorker = {
  id: string;
  name: string;
  phone: string;
  is_admin: boolean;
  is_owner: boolean;
  is_active: boolean;
  acikOturum: number;
  /** Açıkların kaçı son 30 dakikada iz bıraktı — "şu an başında mı" sorusu. */
  canliOturum: number;
};

async function workerNames(): Promise<Map<string, string>> {
  // owner-visible: bu ekranı YALNIZ patron açabiliyor (app/admin/guvenlik/page.tsx
  // → requireOwner). Gizlenecek bir izleyici yok; patronun kendi adını kendi
  // ekranında saklamak, oturum satırlarını adsız bırakmaktan başka işe yaramaz.
  // test-visible: GÜVENLİK ekranı. Test hesabı BİLEREK elenmiyor — bu ekranın
  // işi "kim girdi"yi eksiksiz göstermek. Test hesabı gizlenseydi o hesapla
  // yapılmış bir giriş adsız ("—") görünür, yani ele geçirilmiş bir test
  // hesabı tam da izlenmesi gereken yerde görünmez olurdu.
  const { data } = await supabaseAdmin.from("workers").select("id, name");
  return new Map(((data ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));
}

/** Son N giriş oturumu (en yeniden eskiye). */
export async function listSessions(limit = 200): Promise<SessionRow[]> {
  if (!SECURITY_LAYER_ENABLED) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from("login_sessions")
      .select(
        "id, worker_id, started_at, last_seen_at, ended_at, ended_reason, ip, user_agent, device_hash, city, country, new_device, concurrent, source"
      )
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    const isim = await workerNames();
    const canliEsik = Date.now() - CANLI_PENCERE_MS;
    return data.map((r) => {
      const row = r as Omit<SessionRow, "worker_name" | "live">;
      return {
        ...row,
        worker_name: isim.get(row.worker_id) ?? "—",
        live:
          row.ended_at === null &&
          new Date(row.last_seen_at).getTime() >= canliEsik,
      };
    });
  } catch {
    return [];
  }
}

/** Şu an açık oturumlar. */
export async function listOpenSessions(): Promise<SessionRow[]> {
  const hepsi = await listSessions(400);
  return hepsi.filter((s) => s.ended_at === null);
}

/** Değeri ekranda okunur kıl: boş → "—", uzun dizeyi kırp. */
function goster(v: unknown): string {
  // "boş" kelimesi bir DEĞER gibi okunuyordu ("boş → 2028-11-10" satırında
  // sanki alanın eski değeri "boş" metniymiş gibi). Tire, yokluğu anlatır.
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v).slice(0, 60);
    } catch {
      return "…";
    }
  }
  return String(v).slice(0, 60);
}

/**
 * audit_log.meta → ALAN ALAN değişiklik listesi.
 *
 * update  →  her değişen alan için { alan, eski, yeni }
 * create  →  { alan, eski: "—", yeni: <değer> }   (yokluktan var oluşa)
 * delete  →  { alan, eski: <değer>, yeni: "—" }   (var oluştan yokluğa)
 *
 * create/delete'i de aynı eski→yeni biçimine oturtmak bilinçli: ekran tek bir
 * satır bileşeni kullanıyor ve üç ayrı düzen yerine tek düzen okunuyor.
 *
 * KIRPMA YOK: alan sayısı burada sınırlanmıyor, katlama işi EKRANDA yapılıyor
 * (ilk 3 + "+N alan daha"). Sunucuda kırpsaydık kullanıcı "daha" düğmesine
 * bastığında elde olmayan veriyi göstermek gerekirdi.
 */
function metaDegisim(action: string, meta: unknown): ChangeField[] {
  if (!meta || typeof meta !== "object") return [];
  const m = meta as Record<string, unknown>;
  const before = (m.before ?? null) as Record<string, unknown> | null;
  const after = (m.after ?? null) as Record<string, unknown> | null;

  if (action === "update" && before && after) {
    return Object.keys(after).map((k) => ({
      alan: k,
      eski: goster(before[k]),
      yeni: goster(after[k]),
    }));
  }
  const kaynak = action === "delete" ? before : after;
  if (!kaynak) return [];
  return Object.keys(kaynak)
    .filter((k) => k !== "_kirpildi")
    .map((k) =>
      action === "delete"
        ? { alan: k, eski: goster(kaynak[k]), yeni: "—" }
        : { alan: k, eski: "—", yeni: goster(kaynak[k]) }
    );
}

/** Son eylem izi (yalnız audit_log). */
export async function listAudit(limit = 200): Promise<AuditRow[]> {
  if (!SECURITY_LAYER_ENABLED) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .select("id, worker_id, at, action, target, ip, meta")
      .order("at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    const isim = await workerNames();
    return (data as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      worker_id: (r.worker_id as string | null) ?? null,
      worker_name: r.worker_id ? isim.get(r.worker_id as string) ?? "—" : "—",
      at: r.at as string,
      action: r.action as string,
      target: (r.target as string | null) ?? null,
      ip: (r.ip as string | null) ?? null,
      degisim: metaDegisim(r.action as string, r.meta),
      kaynak: "audit_log" as TimelineSource,
    }));
  } catch {
    return [];
  }
}

/** Tablo yoksa/hata varsa BOŞ döner — eksik migration ekranı kırmaz. */
async function guvenliOku(
  tablo: string,
  kolonlar: string,
  sirala: string,
  limit: number
): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from(tablo)
      .select(kolonlar)
      .order(sirala, { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as unknown as Record<string, unknown>[];
  } catch {
    return [];
  }
}

/**
 * BİRLEŞİK ZAMAN ÇİZGİSİ — beş tablo, tek liste.
 *
 * ── NEDEN BİRLEŞTİRME, NEDEN TAŞIMA DEĞİL ──────────────────────────────────
 * Dört eski tablo kendi ekranlarında da kullanılıyor: vardiya düzenleme izi
 * vardiya detayında, izin izi izin arşivinde, kilit açma personel dosyasında.
 * Onları audit_log'a taşımak o üç ekranı da yeniden yazmak demekti ve geçmiş
 * veriyi göç ettirmek gerekirdi. Okuyup birleştirmek aynı soruyu yanıtlıyor,
 * hiçbir şeyi kırmıyor.
 *
 * ── SIRALAMA VE TAVAN ──────────────────────────────────────────────────────
 * Her tablodan en yeni `limit` satır çekilip birleşik liste zamana göre
 * sıralanıyor ve yine `limit`e kırpılıyor. Tek bir tablo çok konuşkansa
 * diğerlerini ekrandan SÜRMEZ, çünkü hepsi kendi payını getiriyor.
 *
 * Katman kapalıyken tek sorgu bile atılmaz.
 */
export async function listActionTimeline(limit = 200): Promise<AuditRow[]> {
  if (!SECURITY_LAYER_ENABLED) return [];
  try {
    const [audit, adminLog, shiftLog, leaveLog, unlockLog] = await Promise.all([
      listAudit(limit),
      guvenliOku("worker_admin_log", "id, changed_at, changed_by, worker_id, granted", "changed_at", limit),
      guvenliOku("shift_edit_log", "id, time_entry_id, changed_at, changed_by, field, old_value, new_value", "changed_at", limit),
      guvenliOku("leave_edit_log", "id, leave_id, changed_at, changed_by, action, field, old_value, new_value", "changed_at", limit),
      guvenliOku("login_unlock_log", "id, unlocked_at, unlocked_by, worker_id, cleared_rows", "unlocked_at", limit),
    ]);

    const isim = await workerNames();
    const ad = (id: unknown) => (id ? isim.get(id as string) ?? "—" : "—");

    const satirlar: AuditRow[] = [
      ...audit,
      ...adminLog.map((r) => ({
        id: `wa-${r.id as string}`,
        worker_id: (r.changed_by as string | null) ?? null,
        worker_name: ad(r.changed_by),
        at: r.changed_at as string,
        action: r.granted ? "admin_grant" : "admin_revoke",
        target: `workers · ${ad(r.worker_id)}`,
        ip: null,
        degisim: [{ alan: "is_admin", eski: String(!r.granted), yeni: String(!!r.granted) }],
        kaynak: "worker_admin_log" as TimelineSource,
      })),
      ...shiftLog.map((r) => ({
        id: `se-${r.id as string}`,
        worker_id: (r.changed_by as string | null) ?? null,
        worker_name: ad(r.changed_by),
        at: r.changed_at as string,
        action: "shift_edit",
        target: "time_entries",
        ip: null,
        degisim: [{ alan: r.field as string, eski: goster(r.old_value), yeni: goster(r.new_value) }],
        kaynak: "shift_edit_log" as TimelineSource,
      })),
      ...leaveLog.map((r) => ({
        id: `le-${r.id as string}`,
        worker_id: (r.changed_by as string | null) ?? null,
        worker_name: ad(r.changed_by),
        at: r.changed_at as string,
        action: `leave_${r.action as string}`,
        target: "worker_leaves",
        ip: null,
        degisim: [{ alan: r.field as string, eski: goster(r.old_value), yeni: goster(r.new_value) }],
        kaynak: "leave_edit_log" as TimelineSource,
      })),
      ...unlockLog.map((r) => ({
        id: `lu-${r.id as string}`,
        worker_id: (r.unlocked_by as string | null) ?? null,
        worker_name: ad(r.unlocked_by),
        at: r.unlocked_at as string,
        action: "login_unlock",
        target: `workers · ${ad(r.worker_id)}`,
        ip: null,
        degisim: [{ alan: "cleared_rows", eski: "—", yeni: goster(r.cleared_rows) }],
        kaynak: "login_unlock_log" as TimelineSource,
      })),
    ];

    return satirlar
      .filter((r) => !!r.at)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Kullanıcı listesi + açık oturum sayısı (dondurma düğmesi için).
 * `is_owner` kolonu yoksa (045 öncesi) false kabul edilir.
 */
export async function listSecurityWorkers(): Promise<SecurityWorker[]> {
  try {
    // test-filtered: test hesapları bu YÖNETİM listesinden çıkarıldı
    // (Volkan, 08.08.2026) — demoda kalabalık yapıyordu.
    //
    // ⚠️ AYRIM ÖNEMLİ: elenen şey yalnız aşağıdaki KULLANICI KARTLARI, yani
    // "dondur / oturumları sonlandır" satırları. Test hesabının GİRİŞLERİ
    // (listSessions) ve EYLEMLERİ (listAudit) ekranda DURMAYA devam eder —
    // ele geçirilmiş bir test hesabı tam da orada görünmelidir. Dondurmak
    // gerekirse Çalışanlar sayfasından yapılır.
    const scope = await getTestScope();
    // owner-visible: ekran requireOwner arkasında — yukarıdaki gerekçenin aynısı.
    // Patron burada KENDİNİ görür ve görmelidir: "patron" rozeti bu listede
    // basılıyor, gizlenirse kendi kademesini doğrulayamaz.
    const { data, error } = await withoutTestRows(
      supabaseAdmin
        .from("workers")
        .select("id, name, phone, is_admin, is_owner, is_active")
        .order("name"),
      "id",
      scope.workerIds
    );
    if (error || !data) return [];
    const acik = await listOpenSessions();
    const sayac = new Map<string, number>();
    const canliSayac = new Map<string, number>();
    for (const s of acik) {
      sayac.set(s.worker_id, (sayac.get(s.worker_id) ?? 0) + 1);
      if (s.live) canliSayac.set(s.worker_id, (canliSayac.get(s.worker_id) ?? 0) + 1);
    }
    return (data as Record<string, unknown>[]).map((w) => ({
      id: w.id as string,
      name: (w.name as string) ?? "—",
      phone: (w.phone as string) ?? "",
      is_admin: w.is_admin === true,
      is_owner: w.is_owner === true,
      is_active: w.is_active === true,
      acikOturum: sayac.get(w.id as string) ?? 0,
      canliOturum: canliSayac.get(w.id as string) ?? 0,
    }));
  } catch {
    return [];
  }
}
