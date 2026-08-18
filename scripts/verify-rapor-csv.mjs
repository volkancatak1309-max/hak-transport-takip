#!/usr/bin/env node
/**
 * MOBİL CSV UÇLARI — CANLIDA KANIT.
 *
 * Üç ucun GERÇEK işleyicileri çağrılır (route.ts'ler saf `.ts`, JSX yok →
 * ts-server harness'ı doğrudan içe aktarabiliyor; PDF ucundan farkı bu).
 *
 * ── PANEL KARŞILAŞTIRMASI NASIL KURULUYOR ─────────────────────────────────
 * Panelin CSV'si TARAYICIDA üretiliyor, dolayısıyla "aynı dosyayı indirip
 * karşılaştırmak" mümkün değil. Onun yerine panelin KENDİ KAYNAK MANTIĞI
 * (app/admin/page.tsx sorgusu + AdminClient.tsx `exportCsv` dönüşümü,
 * DistanceClient/FuelClient hücre kuralları) burada BAĞIMSIZ olarak yeniden
 * kuruluyor ve ucun ürettiği baytlarla hücre hücre kıyaslanıyor. Replika, ucun
 * kodunu (lib/report-csv.ts) HİÇ çağırmaz.
 *
 * ═══ KIYAS KAPANMIŞ GEÇMİŞ PENCEREDE YAPILIR — ÖLÇÜM DERSİ ═══
 *
 * İlk sürüm "son 30 gün"de kıyasladı ve YANLIŞ ALARM üretti: o pencerenin sonu
 * "şimdi"dir, telemetri akmaya devam ediyor ve açık vardiyanın süresi saati
 * okuyor. Ölçüldü — ucu iki kez çağırmak bile farklı çıktı veriyor. Böyle bir
 * pencerede bayt eşitliği İMKÂNSIZDIR; kusur kodda değil ölçüm kurgusundaydı.
 *
 * "Oynak sütunları iki çağrıyla ölç, kalanını katı kıyasla" yolu da DENENDİ ve
 * KIRILGAN çıktı: bir sütunun oynayıp oynamadığı o iki çağrı arasında telemetri
 * gelip gelmemesine bağlı, yani ölçüm kendi rastlantısına bağlı.
 *
 * ÇÖZÜM: pencereyi KAPAT. Tamamı geçmişte kalan aralıkta yeni satır düşmez,
 * odometre/yakıt uçları sabittir, açık vardiya yoktur → üç dosyanın da BAYT
 * BAYT aynı olması beklenir ve TOLERANS YOKTUR. Canlı pencerenin oynaklığı
 * ayrıca 4d'de ölçülüp gösteriliyor.
 *
 * ── ⚠️ CANLI VERİTABANI ───────────────────────────────────────────────────
 * HİÇBİR ŞEY YAZMAZ. Üçü de salt okuma.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server.mjs scripts/verify-rapor-csv.mjs
 */
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers, dropNonDrivers } from "@/lib/driver-scope";
import { markKmMeasured } from "@/lib/km-quality";
import { buildDistanceReport, buildFuelReport } from "@/lib/reports";
import { computeAnalyticsRange } from "@/lib/analytics";
import { FUEL_MIN_KM, FUEL_MIN_CONSUMED_PCT } from "@/lib/metric-thresholds";
import { PACKAGES_ENABLED, EXPORT_ENABLED, FUEL_ENABLED } from "@/lib/tenant";
import { DEFAULT_LOCALE } from "@/i18n/request";
import { getTranslations } from "next-intl/server";
import { workedMs, kmDiff, formatDate, formatTime, formatDurationShort } from "@/lib/format";
import { WORKER_PUBLIC_COLUMNS } from "@/lib/types";
import { GET as SHIFTS } from "@/app/api/mobile/reports/shifts.csv/route";
import { GET as DISTANCE } from "@/app/api/mobile/reports/distance.csv/route";
import { GET as FUEL } from "@/app/api/mobile/reports/fuel.csv/route";

/** Kıyas penceresi — TAMAMI GEÇMİŞTE. Veri sabit, tolerans gerekmez. */
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

