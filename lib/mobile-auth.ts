import "server-only";
import { sealData, unsealData } from "iron-session";
import { supabaseAdmin } from "@/lib/supabase";
import { sessionOptions } from "@/lib/session";

/**
 * MOBİL TOKEN KATMANI — React Native istemcisi için çerezsiz kimlik.
 *
 * Tarayıcı yolu (hak_session çerezi, iron-session) bu dosyadan HİÇ etkilenmez;
 * burada üretilen token yalnız /api/mobile/* uçlarında geçerlidir.
 *
 * ── SIR ──────────────────────────────────────────────────────────────────────
 * Token'lar oturum çereziyle AYNI sırla mühürlenir (SESSION_PASSWORD, tek
 * kaynak lib/session.ts). Yeni bir env değişkeni YOK. Bunun bedava gelen bir
 * yan faydası var: her müşteri kendi SESSION_PASSWORD'üne sahip olduğu için
 * HAK61'de üretilen bir token Sendigo dağıtımında ÇÖZÜLEMEZ — çapraz kiracı
 * erişimi şema ya da kontrol koduyla değil, kriptografiyle kapalıdır.
 *
 * ── NEDEN KENDİ `exp` ALANIMIZ VAR ───────────────────────────────────────────
 * iron'un `ttl`'i süreyi uyguluyor ama 60 saniyelik saat toleransıyla: ttl=1sn
 * ile mühürlenmiş bir token t+58sn'de HÂLÂ geçerli, t+62sn'de reddediliyor
 * (ölçüldü, 07.08.2026). 15 dakikalık bir access token için bu ~16 dakika
 * demektir. Süreyi kesin bilmek istediğimiz için token'a mutlak `exp` (epoch ms)
 * koyup KENDİMİZ denetliyoruz; iron'un ttl'i ikinci hat olarak yerinde duruyor.
 *
 * ── TOKEN İÇERİĞİ ────────────────────────────────────────────────────────────
 * Yalnız: kullanıcı id, token sürümü, rol bayrağı, tip, bitiş. İsim, telefon,
 * PIN ya da başka kişisel veri KOYULMAZ — token istemci diskinde yaşıyor.
 * `adm` bayrağı bilgi amaçlıdır; yetkinin son sözünü her istekte DB söyler.
 */

/** Access token ömrü (sn). Kısa: iptal gecikmesinin üst sınırı budur. */
export const ACCESS_TTL_S = 15 * 60;

/** Refresh token ömrü (sn) — tarayıcı çerezinin ömrüyle aynı: 30 gün. */
export const REFRESH_TTL_S = 60 * 60 * 24 * 30;

/** Çereze ne olursa olsun, token'lar oturum sırrıyla mühürlenir. */
const TOKEN_PASSWORD = sessionOptions.password as string;

export type MobileTokenType = "access" | "refresh";

export type MobileTokenPayload = {
  /** workers.id */
  sub: string;
  /** Mühürlendiği andaki workers.token_version. */
  tv: number;
  /** Rol bayrağı — bilgi amaçlı; yetkinin son sözü DB'dir. */
  adm: boolean;
  typ: MobileTokenType;
  /** Mutlak bitiş, epoch ms. Kendi denetimimiz (yukarıdaki nota bakın). */
  exp: number;
};

function ttlFor(typ: MobileTokenType): number {
  return typ === "access" ? ACCESS_TTL_S : REFRESH_TTL_S;
}

async function seal(
  sub: string,
  tv: number,
  adm: boolean,
  typ: MobileTokenType
): Promise<string> {
  const ttl = ttlFor(typ);
  const payload: MobileTokenPayload = {
    sub,
    tv,
    adm,
    typ,
    exp: Date.now() + ttl * 1000,
  };
  return sealData(payload, { password: TOKEN_PASSWORD, ttl });
}

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export async function issueTokens(
  workerId: string,
  isAdmin: boolean,
  tokenVersion: number
): Promise<IssuedTokens> {
  const [accessToken, refreshToken] = await Promise.all([
    seal(workerId, tokenVersion, isAdmin, "access"),
    seal(workerId, tokenVersion, isAdmin, "refresh"),
  ]);
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_S };
}

export async function issueAccessToken(
  workerId: string,
  isAdmin: boolean,
  tokenVersion: number
): Promise<{ accessToken: string; expiresIn: number }> {
  return {
    accessToken: await seal(workerId, tokenVersion, isAdmin, "access"),
    expiresIn: ACCESS_TTL_S,
  };
}

