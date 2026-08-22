import "server-only";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase";
import { readRequestContext, type HeaderBag } from "@/lib/request-context";
import { SECURITY_LAYER_ENABLED, SINGLE_SESSION } from "@/lib/tenant";

/**
 * GÜVENLİK İZİ (migration 045) — giriş oturumları + eylem izi.
 *
 * ── İKİ KAT KORUMA ─────────────────────────────────────────────────────────
 * 1. Her fonksiyon `SECURITY_LAYER_ENABLED` kapalıyken İLK SATIRDA çıkar.
 *    HAK61 ve Sendigo'da bayrak tanımsız → hiçbir yeni sorgu atılmaz, tek bir
 *    başlık bile okunmaz. Ölçülebilir fark sıfırdır.
 * 2. Bayrak açık ama migration 045 çalıştırılmamışsa tablo yoktur; her yazma
 *    kendi try/catch'inde ve HİÇBİRİ çağıranı düşürmez. Giriş, güvenlik izi
 *    yazılamadı diye başarısız olamaz — bu, deponun yerleşik deseni
 *    (bkz. saveIdleEpisodes / saveVehicleEvents çağrıları).
 *
 * ── NE KAYDEDİLMEZ ─────────────────────────────────────────────────────────
 * PIN, PIN hash'i, oturum çerezi ya da tam istek gövdesi ASLA yazılmaz.
 * `meta` alanına yalnız çağıranın açıkça verdiği küçük anahtarlar girer.
 */

/** PostgreSQL undefined_table / undefined_column — migration 045 yok demek. */
function isMissingRelation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "42703") return true;
  return /login_sessions|audit_log|session_version|is_owner/.test(err.message ?? "");
}

/**
 * "AÇIK" İLE "CANLI" AYRIMI — bu katmanın en kolay yanlış yapılan yeri.
 *
 * `ended_at is null` bir satırın AÇIK olduğunu söyler, CANLI olduğunu söylemez:
 * tarayıcısını çıkış yapmadan kapatan biri sonsuza kadar açık kalır (çerez 30
 * gün yaşıyor, sunucuya "kapattım" diyen bir sinyal yok). Bu ayrım yapılmazsa
 * "aynı hesap iki cihazda açık" işareti ilk girişten sonraki HER girişte yanar
 * ve şüpheli listesi gürültüye dönüşür — yani işe yaramaz hâle gelir.
 *
 * Bu yüzden çoklu-oturum işareti son GÖRÜLME anına bakar: başka bir oturum
 * yalnızca son 30 dakikada iz bırakmışsa "eşzamanlı" sayılır.
 */
const CANLI_PENCERE_MS = 30 * 60 * 1000;

/**
 * Bir satırı 'expired' ile kapatmak ancak ÇEREZİN DE ölmüş olduğu anda dürüst.
 * Bu yüzden süpürme eşiği tam olarak çerez ömrü:
 * lib/session.ts → sessionOptions.cookieOptions.maxAge (60*60*24*30).
 * ⚠️ Orası değişirse burası da değişmeli.
 */
const CEREZ_OMRU_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionSource = "web" | "mobile";

// ─────────────────────────────────────────────────────────────────────────────
// GİRİŞ OTURUMU
// ─────────────────────────────────────────────────────────────────────────────

export type OpenedSession = {
  /** login_sessions.id — çerezde taşınır, çıkışta kapatmak için. */
  id: string | null;
  /**
   * Bu girişten sonra geçerli olan workers.session_version.
   *
   * ⚠️ `undefined` ÖNEMLİ VE 0 İLE AYNI ŞEY DEĞİL: "bu oturumun sürümü
   * bilinmiyor" demek. Çerez sürümsüz mühürlenir ve `isSessionRevoked` onu
   * DENETLEMEZ. Neden: sayacı DB'de artırdıktan sonra herhangi bir adım
   * patlarsa 0 döndürmek çerezi ANINDA eskitir (DB'de 3, çerezte 0 → uyuşmuyor
   * → her istekte dışarı atılır). Kullanıcı bir daha asla giremez — bu depo o
   * hatayı 22.07.2026'da 20 şoförü kilitleyerek bir kez yaşadı. İz katmanının
   * bir arızası kimseyi kapı dışında bırakamaz: uzaktan kesme yeteneğini
   * kaybetmek, insanları kilitlemekten iyidir.
   */
  sessionVersion?: number;
  newDevice: boolean;
  concurrent: boolean;
};