const istek = (url, token) => {
  const h = {};
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(url, { headers: h });
};
async function cagir(handler, yol, token) {
  const res = await handler(istek(`http://x${yol}`, token));
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    ct: res.headers.get("content-type"),
    cd: res.headers.get("content-disposition"),
    cc: res.headers.get("cache-control"),
    satir: res.headers.get("x-rapor-satir"),
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

/** BOM'u ayıklar, kodlamayı söyler. */
function coz(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe)
    return { kodlama: "utf-16le", bom: true, metin: buf.subarray(2).toString("utf16le") };
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
    return { kodlama: "utf-8", bom: true, metin: buf.subarray(3).toString("utf8") };
  return { kodlama: "utf-8", bom: false, metin: buf.toString("utf8") };
}
const satirlara = (metin) => metin.split("\r\n");

/** Aynı ucu iki kez okuyup kendiliğinden değişen sütunları ölçer (4d için). */
async function oynakSutunlar(handler, yol, ayrac, token) {
  const a = coz((await cagir(handler, yol, token)).buf).metin;
  const b = coz((await cagir(handler, yol, token)).buf).metin;
  const as = satirlara(a);
  const bs = satirlara(b);
  const basliklar = (as[0] ?? "").split(ayrac);
  const idx = new Set();
  for (let i = 1; i < Math.min(as.length, bs.length); i++) {
    if (as[i] === bs[i]) continue;
    const ca = as[i].split(ayrac);
    const cb = bs[i].split(ayrac);
    for (let j = 0; j < ca.length; j++) if (ca[j] !== cb[j]) idx.add(j);
  }
  return [...idx].map((j) => basliklar[j] ?? `#${j}`);
}

/** Hücre hücre KATI kıyas — tolerans yok, ilk fark raporlanır. */
function katiKiyas(etiket, panelMetin, ucMetin, ayrac, kolon) {
  const ps = satirlara(panelMetin);
  const us = satirlara(ucMetin);
  iddia(`${etiket} · satır sayısı`, ps.length === us.length, `panel=${ps.length} uç=${us.length}`);
  iddia(`${etiket} · BAŞLIK birebir`, ps[0] === us[0], ps[0] === us[0] ? null : `panel="${ps[0]}"  uç="${us[0]}"`);
  const basliklar = (ps[0] ?? "").split(ayrac);
  let fark = 0;
  let ilk = null;
  for (let i = 1; i < Math.min(ps.length, us.length); i++) {
    if (ps[i] === us[i]) continue;
    const cp = ps[i].split(ayrac);
    const cu = us[i].split(ayrac);
    for (let j = 0; j < Math.max(cp.length, cu.length); j++) {
      if (cp[j] === cu[j]) continue;
      fark++;
      if (ilk === null)
        ilk = `satır#${i} kolon#${j} (${basliklar[j] ?? "?"}): panel="${cp[j]}" uç="${cu[j]}"`;
    }
  }
  iddia(
    `${etiket} · TÜM hücreler BİREBİR (tolerans YOK)`,
    fark === 0,
    fark === 0 ? `${ps.length - 1} satır × ${kolon} sütun` : `${fark} fark — ${ilk}`
  );
}

console.log(`\n╔══ MOBİL CSV UÇLARI · CANLIDA KANIT ══════════════════════════════`);
console.log(`║ an  ${new Date().toISOString()}`);
console.log(`║ dil ${DEFAULT_LOCALE} · PACKAGES_ENABLED=${PACKAGES_ENABLED} · EXPORT_ENABLED=${EXPORT_ENABLED} · FUEL_ENABLED=${FUEL_ENABLED}`);

