#!/usr/bin/env node
/**
 * RAPOR DİLİ · UÇTAN UCA (HTTP) — CANLIDA KANIT. HİÇBİR ŞEY YAZMAZ.
 *
 * Altı rapor ucunu GERÇEK HTTP üzerinden ölçer. Süreç içi koşum yapamaz:
 * PDF rotaları `.tsx` belge bileşenleri import ediyor ve bu depodaki test
 * koşumu JSX yükleyemiyor (scripts/ts-server.mjs sınırı). Kanıt bu yüzden
 * ağdan alınıyor — üstelik daha güçlü: gerçek sunucu, gerçek yanıt.
 *
 * Ölçülenler:
 *   1. Altı uçta `?dil=fr` → 400 `invalid_dil`
 *   2. Altı uçta `?dil=tr` ve `?dil=de` → 200
 *   3. PDF'lerin METİN KATMANI çıkarılıp karşı dilin sözcükleri aranıyor
 *      (karma çıktı varsa burada görünür)
 *   4. CSV'lerin başlık satırı iki dilde farklı
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-rapor-dil-http.mjs [taban]
 *   taban: varsayılan https://hak-transport-takip.vercel.app
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";

const TABAN = process.argv[2] ?? "https://hak-transport-takip.vercel.app";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const bilgi = (s) => console.log(`     ${s}`);

/** PDF metin katmanı — ham akıştaki Tj/TJ dizgeleri. */
function pdfMetni(buf) {
  const ham = buf.toString("latin1");
  const parcalar = [];
  for (const m of ham.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*T[jJ]/g)) parcalar.push(m[1]);
  for (const m of ham.matchAll(/\[((?:[^\][\\]|\\.)*)\]\s*TJ/g)) {
    for (const p of m[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)) parcalar.push(p[1]);
  }
  return parcalar
    .join(" ")
    .replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\([()\\])/g, "$1");
}

const ALMANCA = ["Mitarbeiter", "Zeitraum", "Erstellt", "Arbeitszeit", "Schicht", "Bericht", "Zugestellt", "Kennzeichen"];
const TURKCE = ["Personel", "Dönem", "Oluşturulma", "Çalışma", "Vardiya", "Rapor", "Teslim", "Plaka"];

console.log(`\n╔══ RAPOR DİLİ · UÇTAN UCA (HTTP) ════════════════════════════════`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ taban  ${TABAN}`);

try {
  const { data: patron } = await supabaseAdmin
    .from("workers").select("id, name, token_version")
    .eq("is_admin", true).eq("is_active", true).neq("is_test", true)
    .order("name").limit(1).maybeSingle();
  const token = (await issueTokens(patron.id, true, patron.token_version ?? 0)).accessToken;

  const { data: sofor } = await supabaseAdmin
    .from("workers").select("id").eq("is_active", true).eq("is_admin", false)
    .neq("is_test", true).order("name").limit(1).maybeSingle();

  /** Uç → dil parametresiz temel yol. */
  const UCLAR = [
    ["azg.pdf", "/api/mobile/reports/azg.pdf?ay=2026-07", "pdf"],
    ["schichtbericht.pdf", "/api/mobile/reports/schichtbericht.pdf?range=hafta", "pdf"],
    ["rapor.pdf", `/api/mobile/workers/${sofor?.id}/rapor.pdf?donem=hafta`, "pdf"],
    ["shifts.csv", "/api/mobile/reports/shifts.csv?range=hafta", "csv"],
    ["distance.csv", "/api/mobile/reports/distance.csv?range=hafta", "csv"],
    ["fuel.csv", "/api/mobile/reports/fuel.csv?range=hafta", "csv"],
  ];

  const cek = async (yol) =>
    fetch(`${TABAN}${yol}`, { headers: { authorization: `Bearer ${token}` } });

  // ══ 1. GEÇERSİZ DİL ═════════════════════════════════════════════════════
  console.log("\n── 1. GEÇERSİZ DİL → 400 ──");
  for (const [ad, yol] of UCLAR) {
    const res = await cek(`${yol}&dil=fr`);
    const j = await res.json().catch(() => null);
    iddia(`${ad.padEnd(20)} ?dil=fr → 400 invalid_dil`,
      res.status === 400 && j?.error === "invalid_dil",
      `${res.status} ${j?.error ?? ""} gecerli=${JSON.stringify(j?.gecerli ?? null)}`);
  }

  // ══ 2. İKİ DİLDE 200 + İÇ TUTARLILIK ════════════════════════════════════
  console.log("\n── 2. AYNI RAPOR · ?dil=tr vs ?dil=de ──");
  for (const [ad, yol, tur] of UCLAR) {
    const cikti = {};
    for (const dil of ["de", "tr"]) {
      const res = await cek(`${yol}&dil=${dil}`);
      if (res.status !== 200) {
        iddia(`${ad} ?dil=${dil} → 200`, false, `${res.status} ${(await res.text()).slice(0, 90)}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") ?? "";
      const metin =
        tur === "pdf"
          ? pdfMetni(buf)
          : buf.toString(/utf-16/i.test(ct) ? "utf16le" : "utf8").split("\n")[0];
      cikti[dil] = metin;
      iddia(`${ad.padEnd(20)} ?dil=${dil} → 200`, true, `${buf.length} bayt`);
    }
    for (const [dil, karsi, kendi] of [["de", TURKCE, ALMANCA], ["tr", ALMANCA, TURKCE]]) {
      const m = cikti[dil];
      if (!m) continue;
      const sizan = karsi.filter((w) => m.includes(w));
      const kendinden = kendi.filter((w) => m.includes(w));
      iddia(`   ${dil} · karşı dilin sözcüğü YOK`, sizan.length === 0,
        sizan.length ? "SIZAN: " + sizan.join(", ") : `${karsi.length} sözcük arandı, 0 bulundu`);
      iddia(`   ${dil} · kendi dilinin sözcükleri VAR`, kendinden.length > 0,
        kendinden.slice(0, 4).join(", ") || "hiçbiri");
    }
    if (cikti.de && cikti.tr) {
      iddia(`   iki dilin çıktısı FARKLI`, cikti.de !== cikti.tr, null);
      bilgi(`de: ${cikti.de.replace(/\s+/g, " ").slice(0, 96)}`);
      bilgi(`tr: ${cikti.tr.replace(/\s+/g, " ").slice(0, 96)}`);
    }
  }

  // ══ 3. DİLSİZ İSTEK = ESKİ DAVRANIŞ ═════════════════════════════════════
  console.log("\n── 3. ?dil VERİLMEZSE (geriye uyum) ──");
  for (const [ad, yol] of UCLAR) {
    const res = await cek(yol);
    iddia(`${ad.padEnd(20)} dilsiz → 200`, res.status === 200, `${res.status}`);
  }
} catch (e) {
  console.error("\n✗ BEKLENMEDİK HATA:", e?.message ?? e);
  console.error((e?.stack ?? "").split("\n").slice(0, 5).join("\n"));
  dusen++;
}

console.log(`\n╚══ düşen: ${dusen} ═══════════════════════════════════════════════\n`);
process.exit(dusen > 0 ? 1 : 0);