const KAPALI: OpenedSession = {
  id: null,
  sessionVersion: undefined,
  newDevice: false,
  concurrent: false,
};

/**
 * Başarılı girişte çağrılır — İKİ GİRİŞ KAPISININ İKİSİNDEN DE
 * (app/actions/auth.ts çerez yolu ve app/api/mobile/auth/login token yolu).
 * Oturum satırını açar, "yeni cihaz" / "çoklu oturum" işaretlerini hesaplar ve
 * SINGLE_SESSION açıksa önceki çerezleri düşürür.
 *
 * `h` verilmezse `next/headers` okunur (sunucu action'ı / sayfa bağlamı). Route
 * handler'lar `req.headers`'ı doğrudan geçer — orada `headers()` yerine isteğin
 * kendi başlıkları esastır.
 *
 * ASLA throw etmez — güvenlik izi yazılamadığı için giriş engellenemez.
 */
export async function openLoginSession(
  workerId: string,
  opts?: { source?: SessionSource; headers?: HeaderBag }
): Promise<OpenedSession> {
  if (!SECURITY_LAYER_ENABLED) return KAPALI;
  const source: SessionSource = opts?.source ?? "web";
  // try'ın DIŞINDA: aşağıda bir adım patlarsa catch bloğunun DB'ye yazılmış
  // sürümü döndürebilmesi gerekiyor. Yoksa çerez eski sürümle mühürlenir ve
  // kullanıcı ilk korumalı istekte dışarı atılır (giriş döngüsü).
  let sessionVersion: number | undefined;
  try {
    const ctx = readRequestContext(opts?.headers ?? (await headers()));
    const simdi = new Date();
    const simdiIso = simdi.toISOString();

    // ── "YENİ CİHAZ" NE DEMEK DEĞİL ─────────────────────────────────────
    // İlk sürümde bu işaret "bu cihaz izi bu kişide görülmedi" demekti ve
    // İLK GİRİŞTE DE YANIYORDU. Sonucu: katman açıldığı gün herkesin ilk
    // girişi şüpheli görünür, "Şüpheli" sekmesi kadro sayısı kadar satırla
    // dolar ve gerçek bir olayı fark etmek imkânsızlaşır. Bir uyarı, her
    // seferinde yanıyorsa uyarı değildir.
    //
    // Doğru anlamı: "bu kişi DAHA ÖNCE girmişti, ama bu cihazdan hiç." İlk
    // giriş yeni bir cihaz değil, sadece ilk giriştir.
    const [{ data: ayniCihaz, error: gecmisErr }, { data: herhangiGiris }] =
      await Promise.all([
        supabaseAdmin
          .from("login_sessions")
          .select("id")
          .eq("worker_id", workerId)
          .eq("device_hash", ctx.deviceHash)
          .limit(1),
        supabaseAdmin
          .from("login_sessions")
          .select("id")
          .eq("worker_id", workerId)
          .limit(1),
      ]);
    if (gecmisErr && isMissingRelation(gecmisErr)) return KAPALI;
    const ilkGiris = (herhangiGiris?.length ?? 0) === 0;
    const newDevice = !ilkGiris && (ayniCihaz?.length ?? 0) === 0;

    // ── ÖLÜ SATIRLARI SÜPÜR ─────────────────────────────────────────────
    // Çerez ömründen (30 gün) eski açık satırlar artık kimseyi temsil etmiyor:
    // o çerez zaten geçersiz. 'expired' demek burada DOĞRU; daha kısa bir
    // eşikte demek olmazdı (kullanıcı hâlâ girebilir durumda olurdu).
    await supabaseAdmin
      .from("login_sessions")
      .update({ ended_at: simdiIso, ended_reason: "expired" })
      .eq("worker_id", workerId)
      .is("ended_at", null)
      .lt("last_seen_at", new Date(simdi.getTime() - CEREZ_OMRU_MS).toISOString());

    // ── AÇIK / CANLI AYRIMI ─────────────────────────────────────────────
    // acikIds  → tek oturum kilidinin kapatacağı satırlar (açık olan HEPSİ)
    // concurrent → patrona gösterilen şüphe işareti (yalnız CANLI olanlar)
    const { data: acik } = await supabaseAdmin
      .from("login_sessions")
      .select("id, last_seen_at")
      .eq("worker_id", workerId)
      .is("ended_at", null);
    const acikSatir = (acik ?? []) as { id: string; last_seen_at: string }[];
    const acikIds = acikSatir.map((r) => r.id);
    const canliEsik = simdi.getTime() - CANLI_PENCERE_MS;
    // Kapı (web/mobil) burada AYIRT EDİLMEZ: aynı kişinin hem telefondan hem
    // masaüstünden açık olması da bilinmeye değer bir durumdur. Hangi kapı
    // olduğu satırda `source` olarak duruyor ve patron ekranında "Kapı"
    // sütununda görünüyor — yorum orada yapılır, burada bastırılmaz.
    const concurrent = acikSatir.some(
      (r) => new Date(r.last_seen_at).getTime() >= canliEsik
    );

    // ── TEK OTURUM KİLİDİ ───────────────────────────────────────────────
    // Sayaç KOŞULSUZ artar (eskiden yalnız `concurrent` iken artıyordu).
    // Neden: `concurrent` artık canlılığa bakıyor; eski davranışta uykuda ama
    // ÇEREZİ GEÇERLİ bir oturum varken sayaç artmaz, o çerez de ölmez ve
    // "tek oturum" sözü sessizce bozulurdu. Her giriş bir öncekini düşürür.
    //
    // `sessionVersion` undefined kalırsa (sayaç okunamadı) çereze sayı
    // yazılmaz — yukarıdaki nota bakın, 0 yazmak kilitlemeye yol açar.
    const { data: w, error: wErr } = await supabaseAdmin
      .from("workers")
      .select("session_version")
      .eq("id", workerId)
      .maybeSingle();

    if (!wErr) {
      const mevcut = (w?.session_version as number | null) ?? 0;
      if (SINGLE_SESSION) {
        if (acikIds.length) {
          await supabaseAdmin
            .from("login_sessions")
            .update({ ended_at: simdiIso, ended_reason: "single_session" })
            .in("id", acikIds);
        }
        const { error: bumpErr } = await supabaseAdmin
          .from("workers")
          .update({ session_version: mevcut + 1 })
          .eq("id", workerId);
        // Yazamadıysak ESKİ değeri döndür: DB'de hâlâ `mevcut` duruyor.
        sessionVersion = bumpErr ? mevcut : mevcut + 1;

        // İKİ KAPI BİRDEN. session_version yalnız ÇEREZİ öldürür; mobil
        // token'lar ayrı sayaca (token_version, 044) bağlı. Yalnız birini
        // kesmek "tek oturum" sözünü yarım bırakırdı: web'den atılan biri
        // telefondaki token'la içeride kalırdı. Mobil giriş ucu token'ı BUNDAN
        // SONRA okuyup mühürler (bkz. app/api/mobile/auth/login/route.ts).
        //
        // KENDİ try'ında: buradaki bir arıza yukarıda hesaplanmış
        // `sessionVersion`ı düşürmemeli, yoksa çerez DB'yle uyuşmaz ve
        // kullanıcı giriş döngüsüne girer. Dinamik import bilinçli —
        // mobile-auth → lib/session → (bu dosya) statik döngü kurardı.
        try {
          const { bumpTokenVersion } = await import("@/lib/mobile-auth");
          await bumpTokenVersion(workerId);
        } catch {
          /* mobil sayaç kesilemedi — web kesme geçerli */
        }
      } else {
        sessionVersion = mevcut;
      }
    }

    const { data: ins } = await supabaseAdmin
      .from("login_sessions")
      .insert({
        worker_id: workerId,
        ip: ctx.ip,
        user_agent: ctx.userAgent,
        device_hash: ctx.deviceHash,
        city: ctx.city,
        country: ctx.country,
        new_device: newDevice,
        concurrent,
        source,
      })
      .select("id")
      .maybeSingle();

    return { id: (ins?.id as string) ?? null, sessionVersion, newDevice, concurrent };
  } catch {
    // DB'ye yazdığımız sürümü KORUYARAK dön. `KAPALI` döndürmek (sessionVersion
    // undefined) burada da güvenli olurdu ama gereksiz yere uzaktan kesme
    // yeteneğini atardı; yazılan değer biliniyorsa onu taşımak doğrusu.
    return { id: null, sessionVersion, newDevice: false, concurrent: false };
  }
}

