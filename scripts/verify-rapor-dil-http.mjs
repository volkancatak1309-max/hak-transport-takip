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
import zlib from "node:zlib";
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";

const TABAN = process.argv[2] ?? "https://hak-transport-takip.vercel.app";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const bilgi = (s) => console.log(`     ${s}`);

/**
 * PDF METİN ÇIKARICI — ToUnicode CMap üzerinden.
 *
 * ⚠️ Ham `(...)Tj` toplamak BU belgelerde İŞE YARAMAZ: react-pdf gömülü
 * ALT-KÜME font kullanıyor, metin `<hex>` glif kodlarıyla yazılıyor. Doğru
 * yol, akıştaki ToUnicode CMap'ini okuyup glif→karakter eşlemesini kurmak
 * (scripts/verify-rapor-pdf-tur3.mjs'te kanıtlanmış yöntemin aynısı).
 */
function akislar(buf) {
  const raw = buf.toString("latin1");
  const out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const b = m.index + m[0].length;
    const s = raw.indexOf("endstream", b);
    if (s < 0) continue;
    try {
      out.push(zlib.inflateSync(buf.subarray(b, s)).toString("latin1"));
    } catch {
      /* sıkıştırılmamış akış — metin taşımıyor */
    }
  }
  return out;
}
function pdfMetni(buf) {
  const st = akislar(buf);
  const harita = new Map();
  for (const a of st) {
    if (!/begincmap/.test(a)) continue;
    for (const l of a.split(/\r?\n/)) {
      // ⚠️ Çok kod-noktalı (ligatür) değer BOŞLUKLA ayrılır: <0047><0074 0074>
      const mm = l.match(/^<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f\s]+)>$/);
      if (!mm) continue;
      harita.set(
        parseInt(mm[1], 16),
        String.fromCodePoint(...mm[2].trim().split(/\s+/).map((h) => parseInt(h, 16)))
      );
    }
  }
  let metin = "";
  let eslenmeyen = 0;
  for (const a of st) {
    if (!/\bTj\b|\bTJ\b/.test(a)) continue;
    for (const hx of a.match(/<[0-9A-Fa-f]{4,}>/g) ?? []) {
      const h = hx.slice(1, -1);
      for (let i = 0; i + 4 <= h.length; i += 4) {
        const g = parseInt(h.slice(i, i + 4), 16);
        if (harita.has(g)) metin += harita.get(g);
        else {
          metin += "�";
          eslenmeyen++;
        }
      }
    }
  }
  const raw = buf.toString("latin1");
  return {
    metin,
    eslenmeyen,
    sayfa: Math.max(0, ...(raw.match(/\/Count\s+\d+/g) ?? []).map((x) => +x.replace(/\D/g, ""))),
    baseFont: [...new Set(raw.match(/\/BaseFont\s*\/[A-Za-z0-9+#,._-]+/g) ?? [])],
    gomulu: /\/FontFile2/.test(raw),
    helvetica: /Helvetica/.test(raw),
  };
}

/** Yalniz metin — Tur 3'un cikarici gövdesi aynen kullaniliyor. */
function pdfMetniDuz(buf) {
  return pdfMetni(buf).metin;
}

const ALMANCA = ["Mitarbeiter", "Zeitraum", "Erstellt", "Arbeitszeit", "Schicht", "Bericht", "Zugestellt", "Kennzeichen"];
const TURKCE = ["Personel", "Dönem", "Oluşturulma", "Çalışma", "Vardiya", "Rapor", "Teslim", "Plaka"];
const INGILIZCE = ["Employee", "Period", "Created", "Shift", "Report", "Delivered", "Plate", "Driver"];

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
    const res = await cek(`${yol}&dil=es`);
    const j = await res.json().catch(() => null);
    iddia(`${ad.padEnd(20)} ?dil=es → 400 invalid_dil`,
      res.status === 400 && j?.error === "invalid_dil",
      `${res.status} ${j?.error ?? ""} gecerli=${JSON.stringify(j?.gecerli ?? null)}`);
  }

  // ══ 2. İKİ DİLDE 200 + İÇ TUTARLILIK ════════════════════════════════════
  console.log("\n── 2. AYNI RAPOR · ?dil=tr vs ?dil=de ──");
  for (const [ad, yol, tur] of UCLAR) {
    const cikti = {};
    for (const dil of ["de", "tr", "en"]) {
      const res = await cek(`${yol}&dil=${dil}`);
      if (res.status !== 200) {
        iddia(`${ad} ?dil=${dil} → 200`, false, `${res.status} ${(await res.text()).slice(0, 90)}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") ?? "";
      const metin =
        tur === "pdf"
          ? pdfMetniDuz(buf)
          : buf.toString(/utf-16/i.test(ct) ? "utf16le" : "utf8").split("\n")[0];
      cikti[dil] = metin;
      iddia(`${ad.padEnd(20)} ?dil=${dil} → 200`, true, `${buf.length} bayt`);
    }
    for (const [dil, karsi, kendi] of [
      ["de", TURKCE, ALMANCA],
      ["tr", ALMANCA, TURKCE],
      ["en", [...ALMANCA, ...TURKCE], INGILIZCE],
    ]) {
      const m = cikti[dil];
      if (!m) continue;
      const sizan = karsi.filter((w) => m.includes(w));
      const kendinden = kendi.filter((w) => m.includes(w));
      iddia(`   ${dil} · karşı dilin sözcüğü YOK`, sizan.length === 0,
        sizan.length ? "SIZAN: " + sizan.join(", ") : `${karsi.length} sözcük arandı, 0 bulundu`);
      iddia(`   ${dil} · kendi dilinin sözcükleri VAR`, kendinden.length > 0,
        kendinden.slice(0, 4).join(", ") || "hiçbiri");
    }
    // ⚠️ AZG İHLAL TABLOSU · TÜR SÜTUNU (21.08.2026 regresyonu).
    // "Art" başlığı üç dilde de Almanca kalmıştı: diğer başlıklar etiket
    // kümesinden geliyordu, bu biri sabit dizeydi ve göze çarpmadı. Genel
    // sözcük taraması onu YAKALAYAMAZ (kısa, tek sözcük) — bu yüzden ayrı
    // ve ADI GEÇEN bir iddia.
    if (ad === "azg.pdf" && cikti.de && cikti.tr && cikti.en) {
      const beklenen = { de: "Art", tr: "Tür", en: "Type" };
      for (const dil of ["de", "tr", "en"]) {
        iddia(`   ${dil} · ihlal tablosu TÜR sütunu = "${beklenen[dil]}"`,
          cikti[dil].includes(beklenen[dil]), null);
      }
      iddia("   TR/EN'de Almanca \"Art\" başlığı KALMADI",
        !/(^|[^a-zA-ZäöüßÄÖÜ])Art([^a-zA-ZäöüßÄÖÜ]|$)/.test(cikti.tr) &&
        !/(^|[^a-zA-ZäöüßÄÖÜ])Art([^a-zA-ZäöüßÄÖÜ]|$)/.test(cikti.en), null);
    }

    if (cikti.de && cikti.tr && cikti.en) {
      iddia(`   üç dilin çıktısı da FARKLI`,
        new Set([cikti.de, cikti.tr, cikti.en]).size === 3, null);
      bilgi(`de: ${cikti.de.replace(/\s+/g, " ").slice(0, 96)}`);
      bilgi(`tr: ${cikti.tr.replace(/\s+/g, " ").slice(0, 96)}`);
      bilgi(`en: ${cikti.en.replace(/\s+/g, " ").slice(0, 96)}`);
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