try {
  const { data: patron } = await supabaseAdmin
    .from("workers").select("id, name, token_version")
    .eq("is_admin", true).eq("is_active", true).order("name").limit(1).maybeSingle();
  const { data: sofor } = await supabaseAdmin
    .from("workers").select("id, name, token_version")
    .eq("is_admin", false).eq("is_active", true).is("managed_fleet", null)
    .order("name").limit(1).maybeSingle();
  const { data: sefler } = await supabaseAdmin
    .from("workers").select("id, name, token_version")
    .not("managed_fleet", "is", null).eq("is_admin", false).eq("is_active", true)
    .order("name").limit(1);
  const sef = (sefler ?? [])[0] ?? null;
  if (!patron) {
    console.error("✗ yönetici yok");
    process.exit(1);
  }

  const patronToken = (await issueTokens(patron.id, true, patron.token_version ?? 0)).accessToken;
  const soforToken = sofor ? (await issueTokens(sofor.id, false, sofor.token_version ?? 0)).accessToken : null;
  const sefToken = sef ? (await issueTokens(sef.id, false, sef.token_version ?? 0)).accessToken : null;

  const UCLAR = [
    ["shifts.csv", SHIFTS, "/api/mobile/reports/shifts.csv", "\t"],
    ["distance.csv", DISTANCE, "/api/mobile/reports/distance.csv", ";"],
    ["fuel.csv", FUEL, "/api/mobile/reports/fuel.csv", ";"],
  ];

  // ══ BAYRAK KAPALIYSA: YALNIZ KAPI ÖLÇÜLÜR ════════════════════════════════
  // EXPORT_ENABLED=false koşumunda üç uç da 409 döner; içerik bölümlerini
  // koşturmak "0 satır" gibi anlamsız düşüşler üretirdi. Bu koşumun işi BAYRAK
  // KAPISINI ölçmek — ölçülemeyeni ölçmüş gibi göstermiyoruz.
  if (!EXPORT_ENABLED) {
    console.log(`
── BAYRAK KAPALI KOŞUMU (EXPORT_ENABLED=false) ──`);
    for (const [ad, h, yol] of UCLAR) {
      // KİMLİK KAPISI BAYRAKTAN ÖNCE: tokensiz istek 409 değil 401 almalı,
      // yoksa kapalı bir özellik kimlik doğrulamasını atlatıyor demek olur.
      const t0 = await cagir(h, `${yol}?range=ay`, null);
      iddia(`${ad} · bayrak kapalı + token yok → 401 (kimlik kapısı önce)`, t0.status === 401, `${t0.status}`);
      if (soforToken) {
        const t1 = await cagir(h, `${yol}?range=ay`, soforToken);
        iddia(`${ad} · bayrak kapalı + ŞOFÖR → 403`, t1.status === 403, `${t1.status}`);
      }
      const r = await cagir(h, `${yol}?range=ay`, patronToken);
      iddia(
        `${ad} · 409 feature_disabled + bayrak adı gövdede`,
        r.status === 409 && r.json()?.error === "feature_disabled" && r.json()?.bayrak === "EXPORT_ENABLED",
        `${r.status} ${r.json()?.error} bayrak=${r.json()?.bayrak}`
      );
    }
    bilgi("İçerik ve girdi-red bölümleri bu koşumda ATLANDI (uçlar bilerek 409).");
    console.log(`
╚══ düşen: ${dusen}   ölçülmeyen: ${olculmeyen} ═══════════════════════════
`);
    process.exit(dusen > 0 ? 1 : 0);
  }

  // ══ 1. KAPI ══════════════════════════════════════════════════════════════
  console.log(`\n── 1. KAPI ──`);
  for (const [ad, h, yol] of UCLAR) {
    const a = await cagir(h, `${yol}?range=hafta`, null);
    iddia(`${ad} · token yok → 401`, a.status === 401 && a.json()?.error === "missing_token", `${a.status}`);
    const b = await cagir(h, `${yol}?range=hafta`, "kesinlikle-gecersiz");
    iddia(`${ad} · bozuk token → 401`, b.status === 401, `${b.status}`);
    if (soforToken) {
      const c = await cagir(h, `${yol}?range=hafta`, soforToken);
      iddia(`${ad} · ŞOFÖR → 403 admin_required`, c.status === 403 && c.json()?.error === "admin_required", `${c.status} ${c.json()?.error}`);
    } else olculmedi(`${ad} · şoför → 403`, "şoför yok");
    if (sefToken) {
      const d = await cagir(h, `${yol}?range=hafta`, sefToken);
      iddia(`${ad} · FİLO ŞEFİ → 403 admin_required`, d.status === 403 && d.json()?.error === "admin_required", `${d.status} ${d.json()?.error}`);
    } else olculmedi(`${ad} · şef → 403`, "şef yok");
    const e = await cagir(h, `${yol}?range=aylik`, patronToken);
    iddia(`${ad} · range=aylik → 400 invalid_range`, e.status === 400 && e.json()?.error === "invalid_range", `${e.status}`);
    const f = await cagir(h, `${yol}?range=ozel&from=2026-02-31&to=2026-03-05`, patronToken);
    iddia(`${ad} · takvimde olmayan tarih → 400 invalid_tarih`, f.status === 400 && f.json()?.error === "invalid_tarih", `${f.status}`);
  }

  // ══ 2. SÖZLEŞME + KODLAMA ════════════════════════════════════════════════
  console.log(`\n── 2. SÖZLEŞME + KODLAMA ──`);
  const beklenen = {
    "shifts.csv": { ct: "text/csv;charset=utf-16le", kod: "utf-16le", ad: "hak-vardiyalar-" },
    "distance.csv": { ct: "text/csv;charset=utf-8", kod: "utf-8", ad: "hak-mesafe-" },
    "fuel.csv": { ct: "text/csv;charset=utf-8", kod: "utf-8", ad: "hak-yakit-" },
  };
  const canli = {};
  for (const [ad, h, yol, ayrac] of UCLAR) {
    const r = await cagir(h, `${yol}?range=ay`, patronToken);
    canli[ad] = r;
    const b = beklenen[ad];
    iddia(`${ad} · 200`, r.status === 200, `${r.status}`);
    if (r.status !== 200) continue;
    iddia(`${ad} · content-type ${b.ct}`, r.ct === b.ct, r.ct);
    iddia(`${ad} · attachment + ${b.ad}…`, /^attachment;/.test(r.cd ?? "") && (r.cd ?? "").includes(b.ad), r.cd);
    iddia(`${ad} · cache-control no-store`, /no-store/.test(r.cc ?? ""), r.cc);
    const d = coz(r.buf);
    iddia(`${ad} · BOM var, kodlama ${b.kod}`, d.bom && d.kodlama === b.kod, `${d.kodlama} bom=${d.bom}`);
    const sat = satirlara(d.metin).filter((l) => l.length);
    iddia(`${ad} · CRLF satır sonu`, d.metin.includes("\r\n") || sat.length === 1, `${sat.length} satır`);
    const kolonlar = new Set(sat.map((l) => l.split(ayrac).length));
    iddia(`${ad} · her satırda aynı sütun sayısı`, kolonlar.size === 1, `sütun=${[...kolonlar].join("/")}`);
    iddia(`${ad} · x-rapor-satir gövdeyle tutuyor`, Number(r.satir) === sat.length - 1, `${r.satir} vs ${sat.length - 1}`);
    bilgi(`${ad}: ${r.buf.length} bayt · ${r.satir} veri satırı · ${[...kolonlar][0]} sütun`);
  }

  // ══ 3. KARAKTER BÜTÜNLÜĞÜ (Excel'de bozulur mu) ══════════════════════════
  console.log(`\n── 3. KARAKTER BÜTÜNLÜĞÜ ──`);
  for (const [ad] of UCLAR) {
    const r = canli[ad];
    if (!r || r.status !== 200) continue;
    const d = coz(r.buf);
    const bozuk = (d.metin.match(/�/g) ?? []).length;
    // Mojibake imzası: UTF-8 baytları latin1 sanılınca çıkan diziler.
    const mojibake = /Ã.|Ä°|Å|Ä/.test(d.metin);
    iddia(`${ad} · U+FFFD yok`, bozuk === 0, `${bozuk}`);
    iddia(`${ad} · mojibake imzası yok`, !mojibake, null);
    const trChars = [...new Set(d.metin.match(/[şŞğĞıİöÖüÜçÇäÄß]/g) ?? [])];
    bilgi(`${ad}: TR/DE karakterler → ${trChars.join(" ") || "(yok)"}`);
  }

  // ══ 4. PANEL REPLİKASI — KAPANMIŞ PENCEREDE KATI KIYAS ═══════════════════
  console.log(`\n── 4. PANEL REPLİKASI (ucun kodu ÇAĞRILMADI) ──`);
  const QS = `range=ozel&from=${PENCERE.from}&to=${PENCERE.to}`;
  const range = computeAnalyticsRange("ozel", PENCERE.from, PENCERE.to);
  bilgi(`pencere: ${PENCERE.from} → ${PENCERE.to} (kapanmış geçmiş — veri sabit, tolerans yok)`);

  const ucCikti = {};
  for (const [ad, h, yol] of UCLAR) {
    ucCikti[ad] = coz((await cagir(h, `${yol}?${QS}`, patronToken)).buf).metin;
  }

  // ---- 4a) shifts ---------------------------------------------------------
  {
    const t = await getTranslations({ locale: DEFAULT_LOCALE, namespace: "admin" });
    const scope = await getTestScope();
    const ds = await getDriverScope();
    const { data: eData } = await fetchAllRows(
      (from, to) =>
        onlyDrivers(
          withoutTestRows(
            supabaseAdmin
              .from("time_entries")
              .select("*")
              .gte("started_at", range.start.toISOString())
              .lte("started_at", range.end.toISOString())
              .order("started_at", { ascending: false })
              .order("id")
              .range(from, to),
            "worker_id",
            scope.workerIds
          ),
          "worker_id",
          ds
        ),
      "replika/time_entries"
    );
    const { data: wData } = await withoutTestRows(
      supabaseAdmin.from("workers").select(WORKER_PUBLIC_COLUMNS).order("name"),
      "id",
      scope.workerIds
    );
    const wMap = new Map((wData ?? []).map((w) => [w.id, w]));
    const soforler = dropNonDrivers(wData ?? [], (w) => w.id, ds);
    const harman = DEFAULT_LOCALE === "de" ? "de" : "tr";
    const sirali = [...soforler].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", harman));
    const persNr = new Map();
    sirali.forEach((w, i) => persNr.set(w.id, (w.employee_number ?? "").trim() || String(i + 1)));
    const entries = await markKmMeasured(eData ?? []);
    const acik = entries.filter((e) => e.ended_at === null).length;
    iddia("shifts · pencerede AÇIK vardiya yok (süre deterministik)", acik === 0, `${acik} açık`);

    const header = [
      t("tblPersNr"), t("tblWorker"), t("tblDate"), t("tblStart"), t("tblEnd"),
      t("tblWorked"), t("tblBreak"), t("tblKm"),
      ...(PACKAGES_ENABLED ? [t("tblLoaded"), t("tblCargo"), t("tblUndelivered")] : []),
      t("tblPlate"), t("tblNote"),
    ];
    const rows = entries.map((e) => {
      const w = wMap.get(e.worker_id);
      const km = kmDiff(e);
      return [
        persNr.get(e.worker_id) ?? "—",
        w?.name ?? "",
        formatDate(e.started_at, DEFAULT_LOCALE),
        formatTime(e.started_at, DEFAULT_LOCALE),
        e.ended_at ? formatTime(e.ended_at, DEFAULT_LOCALE) : t("statusActive"),
        formatDurationShort(workedMs(e), DEFAULT_LOCALE),
        String(e.break_minutes ?? 0),
        km !== null ? String(km) : "",
        ...(PACKAGES_ENABLED
          ? [
              e.start_package_count !== null ? String(e.start_package_count) : "",
              e.ended_at && e.cargo_count !== null ? String(e.cargo_count) : "",
              e.undelivered_count !== null ? String(e.undelivered_count) : "",
            ]
          : []),
        e.plate ?? "",
        e.notes ?? "",
      ];
    });
    const panelMetin = [header, ...rows]
      .map((r) => r.map((c) => String(c ?? "").replace(/[\r\n]+/g, " ").split("\t").join(" ")).join("\t"))
      .join("\r\n");
    katiKiyas("shifts", panelMetin, ucCikti["shifts.csv"], "\t", header.length);
  }

  // ---- 4b) distance ------------------------------------------------------
  {
    const t = await getTranslations({ locale: DEFAULT_LOCALE, namespace: "reports" });
    const rapor = await buildDistanceReport(range);
    const header = [t("col_plate"), t("col_driver"), t("col_km"), t("col_km_day")];
    const rows = rapor.rows.map((r) =>
      [
        r.plate,
        r.driverName ?? "",
        r.km === null ? "" : String(Math.round(r.km)),
        r.kmPerDay === null ? "" : String(Math.round(r.kmPerDay)),
      ].join(";")
    );
    katiKiyas("distance", [header.join(";"), ...rows].join("\r\n"), ucCikti["distance.csv"], ";", 4);
  }

  // ---- 4c) fuel ----------------------------------------------------------
  {
    const t = await getTranslations({ locale: DEFAULT_LOCALE, namespace: "reports" });
    const nf = DEFAULT_LOCALE === "de" ? "de-AT" : "tr-TR";
    const num = (v, d = 0) => v.toLocaleString(nf, { minimumFractionDigits: d, maximumFractionDigits: d });
    const rapor = await buildFuelReport(range);
    const header = [
      t("col_plate"), t("col_driver"), t("col_tank"), t("col_avg_fuel"),
      t("col_consumed"), t("col_km"), t("col_samples"), t("col_l_100km"),
      t("col_refills"), t("col_leak"),
    ];
    const rows = rapor.rows.map((r) =>
      [
        r.plate,
        r.driverName ?? "",
        r.tankCapacityL ?? "",
        r.avgPct === null ? "" : Math.round(r.avgPct),
        r.dataUnreliable
          ? t("fuel_unreliable_badge")
          : r.consumedLiters !== null
            ? Math.round(r.consumedLiters)
            : r.hasData
              ? `${Math.round(r.consumedPct)}%`
              : "",
        r.km === null ? "" : Math.round(r.km),
        r.sampleCount,
        r.lPer100Km === null
          ? t(`fuel_reason_${r.lPer100Reason ?? "no_odometer"}`, { minKm: FUEL_MIN_KM, minPct: FUEL_MIN_CONSUMED_PCT })
          : num(r.lPer100Km, 1),
        r.dataUnreliable ? "" : r.refillCount,
        r.dataUnreliable ? "" : r.suspiciousDropCount,
      ]
        .map((c) => String(c ?? ""))
        .join(";")
    );
    katiKiyas("fuel", [header.join(";"), ...rows].join("\r\n"), ucCikti["fuel.csv"], ";", 10);
  }

  // ---- 4d) CANLI pencerenin oynaklığı: iddia değil ÖLÇÜM -----------------
  console.log("");
  bilgi("4d · CANLI pencere (range=ay, sonu 'şimdi') aynı uçtan İKİ KEZ okundu:");
  for (const [ad, h, yol, ayrac] of UCLAR) {
    const o = await oynakSutunlar(h, `${yol}?range=ay`, ayrac, patronToken);
    bilgi(`     ${ad}: kendiliğinden değişen sütun → ${o.join(", ") || "hiçbiri"}`);
  }
  bilgi("     4a-4c bu yüzden KAPANMIŞ pencerede ölçülüyor; canlı pencerede bayt eşitliği İMKÂNSIZ.");

  // ══ 5. DÖNEM DİLİ ════════════════════════════════════════════════════════
  console.log(`\n── 5. DÖNEM DİLİ ──`);
  for (const anahtar of ["gun", "hafta", "ay", "tumzaman"]) {
    const r = await cagir(SHIFTS, `/api/mobile/reports/shifts.csv?range=${anahtar}`, patronToken);
    iddia(`shifts · range=${anahtar} → 200`, r.status === 200, `${r.status} · ${r.satir} satır`);
  }
  {
    const r = await cagir(SHIFTS, `/api/mobile/reports/shifts.csv?${QS}`, patronToken);
    iddia("shifts · range=ozel + tarihler → 200", r.status === 200, `${r.status} · ${r.satir} satır`);
  }

  // ══ 6. BAYRAK ════════════════════════════════════════════════════════════
  console.log(`\n── 6. BAYRAK ──`);
  olculmedi(
    "EXPORT_ENABLED=false → 409 feature_disabled",
    "bu koşumda bayrak AÇIK; kapalı hâli AYRI koşumla ölçülür — NEXT_PUBLIC_EXPORT_ENABLED=false ile aynı betik"
  );
  bilgi("Kapı: app/api/mobile/_rapor/csv.ts disaAktarimKapali(), requireMobileAdmin sonrası İLK satır.");
  bilgi(`FUEL_ENABLED=${FUEL_ENABLED} — bu bayrak fuel.csv'yi KAPATMIYOR (panelde Raporlar › Yakıt da bayraksız).`);
  {
    const r = await cagir(FUEL, `/api/mobile/reports/fuel.csv?range=ay`, patronToken);
    iddia("fuel.csv · FUEL_ENABLED kapalıyken de 200 (panel paritesi)", r.status === 200, `${r.status}`);
  }
} catch (e) {
  console.error("\n✗ BEKLENMEDİK HATA:", e?.message ?? e);
  console.error((e?.stack ?? "").split("\n").slice(0, 6).join("\n"));
  dusen++;
}

console.log(`\n╚══ düşen: ${dusen}   ölçülmeyen: ${olculmeyen} ═══════════════════════════\n`);
process.exit(dusen > 0 ? 1 : 0);
