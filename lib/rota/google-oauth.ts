import "server-only";
import { createSign } from "node:crypto";
import { SaglayiciHatasi } from "./tipler";

/**
 * GOOGLE SERVİS HESABI → OAuth erişim jetonu (JWT Bearer akışı, RFC 7523).
 *
 * ═══ NEDEN API ANAHTARI DEĞİL ═══
 *
 * Route Optimization API API anahtarı KABUL ETMİYOR: belge "include an OAuth
 * token with all API or SDK requests" diyor ve uç `cloud-platform` kapsamı +
 * `routeoptimization.locations.use` IAM izni istiyor (03.10.2026 okundu).
 * Bu yüzden `GOOGLE_ROTA_ANAHTARI` bir SERVİS HESABI JSON anahtarıdır.
 *
 * ⚠️ Anahtar YALNIZ sunucuda yaşar (`server-only`); jeton da öyle. İstemciye
 * ne anahtar ne jeton iner — `scripts/check-rota.mjs` derlenmiş istemci
 * paketinde bu dosyanın izini arar.
 *
 * Bağımlılık eklenmedi: imza `node:crypto` (RS256), istek düz `fetch`.
 */

export type ServisHesabi = {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri: string;
};

export const CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";
const VARSAYILAN_TOKEN_URI = "https://oauth2.googleapis.com/token";

/**
 * Env değerini çözer: düz JSON ya da base64 JSON (Vercel'e çok satırlı
 * yapıştırmak zahmetli; ikisi de kabul). Geçersizse null — anahtarı
 * loglamadan, sebebini söylemeden: hata mesajı sırrı taşıyabilirdi.
 */
export function servisHesabiCoz(ham: string | undefined | null): ServisHesabi | null {
  const s = (ham ?? "").trim();
  if (!s) return null;
  let metin = s;
  if (!s.startsWith("{")) {
    try {
      metin = Buffer.from(s, "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  try {
    const j = JSON.parse(metin) as Record<string, unknown>;
    if (j.type !== undefined && j.type !== "service_account") return null;
    if (
      typeof j.client_email !== "string" ||
      typeof j.private_key !== "string" ||
      typeof j.project_id !== "string"
    ) {
      return null;
    }
    return {
      client_email: j.client_email,
      // Env'e tek satır yapıştırılınca "\n" kaçışı metin olarak gelir.
      private_key: j.private_key.replace(/\\n/g, "\n"),
      project_id: j.project_id,
      token_uri: typeof j.token_uri === "string" ? j.token_uri : VARSAYILAN_TOKEN_URI,
    };
  } catch {
    return null;
  }
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** İmzalı JWT onayı — SAF (testler üretilmiş bir anahtarla doğruluyor). */
export function jwtImzala(sa: ServisHesabi, kapsam: string, simdiSn: number): string {
  const baslik = { alg: "RS256", typ: "JWT" };
  const iddialar = {
    iss: sa.client_email,
    scope: kapsam,
    aud: sa.token_uri,
    iat: simdiSn,
    exp: simdiSn + 3600,
  };
  const govde = `${b64url(JSON.stringify(baslik))}.${b64url(JSON.stringify(iddialar))}`;
  const imza = createSign("RSA-SHA256").update(govde).sign(sa.private_key);
  return `${govde}.${b64url(imza)}`;
}

/**
 * Süreç içi jeton önbelleği. Değer KİRACIYA ait (her kiracının ayrı dağıtımı
 * ve ayrı env'i var) — lib/tenant-settings.ts'teki önbelleğin aynı gerekçesi.
 */
let onbellek: { anahtar: string; jeton: string; bitisMs: number } | null = null;

export function jetonOnbelleginiDusur(): void {
  onbellek = null;
}

export async function erisimJetonu(sa: ServisHesabi, kapsam = CLOUD_PLATFORM): Promise<string> {
  const anahtar = `${sa.client_email}|${kapsam}`;
  if (onbellek && onbellek.anahtar === anahtar && onbellek.bitisMs - 60_000 > Date.now()) {
    return onbellek.jeton;
  }
  const onay = jwtImzala(sa, kapsam, Math.floor(Date.now() / 1000));
  let res: Response;
  try {
    res = await fetch(sa.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: onay,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new SaglayiciHatasi("erisilemedi", `oauth: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }
  if (!res.ok) {
    // 400 invalid_grant / 401 — anahtar iptal edilmiş, saat kaymış ya da hesap yok.
    throw new SaglayiciHatasi(res.status >= 500 ? "erisilemedi" : "yetkisiz", `oauth HTTP ${res.status}`);
  }
  const j = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!j?.access_token) throw new SaglayiciHatasi("gecersiz_cevap", "oauth: access_token yok");
  onbellek = {
    anahtar,
    jeton: j.access_token,
    bitisMs: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
  return j.access_token;
}