/** Çıkışta / oturum düşürülünce satırı kapatır. Sessizce başarısız olabilir. */
export async function closeLoginSession(
  sessionId: string | null | undefined,
  reason: "logout" | "single_session" | "revoked" | "expired"
): Promise<void> {
  if (!SECURITY_LAYER_ENABLED || !sessionId) return;
  try {
    await supabaseAdmin
      .from("login_sessions")
      .update({ ended_at: new Date().toISOString(), ended_reason: reason })
      .eq("id", sessionId)
      .is("ended_at", null);
  } catch {
    /* iz yazılamadı — çıkış yine de olur */
  }
}

/**
 * Korumalı sayfa isteklerinde oturumun canlılığını ileri taşır.
 *
 * lib/session.ts'teki her kapı (requireWorker/requireAdmin/requireOwner/
 * requireFleetView) bunu çağırır. Bu çağrı olmadan `last_seen_at` sonsuza kadar
 * `started_at`'a eşit kalır ve "açık/canlı" ayrımı (yukarıdaki nota bakın)
 * anlamsızlaşır — yani çoklu-oturum işareti gürültüye düşer.
 *
 * Maliyeti: katman AÇIKKEN korumalı istek başına bir UPDATE. Katman kapalıyken
 * ilk satırda çıkar; HAK61/Sendigo tek sorgu bile atmaz.
 */
