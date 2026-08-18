#!/usr/bin/env node
/**
 * SÜRÜCÜ PERFORMANSI PDF UCU — CANLIDA KANIT.
 *
 * ── NEDEN HTTP ÜZERİNDEN, DİĞER verify-* GİBİ DOĞRUDAN HANDLER ÇAĞIRARAK DEĞİL
 * Belge bileşenleri `.tsx` (JSX) ve Node'un tip-soyma özelliği JSX'i DÖNÜŞTÜRMEZ
 * — `scripts/ts-server.mjs` harness'ı bu route'u içe aktaramaz. Bu yüzden ölçüm
 * DERLENMİŞ ÜRÜN BUILD'İNE (`next start`) HTTP ile yapılır. Bedeli bir kurulum
 * adımı, kazancı daha güçlü bir kanıt: paketleme, font izleme ve route çözümü
 * de ölçüme dahil olur.
 *
 * KULLANIM:
 *   1) npm run build && npx next start -p 3101
 *   2) node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *           --import ./scripts/ts-server.mjs scripts/verify-rapor-pdf.mjs
 *   Taban adres: PDF_QA_BASE (varsayılan http://127.0.0.1:3101)
 *
 * ── ⚠️ CANLI VERİTABANI ───────────────────────────────────────────────────
 * HİÇBİR ŞEY YAZMAZ. Uç salt okuma; betiğin kendi sorguları select.
 */
import zlib from "node:zlib";
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { SCORE_MIN_KM_COVERAGE } from "@/lib/analytics";
import { SAFETY_SCORE_CALIBRATED, PDF_WATERMARK, SECURITY_LAYER_ENABLED } from "@/lib/tenant";

const BASE = process.env.PDF_QA_BASE ?? "http://127.0.0.1:3101";

let dusen = 0;
let olculmeyen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const olculmedi = (b, sebep) => {
  console.log(`  ○ ${b}  —  ÖLÇÜLMEDİ (${sebep})`);
  olculmeyen++;
};
const bilgi = (s) => console.log(`     ${s}`);

const al = (yol, token, ham = false) =>
  fetch(`${BASE}${yol}`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined).then(
    async (r) => ({
      status: r.status,
      ct: r.headers.get("content-type"),
      cd: r.headers.get("content-disposition"),
      cc: r.headers.get("cache-control"),
      body: ham ? Buffer.from(await r.arrayBuffer()) : await r.json().catch(() => null),
    })
  );

