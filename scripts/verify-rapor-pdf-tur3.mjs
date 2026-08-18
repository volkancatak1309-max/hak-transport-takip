#!/usr/bin/env node
/**
 * AZG + SCHICHTBERICHT PDF UÇLARI — CANLIDA KANIT.
 *
 * ⚠️ İKİSİ DE RESMÎ EVRAK. Bir müfettişin okuyacağı Almanca doküman; hata payı
 * sıfır. Bu yüzden "PDF üretildi mi" yetmez, ÜÇ AYRI eksende kanıt aranır:
 *
 *   ① METİN EŞDEĞERLİĞİ — sunucu belgesinin metin katmanı çıkarılıp panelin
 *     bileşeninden ÇIKARILAN Almanca dizelerle karşılaştırılır. Göz kararı
 *     DEĞİL: iki `.tsx` dosyasından dize kümeleri ayıklanıp küme farkı alınır,
 *     yani bir § maddesi ya da bir kelime değişmişse ölçüm düşer.
 *   ② VERİ EŞDEĞERLİĞİ — hesabın döndürdüğü her ihlal satırının tarihi,
 *     çalışanı ve hukuki dayanağı belgede GERÇEKTEN basılı mı.
 *   ③ GLİF — ß/ö/ü/ä gömülü fontla mı, ToUnicode tam mı (aranabilir/
 *     kopyalanabilir belge).
 *
 * ── NEDEN HTTP ÜZERİNDEN ──────────────────────────────────────────────────
 * Belge bileşenleri `.tsx`; Node'un tip-soyması JSX'i DÖNÜŞTÜRMEZ, harness bu
 * route'ları içe aktaramaz. Ölçüm derlenmiş üretim build'ine (`next start`)
 * yapılır — paketleme ve font izleme de ölçüme dahil olur.
 *
 * KULLANIM:
 *   1) npm run build && npx next start -p 3101
 *   2) node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *           --import ./scripts/ts-server.mjs scripts/verify-rapor-pdf-tur3.mjs
 *   Taban adres: PDF_QA_BASE (varsayılan http://127.0.0.1:3101)
 *
 * ── ⚠️ CANLI VERİTABANI ───────────────────────────────────────────────────
 * HİÇBİR ŞEY YAZMAZ.
 */
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { buildAZGReport } from "@/lib/azg-report";
import { loadRangeShifts } from "@/lib/report-shifts";
import { computeAnalyticsRange } from "@/lib/analytics";
import { buildShiftReportRow, REPORT_EMPTY, SHIFT_REPORT_DE } from "@/lib/report-de";
import { PDF_WATERMARK, EXPORT_ENABLED } from "@/lib/tenant";

const BASE = process.env.PDF_QA_BASE ?? "http://127.0.0.1:3101";
/** Kıyas penceresi — tamamı geçmişte (açık vardiya yok, veri sabit). */
const PENCERE = { from: "2026-08-01", to: "2026-08-10" };

let dusen = 0;
let olculmeyen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const olculmedi = (b, s) => {
  console.log(`  ○ ${b}  —  ÖLÇÜLMEDİ (${s})`);
  olculmeyen++;
};
const bilgi = (s) => console.log(`     ${s}`);