/**
 * Token'ı çözer ve BİÇİMSEL olarak doğrular (imza + tip + süre).
 * Sürüm/hesap denetimi burada YAPILMAZ — o DB'ye bakan katmanın işi.
 *
 * Geçersiz mühürde iron `{}` döner, fırlatmaz (ölçüldü) — bu yüzden alan alan
 * denetliyoruz.
 */
export async function readToken(
  token: string,
  expected: MobileTokenType
): Promise<MobileTokenPayload | null> {
  if (!token) return null;
  let raw: Partial<MobileTokenPayload>;
  try {
    raw = await unsealData<Partial<MobileTokenPayload>>(token, {
      password: TOKEN_PASSWORD,
      ttl: ttlFor(expected),
    });
  } catch {
    return null;
  }
  if (!raw || typeof raw.sub !== "string" || !raw.sub) return null;
  if (raw.typ !== expected) return null;
  if (typeof raw.exp !== "number" || raw.exp <= Date.now()) return null;
  if (typeof raw.tv !== "number") return null;
  return {
    sub: raw.sub,
    tv: raw.tv,
    adm: raw.adm === true,
    typ: raw.typ,
    exp: raw.exp,
  };
}

/** `Authorization: Bearer <token>` başlığından ham token. */
export function bearerToken(h: { get(name: string): string | null }): string | null {
  const raw = h.get("authorization") ?? h.get("Authorization");
  if (!raw) return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// ── token_version (migration 044) ───────────────────────────────────────────

/**
 * `workers.token_version` — mobil token'ların iptal sayacı.
 *
 * MIGRATION 044 ÇALIŞMAMIŞ KURULUMDA: kolon yok. Bu durumda okuma `available:
 * false` döner ve sürüm denetimi ATLANIR — /login, /refresh ve /me tam çalışır.
 * İptali gerçekten uygulayan tek uç olan /logout ise 503 mobile_store_missing
 * döner: sessizce "çıkış yapıldı" demek, yapılmamış bir iptali yapılmış gibi
 * göstermek olurdu.
 *
 * Kolon-yok tespiti bu depoda yerleşik bir desen (bkz. app/actions/geofences.ts
 * selectZones, lib/shift-edit-log.ts): sorgu hatasında dar kapsamlı düşüş.
 */
export type TokenVersionRead =
  /** Kolon var, değer okundu. */
  | { status: "ok"; value: number }
  /** Migration 044 çalışmamış — sürüm denetimi atlanır, /logout 503 döner. */
  | { status: "missing_column" }
  /** Geçici DB hatası — SESSİZCE ATLANMAZ, çağıran fail-closed davranır. */
  | { status: "error" };

/** PostgreSQL `undefined_column`. Kolon yokluğunu geçici hatadan ayırır. */
const UNDEFINED_COLUMN = "42703";

function isMissingColumn(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === UNDEFINED_COLUMN) return true;
  return /token_version/.test(err.message ?? "") && /column|kolon/i.test(err.message ?? "");
}

export async function readTokenVersion(
  workerId: string
): Promise<TokenVersionRead> {
  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("token_version")
    .eq("id", workerId)
    .maybeSingle();
  if (error) {
    return isMissingColumn(error) ? { status: "missing_column" } : { status: "error" };
  }
  return { status: "ok", value: (data?.token_version as number | null) ?? 0 };
}

/**
 * Sayacı bir artırır → o kişinin TÜM mobil token'ları anında ölür.
 *
 * Çağrıldığı yerler (dördü de mevcut akışlara bağlandı): çıkış, PIN değişimi,
 * pasife alma, işten çıkarma. Gerekçe: işten çıkan birinin telefonundaki
 * anahtarın 30 gün canlı kalması kabul edilemez.
 *
 * PostgREST `col = col + 1` yazamıyor, bu yüzden oku-yaz. Yarış zararsız: iki
 * eşzamanlı iptal sayacı 0→1 yapsa bile tv=0 taşıyan token'lar yine ölür; kayıp
 * güncelleme ancak tam arada yeni bir token verilmişse önemlidir.
 *
 * Dönen değer: iptal gerçekten yazıldı mı. `false` ise kolon yok (migration
 * bekliyor) ya da yazma başarısız — çağıran bunu YUTMAMALI.
 */
