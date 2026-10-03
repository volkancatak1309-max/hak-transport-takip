#!/usr/bin/env node
/**
 * ROTA VEKİLİ — VROOM + OSRM'in önündeki kimlik doğrulayan ince kapı.
 *
 * ═══ NEDEN VAR ═══
 *
 * Rota motoru (galzura-brain `rota-motoru-osrm-vroom.md`, 18.07.2026 kurulumu)
 * Hetzner'de YALNIZ localhost'ta: OSRM 127.0.0.1:5000, VROOM 127.0.0.1:3000.
 * İkisinin de kimlik doğrulaması YOK. Panel Vercel'de koşuyor ve onlara
 * ulaşamıyor. Takograf servisinin deseni aynen uygulanıyor:
 *
 *   panel ──HTTPS──► Cloudflare (Fleet tüneli "galzura-fleet")
 *         ──► rota.galzura.com ──► bu vekil 127.0.0.1:8796 ──► VROOM / OSRM
 *
 * Vekil üç şey yapar, başka hiçbir şey yapmaz:
 *   1. KİMLİK: `Authorization: Bearer <ROTA_VEKIL_SIRRI>`, sabit süreli
 *      karşılaştırma. Sır tanımsız ya da kısaysa vekil BAŞLAMAZ (fail-closed).
 *   2. DAR KAPI: yalnız `POST /vroom` ve `GET /osrm/{route|nearest|table}/v1/
 *      driving/<koordinat>` + bilinen OSRM parametreleri. Başka her yol 404.
 *   3. SINIR: gövde ≤ 1 MB (VROOM'un kendi `limit: 1mb`i), aynı anda ≤ 8 istek.
 *
 * ═══ NE LOGLANMAZ ═══
 *
 * Gövde (durak koordinatları), sorgu dizgisi ve OSRM yolundaki koordinatlar
 * ASLA yazılmaz. Satır başına yalnız: zaman, yöntem, yol ÖNEKİ, durum, süre.
 * (Takograf servisinin "gövde loglanmaz" kuralı.)
 *
 * Bağımlılık yok — sunucudaki Node 24 (03.10.2026 ölçümü: v24.14.1) yeter.
 * Kurulum: docs/rota-optimizasyonu.md §5.
 */
import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const SIR = process.env.ROTA_VEKIL_SIRRI ?? "";
const PORT = Number(process.env.ROTA_VEKIL_PORT ?? 8796);
const HOST = process.env.ROTA_VEKIL_HOST ?? "127.0.0.1";
const VROOM = (process.env.VROOM_HEDEF ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const OSRM = (process.env.OSRM_HEDEF ?? "http://127.0.0.1:5000").replace(/\/+$/, "");

const AZAMI_GOVDE = 1_000_000;
const AZAMI_ESZAMANLI = 8;
const ZAMAN_ASIMI_MS = 60_000;

if (SIR.length < 32) {
  console.error(
    "ROTA_VEKIL_SIRRI tanımsız ya da 32 karakterden kısa — vekil BAŞLAMAZ. " +
      "Üretmek için: openssl rand -hex 32"
  );
  process.exit(1);
}
const SIR_BAYT = Buffer.from(SIR);

function yetkili(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  if (!m) return false;
  const gelen = Buffer.from(m[1]);
  return gelen.length === SIR_BAYT.length && timingSafeEqual(gelen, SIR_BAYT);
}

const OSRM_YOL = /^\/osrm\/(route|nearest|table)\/v1\/driving\/[-0-9.,;]+$/;
const OSRM_PARAM = new Set([
  "overview",
  "geometries",
  "steps",
  "annotations",
  "alternatives",
  "continue_straight",
  "radiuses",
  "sources",
  "destinations",
  "number",
  "skip_waypoints",
]);

let eszamanli = 0;

function cevapla(res, kod, govde) {
  res.writeHead(kod, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(govde));
}

/** Motora ilet — yalnız http (motorlar localhost'ta). */
function ilet(hedef, yontem, govde, res) {
  const u = new URL(hedef);
  const istek = http.request(
    {
      host: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: yontem,
      headers: govde
        ? { "Content-Type": "application/json", "Content-Length": govde.length }
        : {},
      timeout: ZAMAN_ASIMI_MS,
    },
    (cevap) => {
      res.writeHead(cevap.statusCode ?? 502, {
        "Content-Type": cevap.headers["content-type"] ?? "application/json",
        "Cache-Control": "no-store",
      });
      cevap.pipe(res);
    }
  );
  istek.on("timeout", () => istek.destroy(new Error("zaman_asimi")));
  istek.on("error", () => {
    if (!res.headersSent) cevapla(res, 502, { hata: "motor_erisilemedi" });
    else res.destroy();
  });
  istek.end(govde ?? undefined);
}

const sunucu = http.createServer((req, res) => {
  const bas = Date.now();
  const u = new URL(req.url ?? "/", "http://vekil");
  // Yol ÖNEKİ: "/osrm/route" — koordinatlar ve sorgu dizgisi log'a girmez.
  const onek = u.pathname.startsWith("/osrm/")
    ? u.pathname.split("/").slice(0, 3).join("/")
    : u.pathname.slice(0, 32);
  res.on("finish", () => {
    console.log(
      JSON.stringify({ t: new Date().toISOString(), m: req.method, yol: onek, kod: res.statusCode, ms: Date.now() - bas })
    );
  });

  if (req.method === "GET" && u.pathname === "/health") return cevapla(res, 200, { ok: true });
  if (!yetkili(req)) return cevapla(res, 401, { hata: "yetkisiz" });

  const vroomMu = req.method === "POST" && u.pathname === "/vroom";
  const osrmMu = req.method === "GET" && OSRM_YOL.test(u.pathname);
  if (!vroomMu && !osrmMu) return cevapla(res, 404, { hata: "yok" });

  if (osrmMu) {
    for (const k of u.searchParams.keys()) {
      if (!OSRM_PARAM.has(k)) return cevapla(res, 400, { hata: "izinsiz_parametre" });
    }
  }

  if (eszamanli >= AZAMI_ESZAMANLI) return cevapla(res, 503, { hata: "mesgul" });
  eszamanli++;
  res.on("close", () => {
    eszamanli--;
  });

  if (osrmMu) {
    return ilet(`${OSRM}${u.pathname.slice("/osrm".length)}${u.search}`, "GET", null, res);
  }

  let boy = 0;
  const parcalar = [];
  req.on("data", (p) => {
    boy += p.length;
    if (boy > AZAMI_GOVDE) {
      if (!res.headersSent) cevapla(res, 413, { hata: "govde_buyuk" });
      req.destroy();
      return;
    }
    parcalar.push(p);
  });
  req.on("end", () => {
    if (res.headersSent) return;
    ilet(`${VROOM}/`, "POST", Buffer.concat(parcalar), res);
  });
});

sunucu.listen(PORT, HOST, () => {
  console.log(`rota-vekil ${HOST}:${PORT} → vroom ${VROOM} · osrm ${OSRM}`);
});