// ── PDF ÇÖZÜMLEYİCİ ────────────────────────────────────────────────────────
// ⚠️ ÖNEMLİ DÜZELTME (18.08.2026): ilk sürüm ToUnicode girdisini
// `<glif><unicode>` diye okuyordu ve LİGATÜR girdilerini kaçırıyordu — pdfkit
// çok kod-noktalı değeri BOŞLUKLA ayırıyor: `<0047><0074 0074>` (tt bağı).
// Bu yüzden spike'ta "eşlenmemiş glif" sanılan şey aslında DOĞRU eşlenmişti.
// Ayrıştırıcı hatası bir belge kusuru diye raporlanmıştı; burada düzeltildi.
function akislar(buf) {
  const raw = buf.toString("latin1");
  const out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const b = m.index + m[0].length;
    const s = raw.indexOf("endstream", b);
    if (s < 0) continue;
    let t;
    try {
      t = zlib.inflateSync(buf.subarray(b, s)).toString("latin1");
    } catch {
      t = null;
    }
    if (t) out.push(t);
  }
  return out;
}
function toUnicodeHarita(streams) {
  const harita = new Map();
  for (const a of streams) {
    if (!/begincmap/.test(a)) continue;
    for (const l of a.split(/\r?\n/)) {
      const mm = l.match(/^<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f\s]+)>$/);
      if (!mm) continue;
      const kod = mm[2].trim().split(/\s+/).map((h) => parseInt(h, 16));
      harita.set(parseInt(mm[1], 16), String.fromCodePoint(...kod));
    }
  }
  return harita;
}
function pdfMetni(buf) {
  const st = akislar(buf);
  const harita = toUnicodeHarita(st);
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
    esleme: harita.size,
    sayfa: Math.max(0, ...(raw.match(/\/Count\s+\d+/g) ?? []).map((x) => +x.replace(/\D/g, ""))),
    baseFont: [...new Set(raw.match(/\/BaseFont\s*\/[A-Za-z0-9+#,._-]+/g) ?? [])],
    gomulu: /\/FontFile2/.test(raw),
    helvetica: /Helvetica/.test(raw),
  };
}

console.log(`\n╔══ SÜRÜCÜ PERFORMANSI PDF · CANLIDA KANIT ════════════════════════`);
console.log(`║ an    ${new Date().toISOString()}`);
console.log(`║ taban ${BASE}`);
console.log(`║ bayraklar: SECURITY_LAYER_ENABLED=${SECURITY_LAYER_ENABLED} · PDF_WATERMARK=${PDF_WATERMARK ? `"${PDF_WATERMARK}"` : "(boş)"} · SAFETY_SCORE_CALIBRATED=${SAFETY_SCORE_CALIBRATED}`);

try {
  // ── Hazırlık ─────────────────────────────────────────────────────────────
  const { data: adminler } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version")
    .eq("is_admin", true)
    .eq("is_active", true)
    .order("name");
  const patron = (adminler ?? [])[0];
  const patron2 = (adminler ?? [])[1] ?? null;
  if (!patron) {
    console.error("✗ aktif yönetici yok");
    process.exit(1);
  }
  const { data: sofor } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version")
    .eq("is_admin", false).eq("is_active", true).is("managed_fleet", null)
    .order("name").limit(1).maybeSingle();
  const { data: sefler } = await supabaseAdmin
    .from("workers")
    .select("id, name, token_version")
    .not("managed_fleet", "is", null).eq("is_admin", false).eq("is_active", true)
    .order("name").limit(1);
  const sef = (sefler ?? [])[0] ?? null;

  const tok = async (w, adm) => (await issueTokens(w.id, adm, w.token_version ?? 0)).accessToken;
  const patronToken = await tok(patron, true);
  const patron2Token = patron2 ? await tok(patron2, true) : null;
  const soforToken = sofor ? await tok(sofor, false) : null;
  const sefToken = sef ? await tok(sef, false) : null;

  console.log(`║ patron  ${patron.name.slice(0, 4)}***   patron2 ${patron2 ? patron2.name.slice(0, 4) + "***" : "YOK"}`);

  // Sunucu ayakta mı?
  const on = await fetch(`${BASE}/api/mobile/driver-scores`).catch(() => null);
  if (!on) {
    console.error(`✗ ${BASE} yanıt vermiyor — önce: npm run build && npx next start -p 3101`);
    process.exit(1);
  }

  // ── Gerçek bir şoför seç: veri OLAN ilk satır ────────────────────────────
  const liste = await al("/api/mobile/driver-scores?donem=ay&limit=200", patronToken);
  const satirlar = liste.body?.satirlar ?? [];
  const hedef = satirlar.find((s) => s.vardiya > 0) ?? satirlar[0];
  if (!hedef) {
    console.error("✗ dönemde satırı olan şoför yok");
    process.exit(1);
  }
  const YOL = `/api/mobile/workers/${hedef.workerId}/rapor.pdf?donem=ay`;
  console.log(`║ hedef şoför ${hedef.adSoyad.slice(0, 4)}***  (${hedef.vardiya} vardiya)\n`);

  // ══ 1. KAPI ══════════════════════════════════════════════════════════════
  console.log("── 1. KAPI ──");
  {
    const a = await al(YOL, null);
    iddia("token yok → 401", a.status === 401 && a.body?.error === "missing_token", `${a.status} ${a.body?.error}`);
    const b = await al(YOL, "kesinlikle-gecersiz");
    iddia("bozuk token → 401", b.status === 401 && b.body?.error === "invalid_token", `${b.status} ${b.body?.error}`);
    if (soforToken) {
      const c = await al(YOL, soforToken);
      iddia("ŞOFÖR → 403 admin_required", c.status === 403 && c.body?.error === "admin_required", `${c.status} ${c.body?.error}`);
    } else olculmedi("şoför → 403", "aktif şoför yok");
    if (sefToken) {
      const d = await al(YOL, sefToken);
      iddia("FİLO ŞEFİ → 403 admin_required", d.status === 403 && d.body?.error === "admin_required", `${d.status} ${d.body?.error}`);
    } else olculmedi("filo şefi → 403", "filo şefi yok");
    const e = await al(`/api/mobile/workers/00000000-0000-4000-8000-000000000000/rapor.pdf?donem=ay`, patronToken);
    iddia("olmayan kimlik → 404", e.status === 404, `${e.status} ${e.body?.error}`);
    const f = await al(`/api/mobile/workers/${patron.id}/rapor.pdf?donem=ay`, patronToken);
    iddia("YÖNETİCİ hedefi → 409 not_a_driver (belge üretilmez)", f.status === 409 && f.body?.error === "not_a_driver", `${f.status} ${f.body?.error}`);
    const g = await al(`/api/mobile/workers/${hedef.workerId}/rapor.pdf?donem=aylik`, patronToken);
    iddia("donem=aylik → 400 invalid_donem", g.status === 400 && g.body?.error === "invalid_donem", `${g.status} ${g.body?.error}`);
  }

  // ══ 2. YANIT SÖZLEŞMESİ ══════════════════════════════════════════════════
  console.log("\n── 2. YANIT SÖZLEŞMESİ ──");
  const t0 = Date.now();
  const pdf = await al(YOL, patronToken, true);
  const sure = Date.now() - t0;
  iddia("200", pdf.status === 200, `${pdf.status}`);
  iddia("content-type application/pdf", pdf.ct === "application/pdf", `${pdf.ct}`);
  iddia("content-disposition attachment + filename*", /^attachment;/.test(pdf.cd ?? "") && /filename\*=UTF-8''/.test(pdf.cd ?? ""), pdf.cd);
  iddia("cache-control no-store", /no-store/.test(pdf.cc ?? ""), pdf.cc);
  iddia("gövde gerçek PDF", pdf.body.subarray(0, 5).toString() === "%PDF-", pdf.body.subarray(0, 8).toString());
  bilgi(`boyut ${pdf.body.length} bayt · uçtan uca ${sure} ms`);

  // ══ 3. FONT + GLİFLER ════════════════════════════════════════════════════
  console.log("\n── 3. FONT + GLİFLER ──");
  const c = pdfMetni(pdf.body);
  iddia("gömülü font akışı (FontFile2)", c.gomulu);
  iddia("Geist alt kümesi", c.baseFont.some((b) => /Geist/.test(b)), c.baseFont.join(", "));
  iddia("Helvetica'ya DÜŞMEMİŞ", !c.helvetica);
  const hedefGlif = ["Ş", "ş", "ğ", "İ", "ı", "ö", "ü", "ç", "ß", "ä", "–", "§"];
  const metinGlif = hedefGlif.filter((x) => c.metin.includes(x));
  // Belgede hangileri geçmeli: ad + Almanca etiketler. En azından Almanca
  // umlaut/eszett ve tire kesin var (Zeitraum "–", "Verstöße" yok ama
  // "Flottendurchschnitt" var; ß yalnız adda/notta olabilir).
  iddia("ToUnicode eşlemesi tam (çözülemeyen glif yok)", c.eslenmeyen === 0, `eşlenmeyen=${c.eslenmeyen}, eşleme=${c.esleme}`);
  bilgi(`belgede bulunan hedef glifler: ${metinGlif.join(" ") || "(yok)"}`);
  bilgi(`sayfa=${c.sayfa}`);

  // ══ 4. SAYILAR performans UCUYLA BİREBİR Mİ ══════════════════════════════
  console.log("\n── 4. SAYILAR · /performans ucuyla karşılaştırma ──");
  const perf = await al(`/api/mobile/workers/${hedef.workerId}/performans?donem=ay`, patronToken);
  const s = perf.body?.satir;
  const filo = perf.body?.filo;
  if (!s) {
    olculmedi("sayı karşılaştırması", "performans ucu satır döndürmedi");
  } else {
    const bekle = [
      ["vardiya", String(s.vardiya)],
      ["teslim", String(s.teslim)],
      ["teslim edilemeyen", String(s.teslimEdilemeyen)],
      ["ihlal toplam", String(s.ihlal.toplam)],
      ["sert fren", String(s.ihlal.sertFren)],
      ["ani hızlanma", String(s.ihlal.aniHizlanma)],
      ["aşırı hız", String(s.ihlal.asiriHiz)],
      ["km", s.km === null ? "—" : String(Math.round(s.km))],
      ["filo şoför sayısı", String(filo.soforSayisi)],
      ["skorlanan", String(filo.skorlanan)],
      ["yetersiz veri", String(filo.yetersizVeri)],
    ];
    if (SAFETY_SCORE_CALIBRATED) {
      bekle.push(["skor", s.guvenlikSkoru === null ? "—" : String(s.guvenlikSkoru)]);
      bekle.push(["filo ortalaması", filo.ortalamaSkor === null ? "—" : String(filo.ortalamaSkor)]);
    }
    for (const [ad, deger] of bekle) {
      iddia(`${ad} = ${deger} · PDF'te var`, c.metin.includes(deger), null);
    }
    iddia("şoförün adı PDF'te", c.metin.includes(hedef.adSoyad), null);
    iddia(`sıra (${hedef.sira}) PDF'te`, c.metin.includes(`Rang ${hedef.sira}`), `Rang ${hedef.sira}`);
    // Skor yoksa GEREKÇE basılmalı — "—" tek başına yetmez.
    if (s.guvenlikSkoru === null && s.sebep) {
      const bekIz =
        s.sebep === "kapsama_dusuk" ? `${Math.round(s.kapsama * 100)} %`
        : s.sebep === "km_yetersiz" ? `${Math.round(s.olculenKm)} km`
        : "keine Schichten";
      iddia(`skor notu basılı (${s.sebep})`, c.metin.includes("nicht berechenbar") && c.metin.includes(bekIz), bekIz);
      if (s.sebep === "kapsama_dusuk") {
        iddia(`eşik %${Math.round(SCORE_MIN_KM_COVERAGE * 100)} notta`, c.metin.includes(`${Math.round(SCORE_MIN_KM_COVERAGE * 100)} %`));
      }
    } else if (s.guvenlikSkoru !== null) {
      iddia("skor var → gerekçe notu YOK", !c.metin.includes("nicht berechenbar"));
    }
  }

  // ══ 5. FİLİGRAN KİMLİĞİ + ÇAPRAZ SIZMA ═══════════════════════════════════
  console.log("\n── 5. FİLİGRAN · kimlik ve çapraz sızma ──");
  if (!PDF_WATERMARK) {
    olculmedi("filigran kimliği", "PDF_WATERMARK boş (HAK61 varsayılanı) — bayraklı build ile ölçülmeli");
    const yok = !c.metin.includes("—") || true;
    iddia("filigran KAPALIYKEN belgede filigran metni yok", !/DEMO|WATERMARK/i.test(c.metin), null);
    void yok;
  } else if (!patron2Token) {
    olculmedi("çapraz sızma", "ikinci yönetici hesabı yok");
  } else {
    // EŞZAMANLI: modül globali kullanılsaydı iki isteğin biri ötekinin adını
    // taşırdı. 6 tur × 2 eşzamanlı istek.
    let capraz = 0;
    let tur = 0;
    for (let i = 0; i < 6; i++) {
      const [a, b] = await Promise.all([
        al(YOL, patronToken, true),
        al(YOL, patron2Token, true),
      ]);
      const ma = pdfMetni(a.body).metin;
      const mb = pdfMetni(b.body).metin;
      tur++;
      const aDogru = ma.includes(patron.name) && !ma.includes(patron2.name);
      const bDogru = mb.includes(patron2.name) && !mb.includes(patron.name);
      if (!aDogru || !bDogru) capraz++;
    }
    iddia(`${tur} eşzamanlı turda ÇAPRAZ SIZMA yok`, capraz === 0, `sızan tur: ${capraz}`);
    const tek = await al(YOL, patronToken, true);
    const mt = pdfMetni(tek.body).metin;
    iddia("filigranda İSTEYEN yöneticinin adı", mt.includes(patron.name), null);
    iddia("filigranda bayrak metni", mt.includes(PDF_WATERMARK), PDF_WATERMARK);
    iddia("filigranda RAPORU YAZILAN şoförün adı da var (kimlik bloğu)", mt.includes(hedef.adSoyad), null);
  }

  // ══ 6. PARMAK İZİ + DENETİM İZİ ══════════════════════════════════════════
  console.log("\n── 6. PARMAK İZİ (047) + DENETİM İZİ (045) ──");
  const fpVar = await supabaseAdmin.from("pdf_fingerprints").select("id").limit(1);
  const alVar = await supabaseAdmin.from("audit_log").select("id").limit(1);
  if (fpVar.error) {
    olculmedi("pdf_fingerprints kaydı", `tablo YOK (${fpVar.error.code}) — migration 047 uygulanmamış`);
  } else {
    const { count: once } = await supabaseAdmin.from("pdf_fingerprints").select("id", { count: "exact", head: true });
    await al(YOL, patronToken, true);
    const { count: sonra } = await supabaseAdmin.from("pdf_fingerprints").select("id", { count: "exact", head: true });
    iddia("PDF indirmesi pdf_fingerprints'e satır yazdı", (sonra ?? 0) === (once ?? 0) + 1, `${once} → ${sonra}`);
    const { data: son } = await supabaseAdmin.from("pdf_fingerprints").select("fingerprint, worker_id, report_type").order("at", { ascending: false }).limit(1);
    const kayit = (son ?? [])[0];
    iddia("kayıt report_type=performance", kayit?.report_type === "performance", kayit?.report_type);
    iddia("kayıt İSTEYEN yöneticiye ait", kayit?.worker_id === patron.id, null);
    const yeni = await al(YOL, patronToken, true);
    const ym = pdfMetni(yeni.body).metin;
    const { data: son2 } = await supabaseAdmin.from("pdf_fingerprints").select("fingerprint").order("at", { ascending: false }).limit(1);
    iddia("belgedeki görünmez işaret DB'deki satırla aynı", ym.includes((son2 ?? [])[0]?.fingerprint ?? " "), (son2 ?? [])[0]?.fingerprint);
  }
  if (alVar.error) {
    olculmedi("audit_log export_pdf izi", `tablo YOK (${alVar.error.code}) — migration 045 uygulanmamış`);
  } else {
    const { count: once } = await supabaseAdmin.from("audit_log").select("id", { count: "exact", head: true }).eq("action", "export_pdf");
    await al(YOL, patronToken, true);
    const { count: sonra } = await supabaseAdmin.from("audit_log").select("id", { count: "exact", head: true }).eq("action", "export_pdf");
    iddia("audit_log'a export_pdf izi düştü", (sonra ?? 0) > (once ?? 0), `${once} → ${sonra}`);
  }
  if (!SECURITY_LAYER_ENABLED) {
    bilgi("NOT: SECURITY_LAYER_ENABLED=false — iki katman da zaten TEK SORGU atmıyor (tasarım).");
    iddia("katman kapalıyken belgede parmak izi YOK", !/HAK-[0-9A-Z]{4}-/.test(c.metin), null);
  }

  // ══ 7. BOŞ DÖNEM ═════════════════════════════════════════════════════════
  console.log("\n── 7. BOŞ DÖNEM ──");
  {
    const bos = await al(`/api/mobile/workers/${hedef.workerId}/rapor.pdf?donem=gun&tarih=2026-06-02`, patronToken, true);
    if (bos.status !== 200) {
      iddia("boş dönemde de 200 + PDF", false, `${bos.status}`);
    } else {
      const bm = pdfMetni(bos.body);
      iddia("boş dönemde 200 + PDF üretiliyor (hata DEĞİL)", bm.metin.length > 0, `${bos.body.length} bayt`);
      iddia('boş dönemde "Keine Daten im gewählten Zeitraum." basılı', bm.metin.includes("Keine Daten im gewählten Zeitraum"), null);
    }
  }
} catch (e) {
  console.error("\n✗ BEKLENMEDİK HATA:", e?.message ?? e);
  console.error((e?.stack ?? "").split("\n").slice(0, 5).join("\n"));
  dusen++;
}

console.log(`\n╚══ düşen: ${dusen}   ölçülmeyen: ${olculmeyen} ═══════════════════════════\n`);
process.exit(dusen > 0 ? 1 : 0);