export async function touchLoginSession(sessionId: string | null | undefined): Promise<void> {
  if (!SECURITY_LAYER_ENABLED || !sessionId) return;
  try {
    await supabaseAdmin
      .from("login_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", sessionId)
      .is("ended_at", null);
  } catch {
    /* yok say */
  }
}

/**
 * MOBİL OTURUMLARIN KAPANIŞI — hesap ekseninde.
 *
 * Mobil tarafta çıkış cihaz başına değil HESAP başına yürüyor (token_version bir
 * artar, o kişinin tüm token'ları ölür — bkz. api/mobile/auth/logout). Oturum
 * satırlarını da aynı eksende kapatmak zorundayız: aksi hâlde "çıkış yaptım"
 * diyen bir telefon /admin/guvenlik'te sonsuza kadar açık görünürdü.
 *
 * Mobil token bir satır id'si taşımıyor, bu yüzden id ile değil kapı ile eşlenir.
 */
export async function closeSessionsBySource(
  workerId: string,
  source: SessionSource,
  reason: "logout" | "single_session" | "revoked" | "expired"
): Promise<void> {
  if (!SECURITY_LAYER_ENABLED) return;
  try {
    await supabaseAdmin
      .from("login_sessions")
      .update({ ended_at: new Date().toISOString(), ended_reason: reason })
      .eq("worker_id", workerId)
      .eq("source", source)
      .is("ended_at", null);
  } catch {
    /* iz yazılamadı — çıkış yine de olur */
  }
}

/**
 * Mobil oturumun canlılığı: token YENİLENDİĞİNDE ileri taşınır.
 *
 * Access token 15 dakika yaşıyor, yani çalışan bir istemci en geç 15 dakikada
 * bir yenilemeye geliyor — bu, `CANLI_PENCERE_MS` (30 dk) için yeterince sık
 * bir nabız. Her mobil isteği damgalamak aynı bilgiyi kat kat yazma pahasına
 * verirdi; yenileme ucu doğal ve tek noktalı olan yer.
 */