export async function bumpTokenVersion(workerId: string): Promise<boolean> {
  const current = await readTokenVersion(workerId);
  if (current.status !== "ok") return false;
  const { error } = await supabaseAdmin
    .from("workers")
    .update({ token_version: current.value + 1 })
    .eq("id", workerId);
  return !error;
}

// ── ORTAK KAPI ──────────────────────────────────────────────────────────────

export type MobileWorker = {
  id: string;
  name: string;
  is_admin: boolean;
  is_active: boolean;
  must_change_pin: boolean;
  counts_as_driver: boolean;
};

export type MobileAuthResult =
  | { ok: true; worker: MobileWorker; tokenVersion: number }
  | { ok: false; status: number; code: string };

/**
 * MOBİL İSTEK DOĞRULAMA — bundan sonraki TÜM mobil uçların tek kapısı.
 *
 * lib/session.ts'teki requireWorker/requireAdmin'den ayrılan noktası: yetkisizde
 * `redirect()` FIRLATMAZ. Server action'lar için doğru olan yönlendirme, bir API
 * istemcisi için anlamsız (mobil 401 yerine 307 + HTML görür). Buradaki kapı
 * daima veri döner, çağıran da onu JSON'a çevirir.
 *
 * Her istekte DB'ye bir okuma yapar. Bedeli bilinçli: hesap durumu (is_active)
 * ve iptal sayacı token'dan DEĞİL, kaynaktan gelir — böylece pasife alınan bir
 * çalışan access token ömrü kadar bile beklemeden düşer.
 */
export async function verifyMobileRequest(req: {
  headers: { get(name: string): string | null };
}): Promise<MobileAuthResult> {
  const token = bearerToken(req.headers);
  if (!token) return { ok: false, status: 401, code: "missing_token" };

  const payload = await readToken(token, "access");
  if (!payload) return { ok: false, status: 401, code: "invalid_token" };

  const BASE = "id, name, is_admin, is_active, must_change_pin, counts_as_driver";

  // Tek sorguda sürümle birlikte oku; kolon yoksa (migration 044 beklemede)
  // sürümsüz sorguya düş. Migration çalıştıktan sonra istek başına TEK okuma.
  let row: Record<string, unknown> | null = null;
  let tokenVersion: number | null = null;

  const withTv = await supabaseAdmin
    .from("workers")
    .select(`${BASE}, token_version`)
    .eq("id", payload.sub)
    .maybeSingle();

  if (!withTv.error) {
    row = withTv.data as Record<string, unknown> | null;
    tokenVersion = ((row?.token_version as number | null) ?? 0) as number;
  } else if (isMissingColumn(withTv.error)) {
    const base = await supabaseAdmin
      .from("workers")
      .select(BASE)
      .eq("id", payload.sub)
      .maybeSingle();
    if (base.error) return { ok: false, status: 503, code: "db_error" };
    row = base.data as Record<string, unknown> | null;
    tokenVersion = null; // denetim atlanır — migration bekliyor
  } else {
    // Geçici hata: iptal denetimi yapılamıyorsa istek REDDEDİLİR (fail-closed).
    return { ok: false, status: 503, code: "db_error" };
  }

  if (!row) return { ok: false, status: 401, code: "invalid_token" };

  const worker: MobileWorker = {
    id: row.id as string,
    name: (row.name as string) ?? "—",
    is_admin: row.is_admin === true,
    is_active: row.is_active === true,
    must_change_pin: row.must_change_pin === true,
    counts_as_driver: row.counts_as_driver === true,
  };

  // Hesap kapatılmışsa token'ın süresi dolmamış olsa da geçersizdir.
  if (!worker.is_active) return { ok: false, status: 401, code: "inactive" };

  // İptal sayacı: token mühürlendiğinden beri artmışsa token ölüdür.
  if (tokenVersion !== null && payload.tv !== tokenVersion) {
    return { ok: false, status: 401, code: "revoked" };
  }

  return { ok: true, worker, tokenVersion: tokenVersion ?? payload.tv };
}

/** Mobil uçların tek tip hata gövdesi. */
export function mobileError(
  status: number,
  code: string,
  extra?: Record<string, unknown>
): Response {
  return Response.json({ ok: false, error: code, ...extra }, { status });
}