async function al(yol, token) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}${yol}`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
  const buf = Buffer.from(await r.arrayBuffer());
  return {
    status: r.status,
    ct: r.headers.get("content-type"),
    cd: r.headers.get("content-disposition"),
    cc: r.headers.get("cache-control"),
    ms: Date.now() - t0,
    buf,
    json: () => {
      try {
        return JSON.parse(buf.toString("utf8"));
      } catch {
        return null;
      }
    },
  };
}

// ── PDF METİN ÇIKARICI (ToUnicode üzerinden, ligatür dahil) ────────────────
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

/**
 * Bir `.tsx` dosyasından ALMANCA GÖRÜNEN dizeleri ayıklar.
 *
 * Amaç panel ile sunucu ikizinin metin kümelerini karşılaştırmak. Stil
 * değerleri (renk kodu, yüzde, sayı) ve teknik anahtarlar elenir; geriye
 * belgeye BASILAN cümleler kalır.
 */
function almancaDizeler(dosya) {
  const src = readFileSync(dosya, "utf8");
  // Yorum bloklarını at — açıklamalar belgeye basılmıyor.
  const kod = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const cikan = new Set();
  for (const m of kod.matchAll(/"([^"\\\n]{2,})"/g)) {
    const s = m[1].trim();
    if (!s) continue;
    if (/^#[0-9a-fA-F]{3,8}$/.test(s)) continue;      // renk
    if (/^[\d.,%\s]+$/.test(s)) continue;              // ölçü
    if (/^@\//.test(s) || /^[a-z-]+$/.test(s)) continue; // import yolu / css anahtarı
    if (s === "use client" || s === "server-only") continue; // derleyici direktifi, belgeye basılmaz
    if (/^(row|column|center|bold|flex-|space-|absolute|A4|landscape)/.test(s)) continue;
    // Almanca/belge metni: en az bir boşluk ya da Almanca özel karakter
    if (!/\s/.test(s) && !/[äöüßÄÖÜ§]/.test(s)) continue;
    cikan.add(s);
  }
  return cikan;
}

console.log(`\n╔══ AZG + SCHICHTBERICHT PDF · CANLIDA KANIT ══════════════════════`);
console.log(`║ an    ${new Date().toISOString()}`);
console.log(`║ taban ${BASE}`);
console.log(`║ bayraklar: EXPORT_ENABLED=${EXPORT_ENABLED} · PDF_WATERMARK=${PDF_WATERMARK ? `"${PDF_WATERMARK}"` : "(boş)"}`);

try {
  const { data: adminler } = await supabaseAdmin
    .from("workers").select("id, name, token_version")
    .eq("is_admin", true).eq("is_active", true).order("name");
  const patron = (adminler ?? [])[0];
  const patron2 = (adminler ?? [])[1] ?? null;
  const { data: sofor } = await supabaseAdmin
    .from("workers").select("id, name, token_version")
    .eq("is_admin", false).eq("is_active", true).is("managed_fleet", null)
    .order("name").limit(1).maybeSingle();
  const { data: sefler } = await supabaseAdmin
    .from("workers").select("id, name, token_version")
    .not("managed_fleet", "is", null).eq("is_admin", false).eq("is_active", true)
    .order("name").limit(1);
  const sef = (sefler ?? [])[0] ?? null;
  if (!patron) { console.error("✗ yönetici yok"); process.exit(1); }

  const tok = async (w, adm) => (await issueTokens(w.id, adm, w.token_version ?? 0)).accessToken;
  const patronToken = await tok(patron, true);
  const patron2Token = patron2 ? await tok(patron2, true) : null;
  const soforToken = sofor ? await tok(sofor, false) : null;
  const sefToken = sef ? await tok(sef, false) : null;

  const on = await fetch(`${BASE}/api/mobile/driver-scores`).catch(() => null);
  if (!on) {
    console.error(`✗ ${BASE} yanıt vermiyor — önce: npm run build && npx next start -p 3101`);
    process.exit(1);
  }

  // En yoğun ay: vardiya sayısı en büyük olan takvim ayı
  const { data: tumEntries } = await supabaseAdmin
    .from("time_entries").select("started_at").not("ended_at", "is", null);
  const ayla = new Map();
  for (const e of tumEntries ?? []) {
    const k = String(e.started_at).slice(0, 7);
    ayla.set(k, (ayla.get(k) ?? 0) + 1);
  }
  const enYogunAy = [...ayla.entries()].sort((a, b) => b[1] - a[1])[0];
  console.log(`║ en yoğun ay: ${enYogunAy?.[0]} (${enYogunAy?.[1]} kapanmış vardiya)\n`);

  const AZG_YOL = `/api/mobile/reports/azg.pdf?ay=${enYogunAy[0]}`;
  const SB_YOL = `/api/mobile/reports/schichtbericht.pdf?range=ozel&from=${PENCERE.from}&to=${PENCERE.to}`;

  // ══ 1. KAPI ══════════════════════════════════════════════════════════════
  console.log("── 1. KAPI ──");
  for (const [ad, yol] of [["azg.pdf", AZG_YOL], ["schichtbericht.pdf", SB_YOL]]) {
    const a = await al(yol, null);
    iddia(`${ad} · token yok → 401`, a.status === 401 && a.json()?.error === "missing_token", `${a.status}`);
    const b = await al(yol, "kesinlikle-gecersiz");
    iddia(`${ad} · bozuk token → 401`, b.status === 401, `${b.status}`);
    if (soforToken) {
      const c = await al(yol, soforToken);
      iddia(`${ad} · ŞOFÖR → 403 admin_required`, c.status === 403 && c.json()?.error === "admin_required", `${c.status} ${c.json()?.error}`);
    } else olculmedi(`${ad} · şoför → 403`, "şoför yok");
    if (sefToken) {
      const d = await al(yol, sefToken);
      iddia(`${ad} · FİLO ŞEFİ → 403 admin_required`, d.status === 403 && d.json()?.error === "admin_required", `${d.status} ${d.json()?.error}`);
    } else olculmedi(`${ad} · şef → 403`, "şef yok");
  }
  {
    const a = await al("/api/mobile/reports/azg.pdf?ay=2026-13", patronToken);
    iddia("azg · ay=2026-13 → 400 invalid_ay", a.status === 400 && a.json()?.error === "invalid_ay", `${a.status} ${a.json()?.error}`);
    const b = await al("/api/mobile/reports/azg.pdf?range=ay", patronToken);
    iddia("azg · range= verilirse → 400 range_not_supported", b.status === 400 && b.json()?.error === "range_not_supported", `${b.status} ${b.json()?.error}`);
    const c = await al("/api/mobile/reports/azg.pdf", patronToken);
    iddia("azg · ay yoksa → 400 invalid_ay (sessiz varsayılan YOK)", c.status === 400 && c.json()?.error === "invalid_ay", `${c.status}`);
    const d = await al("/api/mobile/reports/schichtbericht.pdf?range=aylik", patronToken);
    iddia("schichtbericht · range=aylik → 400 invalid_range", d.status === 400 && d.json()?.error === "invalid_range", `${d.status}`);
  }

  // ══ 2. SÖZLEŞME + HACİM ══════════════════════════════════════════════════
  console.log("\n── 2. SÖZLEŞME + HACİM ──");
  const azg = await al(AZG_YOL, patronToken);
  const sb = await al(SB_YOL, patronToken);
  for (const [ad, r, onEk] of [["azg.pdf", azg, "HAK_AZG_"], ["schichtbericht.pdf", sb, "-schichtbericht-"]]) {
    iddia(`${ad} · 200 + application/pdf`, r.status === 200 && r.ct === "application/pdf", `${r.status} ${r.ct}`);
    iddia(`${ad} · attachment + filename*`, /^attachment;/.test(r.cd ?? "") && (r.cd ?? "").includes(onEk) && /filename\*=UTF-8''/.test(r.cd ?? ""), r.cd);
    iddia(`${ad} · cache-control no-store`, /no-store/.test(r.cc ?? ""), r.cc);
    iddia(`${ad} · gövde gerçek PDF`, r.buf.subarray(0, 5).toString() === "%PDF-", r.buf.subarray(0, 8).toString());
  }
  const azgC = pdfMetni(azg.buf);
  const sbC = pdfMetni(sb.buf);
  bilgi(`azg.pdf           : ${azg.buf.length} bayt · ${azgC.sayfa} sayfa · uçtan uca ${azg.ms} ms`);
  bilgi(`schichtbericht.pdf: ${sb.buf.length} bayt · ${sbC.sayfa} sayfa · uçtan uca ${sb.ms} ms`);
  iddia("azg · 300 sn tavanının çok altında", azg.ms < 30_000, `${azg.ms} ms`);
  iddia("schichtbericht · 300 sn tavanının çok altında", sb.ms < 30_000, `${sb.ms} ms`);

  // ══ 3. FONT + GLİF ═══════════════════════════════════════════════════════
  console.log("\n── 3. FONT + GLİF ──");
  for (const [ad, c] of [["azg.pdf", azgC], ["schichtbericht.pdf", sbC]]) {
    iddia(`${ad} · gömülü font akışı (FontFile2)`, c.gomulu);
    iddia(`${ad} · Geist alt kümesi`, c.baseFont.some((b) => /Geist/.test(b)), c.baseFont.join(", "));
    iddia(`${ad} · Helvetica'ya DÜŞMEMİŞ`, !c.helvetica);
    iddia(`${ad} · ToUnicode TAM (çözülemeyen glif yok)`, c.eslenmeyen === 0, `eşlenmeyen=${c.eslenmeyen}`);
  }
  {
    // Almanca özel karakterler GERÇEKTEN basılı mı (belge Almanca).
    const hedef = ["ß", "ö", "ü", "ä", "§"];
    const azgVar = hedef.filter((x) => azgC.metin.includes(x));
    iddia("azg · ß ö ü ä § hepsi belgede", azgVar.length === hedef.length, azgVar.join(" "));
    const sbHedef = ["ä", "ö", "ü"];
    const sbVar = sbHedef.filter((x) => sbC.metin.includes(x));
    iddia("schichtbericht · ä ö ü belgede", sbVar.length === sbHedef.length, sbVar.join(" "));
  }

  // ══ 4. ① METİN EŞDEĞERLİĞİ — panel bileşeni ↔ sunucu ikizi ═══════════════
  console.log("\n── 4. METİN EŞDEĞERLİĞİ (panel .tsx ↔ sunucu .tsx) ──");
  for (const [ad, panelDosya, sunucuDosya] of [
    ["AZG", "components/pdf/AZGReport.tsx", "components/pdf/server/AZGDoc.tsx"],
    ["Schichtbericht", "components/pdf/ShiftReport.tsx", "components/pdf/server/SchichtberichtDoc.tsx"],
  ]) {
    const p = almancaDizeler(panelDosya);
    const s = almancaDizeler(sunucuDosya);
    const eksik = [...p].filter((x) => !s.has(x));
    const fazla = [...s].filter((x) => !p.has(x));
    iddia(`${ad} · panelin HER Almanca dizesi sunucu ikizinde var`, eksik.length === 0, eksik.length ? JSON.stringify(eksik).slice(0, 300) : `${p.size} dize`);
    iddia(`${ad} · sunucu ikizinde FAZLADAN belge dizesi yok`, fazla.length === 0, fazla.length ? JSON.stringify(fazla).slice(0, 300) : "yok");
  }

  // ══ 5. ② VERİ EŞDEĞERLİĞİ ════════════════════════════════════════════════
  console.log("\n── 5. VERİ EŞDEĞERLİĞİ (hesap → belge) ──");
  {
    const sonuc = await buildAZGReport(enYogunAy[0]);
    iddia("azg · hesap ok", sonuc.ok, sonuc.ok ? null : sonuc.error);
    if (sonuc.ok) {
      const d = sonuc.data;
      bilgi(`hesap: ${d.totalShifts} vardiya · ${d.totalWorkers} çalışan · ${d.violations.length} ihlal satırı · ${d.perWorker.length} özet satırı · ${d.suspicious.length} şüpheli`);
      for (const [alan, deger] of [
        ["totalShifts", d.totalShifts], ["totalWorkers", d.totalWorkers],
        ["warningCount", d.warningCount], ["violationCount", d.violationCount],
        ["seriousCount", d.seriousCount],
      ]) iddia(`azg · ${alan}=${deger} belgede`, azgC.metin.includes(String(deger)));
      iddia("azg · ay etiketi belgede", azgC.metin.includes(d.monthLabel), d.monthLabel);
      const eksikAd = d.perWorker.filter((w) => !azgC.metin.includes(w.name));
      iddia("azg · HER çalışan adı özet tablosunda", eksikAd.length === 0, eksikAd.map((w) => w.name).join(", ") || `${d.perWorker.length} ad`);
      const refler = [...new Set(d.violations.map((v) => v.legalRef))];
      const eksikRef = refler.filter((r) => !azgC.metin.includes(r));
      iddia("azg · HER § hukuki dayanağı belgede", eksikRef.length === 0, eksikRef.join(" | ") || refler.join(" · "));
      const tipler = [...new Set(d.violations.map((v) => v.type))];
      const eksikTip = tipler.filter((x) => !azgC.metin.includes(x));
      iddia("azg · HER ihlal türü belgede", eksikTip.length === 0, eksikTip.join(" | ") || `${tipler.length} tür`);
      const saatler = [...new Set(d.perWorker.map((w) => w.totalHours))];
      const eksikSaat = saatler.filter((h) => !azgC.metin.includes(h));
      iddia("azg · HER 'Stunden gesamt' değeri belgede (virgüllü de-AT)", eksikSaat.length === 0, eksikSaat.join(" ") || `${saatler.length} değer`);
    }
  }
  {
    const range = computeAnalyticsRange("ozel", PENCERE.from, PENCERE.to);
    const { entries, workerMap } = await loadRangeShifts(range);
    const rows = entries.map((e) => buildShiftReportRow(e, workerMap.get(e.worker_id)?.name ?? REPORT_EMPTY));
    bilgi(`schichtbericht: ${rows.length} satır (${PENCERE.from} → ${PENCERE.to})`);
    iddia("schichtbericht · başlık künyesi belgede", sbC.metin.includes(SHIFT_REPORT_DE.title) && sbC.metin.includes(SHIFT_REPORT_DE.footer), SHIFT_REPORT_DE.title);
    const adlar = [...new Set(rows.map((r) => r.worker))];
    const eksikAd = adlar.filter((a) => !sbC.metin.includes(a));
    iddia("schichtbericht · HER çalışan adı belgede", eksikAd.length === 0, eksikAd.join(", ") || `${adlar.length} ad`);
    const plakalar = [...new Set(rows.map((r) => r.plate))].filter((p) => p && p !== REPORT_EMPTY);
    const eksikPl = plakalar.filter((p) => !sbC.metin.includes(p));
    iddia("schichtbericht · HER plaka belgede", eksikPl.length === 0, eksikPl.join(", ") || `${plakalar.length} plaka`);
    // Satır bütünlüğü: rastgele değil, İLK 25 satırın tüm hücreleri
    const ornek = rows.slice(0, 25);
    const kayip = [];
    for (const r of ornek)
      for (const [k, v] of Object.entries(r))
        if (v && v !== REPORT_EMPTY && !sbC.metin.includes(String(v))) kayip.push(`${k}=${v}`);
    iddia("schichtbericht · ilk 25 satırın TÜM hücreleri belgede", kayip.length === 0, kayip.slice(0, 5).join(" | ") || `${ornek.length}×11 hücre`);
  }

  // ══ 6. FİLİGRAN ÇAPRAZ SIZMA ═════════════════════════════════════════════
  console.log("\n── 6. FİLİGRAN · çapraz sızma ──");
  if (!PDF_WATERMARK) {
    olculmedi("filigran kimliği", "PDF_WATERMARK boş — bayraklı build ile ölçülür");
    iddia("filigran kapalıyken belgede filigran metni yok", !/QA|WATERMARK/i.test(azgC.metin));
  } else if (!patron2Token) {
    olculmedi("çapraz sızma", "ikinci yönetici yok");
  } else {
    let capraz = 0;
    for (let i = 0; i < 4; i++) {
      const [a, b] = await Promise.all([al(SB_YOL, patronToken), al(SB_YOL, patron2Token)]);
      const ma = pdfMetni(a.buf).metin;
      const mb = pdfMetni(b.buf).metin;
      if (!(ma.includes(patron.name) && !ma.includes(patron2.name))) capraz++;
      if (!(mb.includes(patron2.name) && !mb.includes(patron.name))) capraz++;
    }
    iddia("schichtbericht · 4 eşzamanlı turda ÇAPRAZ SIZMA yok", capraz === 0, `sızan: ${capraz}`);
    const [a2, b2] = await Promise.all([al(AZG_YOL, patronToken), al(AZG_YOL, patron2Token)]);
    const m1 = pdfMetni(a2.buf).metin;
    const m2 = pdfMetni(b2.buf).metin;
    iddia("azg · eşzamanlı iki istekte filigran doğru kişide", m1.includes(patron.name) && !m1.includes(patron2.name) && m2.includes(patron2.name) && !m2.includes(patron.name));
  }

  // ══ 7. HACİM ÖLÇEĞİ (süperdoğrusal risk) ═════════════════════════════════
  console.log("\n── 7. HACİM ÖLÇEĞİ ──");
  {
    const aylar = [...ayla.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [k, n] of aylar) {
      const r = await al(`/api/mobile/reports/azg.pdf?ay=${k}`, patronToken);
      const c = r.status === 200 ? pdfMetni(r.buf) : null;
      bilgi(`azg ${k}: ${n} vardiya → ${r.status} · ${r.buf.length} bayt · ${c?.sayfa ?? "?"} sayfa · ${r.ms} ms`);
      iddia(`azg ${k} · 200 ve 30 sn altı`, r.status === 200 && r.ms < 30_000, `${r.status} ${r.ms} ms`);
    }
    const tum = await al(`/api/mobile/reports/schichtbericht.pdf?range=tumzaman`, patronToken);
    const tc = tum.status === 200 ? pdfMetni(tum.buf) : null;
    bilgi(`schichtbericht tumzaman: ${tum.status} · ${tum.buf.length} bayt · ${tc?.sayfa ?? "?"} sayfa · ${tum.ms} ms`);
    iddia("schichtbericht tumzaman · 200 ve 60 sn altı (en büyük senaryo)", tum.status === 200 && tum.ms < 60_000, `${tum.status} ${tum.ms} ms`);
  }
} catch (e) {
  console.error("\n✗ BEKLENMEDİK HATA:", e?.message ?? e);
  console.error((e?.stack ?? "").split("\n").slice(0, 6).join("\n"));
  dusen++;
}

console.log(`\n╚══ düşen: ${dusen}   ölçülmeyen: ${olculmeyen} ═══════════════════════════\n`);
process.exit(dusen > 0 ? 1 : 0);