export async function touchSessionsBySource(
  workerId: string,
  source: SessionSource
): Promise<void> {
  if (!SECURITY_LAYER_ENABLED) return;
  try {
    await supabaseAdmin
      .from("login_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("worker_id", workerId)
      .eq("source", source)
      .is("ended_at", null);
  } catch {
    /* yok say */
  }
}

/**
 * Çerezdeki oturum sürümü hâlâ geçerli mi?
 *
 * `true` → oturum ÖLÜ (çerez iptal edilmiş). Katman kapalıyken DAİMA `false`
 * döner, yani hiçbir ek sorgu atılmaz ve hiçbir oturum düşürülmez.
 * DB hatasında da `false` — geçici bir hata yüzünden çalışan insanları
 * kapı dışında bırakmayız (kilit fail-closed DEĞİL, bilinçli fail-open:
 * bu bir yetki kapısı değil, bir iptal mekanizmasıdır).
 */
export async function isSessionRevoked(
  workerId: string,
  cookieVersion: number | undefined
): Promise<boolean> {
  if (!SECURITY_LAYER_ENABLED) return false;
  // ── SÜRÜMSÜZ ÇEREZ DENETLENMEZ ──────────────────────────────────────────
  // İki hâlde olur: (1) çerez katman açılmadan ÖNCE mühürlenmiş, (2) girişte iz
  // yazımı arızalanmış (bkz. OpenedSession.sessionVersion notu). İkisinde de
  // "sürüm yok" DEMEK "sürüm 0" DEMEK DEĞİL: 0 varsayıp DB'deki 3 ile
  // karşılaştırmak o kişiyi kalıcı olarak dışarıda bırakırdı — katmanı açmak
  // tek başına herkesi kapı dışına atardı. Çerez iron ile mühürlü, yani bu alanı
  // kullanıcı silip kendini denetimden kaçıramaz; yalnız bizim kodumuz yazıyor.
  // Bedeli: o oturum uzaktan kesilemez, bir sonraki girişte sürüm kazanır.
  if (cookieVersion === undefined || cookieVersion === null) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from("workers")
      .select("session_version")
      .eq("id", workerId)
      .maybeSingle();
    if (error || !data) return false;
    const dbVersion = (data.session_version as number | null) ?? 0;
    return dbVersion !== cookieVersion;
  } catch {
    return false;
  }
}

/** Bir kişinin tüm oturumlarını düşürür (patron düğmesi). Yeni sürümü döner. */
export async function revokeAllSessions(workerId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("workers")
    .select("session_version")
    .eq("id", workerId)
    .maybeSingle();
  const next = ((data?.session_version as number | null) ?? 0) + 1;
  await supabaseAdmin.from("workers").update({ session_version: next }).eq("id", workerId);
  await supabaseAdmin
    .from("login_sessions")
    .update({ ended_at: new Date().toISOString(), ended_reason: "revoked" })
    .eq("worker_id", workerId)
    .is("ended_at", null);
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// EYLEM İZİ
// ─────────────────────────────────────────────────────────────────────────────

export type AuditAction =
  | "page_view"
  | "export_csv"
  | "export_pdf"
  | "session_revoke"
  | "account_freeze"
  | "account_unfreeze"
  // ── ERİŞİM KAPILARI (046) ────────────────────────────────────────────────
  | "access_approve"
  | "access_deny"
  | "access_hours"
  | "kill_switch_on"
  | "kill_switch_off"
  // ── DEĞİŞİKLİK İZİ (lib/audit-change.ts) ─────────────────────────────────
  // "kim neyi NEYE çevirdi" — meta içinde eski/yeni değer taşınır.
  | "create"
  | "update"
  | "delete"
  // ── GÖLGE MODU (dalga 3) ─────────────────────────────────────────────────
  | "shadow_enter"
  | "shadow_exit"
  // ── MESAJLAŞMA (071) ─────────────────────────────────────────────────────
  // "kim kime yazdı" izlenebilir olmalı: mesaj bir yönetici eylemidir ve
  // duyuru tüm filoya gider. `audit_log.action` serbest metin (045'te CHECK
  // yok), yani yeni değer şema değişikliği İSTEMEZ.
  | "message_send"
  | "message_broadcast";

/**
 * Eylem izi yazar. ASLA throw etmez ve katman kapalıyken hiçbir şey yapmaz.
 * `meta` küçük tutulmalı — istek gövdesi ya da kişisel veri konmaz.
 */
export async function audit(
  workerId: string | null,
  action: AuditAction,
  target?: string | null,
  meta?: Record<string, unknown>
): Promise<void> {
  if (!SECURITY_LAYER_ENABLED) return;
  try {
    const ctx = readRequestContext(await headers());
    await supabaseAdmin.from("audit_log").insert({
      worker_id: workerId,
      action,
      target: target ?? null,
      meta: meta ?? null,
      ip: ctx.ip,
    });
  } catch {
    /* iz yazılamadı — eylem yine de tamamlanır */
  }
}
