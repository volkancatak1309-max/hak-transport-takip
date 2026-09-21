/**
 * QA PROXY — supabase-js'in beklediği yüzeyi yerel yığına bağlar.
 *
 * ═══ NEDEN VAR ═══
 *
 * `lib/supabase.ts` bir Supabase projesine bakıyor ve iki AYRI API konuşuyor:
 *   · `/rest/v1/*`     → PostgREST (tablolar)
 *   · `/storage/v1/*`  → Supabase Storage (dosyalar)
 *
 * Yerel Docker yığınında PostgREST var, Storage YOK. Bu proxy ikisini tek
 * kökte birleştirir: REST çağrılarını PostgREST'e iletir, Storage çağrılarını
 * DİSKTE karşılar.
 *
 * ⚠️ BU BİR ŞİM DEĞİL, BİR KÖPRÜ. Tablolar tarafında hiçbir şey taklit
 * edilmiyor: CHECK kısıtları, kısmi tekil indeksler, HK080 tetikleyicileri
 * GERÇEK PostgreSQL'de çalışıyor. Taklit edilen tek şey dosya deposudur ve
 * ölçtüğümüz kural orada değil.
 *
 * Kullanım:
 *   node scripts/qa-supabase-proxy.mjs            (:55433 dinler)
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55433
 */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.QA_PROXY_PORT ?? 55433);
const PGRST = process.env.QA_PGRST ?? "http://127.0.0.1:55434";
const JWT_SECRET =
  process.env.QA_JWT_SECRET ?? "hak61-qa-jwt-secret-en-az-32-karakter-uzunlugunda";
const KOK = process.env.QA_STORAGE_DIR ?? path.join(process.cwd(), ".qa-storage");

fs.mkdirSync(KOK, { recursive: true });

// ── service_role iddialı HS256 jeton ────────────────────────────────────────
const b64 = (o) =>
  Buffer.from(JSON.stringify(o)).toString("base64url");
function jeton() {
  const bas = b64({ alg: "HS256", typ: "JWT" });
  const gov = b64({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 86400 });
  const imza = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${bas}.${gov}`)
    .digest("base64url");
  return `${bas}.${gov}.${imza}`;
}
const TOKEN = jeton();

const govdeTopla = (req) =>
  new Promise((coz) => {
    const parcalar = [];
    req.on("data", (c) => parcalar.push(c));
    req.on("end", () => coz(Buffer.concat(parcalar)));
  });

const guvenliYol = (bolum) => {
  // `..` ile kovadan çıkmayı engelle — QA da olsa dosya sistemi gerçek.
  const temiz = bolum.split("/").filter((p) => p && p !== "." && p !== "..");
  return path.join(KOK, ...temiz);
};

const json = (res, kod, govde) => {
  const g = JSON.stringify(govde);
  res.writeHead(kod, { "content-type": "application/json", "content-length": Buffer.byteLength(g) });
  res.end(g);
};

const sunucu = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const yol = u.pathname;

  // ═══ STORAGE ═════════════════════════════════════════════════════════════
  if (yol.startsWith("/storage/v1/")) {
    const geri = yol.slice("/storage/v1/".length);

    // İMZALI URL (toplu):  POST object/sign/{kova}   {expiresIn, paths:[…]}
    if (req.method === "POST" && geri.startsWith("object/sign/")) {
      const kalan = geri.slice("object/sign/".length);
      const govde = JSON.parse((await govdeTopla(req)).toString() || "{}");
      if (Array.isArray(govde.paths)) {
        const kova = kalan;
        return json(
          res,
          200,
          govde.paths.map((p) => ({
            path: p,
            signedURL: `/object/sign/${kova}/${p}?token=qa`,
            error: fs.existsSync(guvenliYol(`${kova}/${p}`)) ? null : "not_found",
          }))
        );
      }
      // Tekil: object/sign/{kova}/{yol}
      return json(res, 200, { signedURL: `/object/sign/${kalan}?token=qa` });
    }

    // İNDİR: GET object/sign/{kova}/{yol}?token=…  ya da  object/{kova}/{yol}
    if (req.method === "GET") {
      const rel = geri.startsWith("object/sign/")
        ? geri.slice("object/sign/".length)
        : geri.startsWith("object/")
          ? geri.slice("object/".length)
          : null;
      if (rel) {
        const dosya = guvenliYol(rel);
        if (!fs.existsSync(dosya)) return json(res, 404, { error: "not_found" });
        const veri = fs.readFileSync(dosya);
        res.writeHead(200, { "content-length": veri.length });
        return res.end(veri);
      }
    }

    // YÜKLE: POST object/{kova}/{yol}
    if (req.method === "POST" && geri.startsWith("object/")) {
      const rel = geri.slice("object/".length);
      const dosya = guvenliYol(rel);
      if (fs.existsSync(dosya)) {
        // upsert:false karşılığı — supabase-js aynı hatayı döndürür.
        return json(res, 409, { error: "Duplicate", message: "The resource already exists" });
      }
      fs.mkdirSync(path.dirname(dosya), { recursive: true });
      fs.writeFileSync(dosya, await govdeTopla(req));
      return json(res, 200, { Key: rel });
    }

    // SİL: DELETE object/{kova}   {prefixes:[…]}
    if (req.method === "DELETE" && geri.startsWith("object/")) {
      const kova = geri.slice("object/".length);
      const govde = JSON.parse((await govdeTopla(req)).toString() || "{}");
      const silinen = [];
      for (const p of govde.prefixes ?? []) {
        const dosya = guvenliYol(`${kova}/${p}`);
        if (fs.existsSync(dosya)) {
          fs.unlinkSync(dosya);
          silinen.push({ name: p });
        }
      }
      return json(res, 200, silinen);
    }

    return json(res, 404, { error: "qa_proxy_storage_yolu_yok", yol });
  }

  // ═══ REST → PostgREST ════════════════════════════════════════════════════
  const geri = yol.startsWith("/rest/v1") ? yol.slice("/rest/v1".length) || "/" : yol;
  const hedef = `${PGRST}${geri}${u.search}`;
  const govde = ["GET", "HEAD"].includes(req.method) ? undefined : await govdeTopla(req);

  const basliklar = { ...req.headers };
  delete basliklar.host;
  delete basliklar["content-length"];
  delete basliklar.apikey;
  basliklar.authorization = `Bearer ${TOKEN}`;

  try {
    const y = await fetch(hedef, { method: req.method, headers: basliklar, body: govde });
    const metin = Buffer.from(await y.arrayBuffer());
    const cikis = {};
    y.headers.forEach((v, k) => {
      if (!["content-encoding", "transfer-encoding", "content-length"].includes(k)) cikis[k] = v;
    });
    res.writeHead(y.status, { ...cikis, "content-length": metin.length });
    res.end(metin);
  } catch (e) {
    json(res, 502, { error: "qa_proxy_upstream", ayrinti: String(e) });
  }
});

sunucu.listen(PORT, "127.0.0.1", () => {
  console.log(`QA proxy :${PORT} → PostgREST ${PGRST} · Storage ${KOK}`);
});
