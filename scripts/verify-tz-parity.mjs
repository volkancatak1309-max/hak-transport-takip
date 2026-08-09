#!/usr/bin/env node
/**
 * SAAT DİLİMİ PARİTESİ — "tek kaynağa taşındı ama TEK KARAKTER değişmedi".
 *
 * NE ÇÖZÜYOR: 09.08.2026'da saat dilimi 19 dosyada 31 ayrı yerde düz metin
 * `"Europe/Vienna"` olarak yazılıydı. Mobil uygulama ise saatleri CİHAZIN
 * dilimine göre çiziyordu: panelde 06:17 görünen vardiya, UTC+3'teki bir
 * telefonda 07:17 çıkıyordu. Aynı olay iki yerde iki farklı saat.
 *
 * Düzeltme tek kaynak (`lib/tz.ts` → `TENANT_TZ`) kurdu ve 31 noktanın hepsini
 * oradan besledi. Taşınırken DEĞERİN değil yalnız KAYNAĞIN değişmesi
 * gerekiyordu — HAK61, Sendigo ve galzura-demo üçü de `Europe/Vienna`
 * kullanıyor ve hiçbirine env eklenmedi.
 *
 * NE YAPAR: CANLI veritabanından gerçek zaman damgalarını çeker (vardiya
 * başlangıç/bitişleri + telemetri) ve her birini `lib/format.ts`'in
 * BİÇİMLENDİRİCİLERİNDEN ve on bir SINIR fonksiyonundan geçirip deterministik
 * bir metin üretir. Aynı damga dosyasıyla değişiklikten ÖNCE ve SONRA
 * çalıştırılır; iki çıktı bayt bayt aynı olmak ZORUNDADIR.
 *
 * DST'ye elle eklenen altı damga bilinçli: Avusturya'nın 2026 geçiş anları
 * (29.03 02:00→03:00, 25.10 03:00→02:00) canlı veriye denk gelmeyebilir ve
 * saat dilimi hatalarının en sık saklandığı yer tam orasıdır.
 *
 * SALT OKUMA — hiçbir satır yazmaz, güncellemez, silmez.
 *
 * Kullanım:
 *   node scripts/verify-tz-parity.mjs <damgalar.json>          # HAK61 (.env.local)
 *   node scripts/verify-tz-parity.mjs <damgalar.json> .env.sendigo
 *
 * Damga dosyası yoksa canlıdan çekilip YAZILIR; varsa OKUNUR. ÖNCE/SONRA
 * turlarının aynı damgaları görmesini bu sağlar.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const ROOT = process.cwd();
const DAMGA_FILE = process.argv[2];
const ENV_FILE = path.resolve(ROOT, process.argv[3] ?? ".env.local");

if (!DAMGA_FILE) {
  console.error("Kullanım: node scripts/verify-tz-parity.mjs <damgalar.json> [.env dosyası]");
  process.exit(1);
}

// tsconfig "@/..." takma adını çözer — lib/format.ts artık lib/tz.ts'i böyle
// içe aktarıyor ve ham Node bu takma adı bilmez.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const base = path.join(ROOT, specifier.slice(2));
    for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
      if (fs.existsSync(base + ext)) {
        return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

// ── Damgalar ────────────────────────────────────────────────────────────────

/** Avusturya 2026 yaz saati geçişleri + gün/ay/yıl sınırları. */
const DST_ELDE = [
  "2026-03-29T00:59:59.000Z", // CET son saniye
  "2026-03-29T01:00:00.000Z", // CEST ilk an (yerel 03:00, 02:xx hiç yaşanmaz)
  "2026-03-29T01:00:01.000Z",
  "2026-10-25T00:59:59.000Z", // CEST son saniye
  "2026-10-25T01:00:00.000Z", // CET'e dönüş (yerel 02:00 İKİNCİ kez)
  "2026-10-25T01:00:01.000Z",
  "2026-01-01T23:30:00.000Z", // yıl sınırı (Viyana'da 02.01)
  "2026-12-31T23:00:00.000Z", // yıl sınırı (Viyana'da 01.01)
  "2026-06-15T22:15:00.000Z", // yaz: UTC gün ≠ Viyana günü
  "2026-02-28T23:45:00.000Z", // kış: UTC gün ≠ Viyana günü
];

async function damgalariGetir() {
  if (fs.existsSync(DAMGA_FILE)) {
    const j = JSON.parse(fs.readFileSync(DAMGA_FILE, "utf8"));
    return { canli: j.canli, kaynak: "önbellek" };
  }
  const env = Object.fromEntries(
    fs
      .readFileSync(ENV_FILE, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
  const sb = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const stamps = [];
  // Filonun İKİ ucundan: en eski ve en yeni vardiyalar (yaz+kış saati).
  for (const asc of [true, false]) {
    const { data, error } = await sb
      .from("time_entries")
      .select("started_at, ended_at")
      .order("started_at", { ascending: asc })
      .limit(25);
    if (error) throw new Error("time_entries: " + error.message);
    for (const r of data ?? []) {
      if (r.started_at) stamps.push(r.started_at);
      if (r.ended_at) stamps.push(r.ended_at);
    }
  }
  // Telemetri: saniye/milisaniye çeşitliliği. PENCERELİ — `order by recorded_at
  // desc` tüm tabloda ifade zaman aşımına düşüyor (canlıda ölçüldü); son 24
  // saatlik pencere aynı çeşitliliği zaman aşımı riski olmadan veriyor.
  // Damgalar zaten dosyaya önbelleklendiği için ÖNCE/SONRA turları etkilenmez.
  const pencere = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: tel, error: telErr } = await sb
    .from("device_telemetry")
    .select("recorded_at")
    .gte("recorded_at", pencere)
    .limit(25);
  if (telErr) {
    console.error(`  ! telemetri damgaları atlandı (${telErr.message})`);
  } else {
    for (const r of tel ?? []) if (r.recorded_at) stamps.push(r.recorded_at);
  }

  const canli = [...new Set(stamps)].sort();
  fs.writeFileSync(DAMGA_FILE, JSON.stringify({ canli }, null, 2), "utf8");
  return { canli, kaynak: "canlı" };
}

const { canli, kaynak } = await damgalariGetir();
const damgalar = [...canli, ...DST_ELDE];

if (canli.length < 10) {
  console.error(`✗ Yalnız ${canli.length} canlı damga bulundu — kanıt için en az 10 gerekiyor.`);
  process.exit(1);
}

// ── Biçimlendiricileri yükle ────────────────────────────────────────────────

const F = await import(pathToFileURL(path.join(ROOT, "lib", "format.ts")).href);

const iso = (d) => (d instanceof Date ? d.toISOString() : String(d));
const satirlar = [];
const yaz = (s) => satirlar.push(s);

yaz(`# SAAT DİLİMİ PARİTE ÇIKTISI`);
yaz(`# damga sayısı: ${damgalar.length} (canlı ${canli.length} + DST ${DST_ELDE.length})`);
yaz("");

// 1) BİÇİMLENDİRİCİLER — her damga × iki dil
yaz("## 1. Biçimlendiriciler (tr / de)");
for (const t of damgalar) {
  for (const loc of ["tr", "de"]) {
    yaz(
      [
        t,
        loc,
        F.formatDateTime(t, loc),
        F.formatTime(t, loc),
        F.formatDate(t, loc),
        F.formatWeekday(t, loc),
      ].join(" | ")
    );
  }
  yaz(`${t} | dayKey | ${F.viennaDayKey(t)}`);
}
yaz("");

// 2) SINIR FONKSİYONLARI — referans alan, deterministik olanlar
yaz("## 2. Sınır fonksiyonları (referanslı — deterministik)");
for (const t of damgalar) {
  const ref = new Date(t);
  yaz(
    [
      t,
      "startOfDay=" + iso(F.startOfDayVienna(ref)),
      "endOfDay=" + iso(F.endOfDayVienna(ref)),
      "+1g=" + iso(F.addCalendarDaysVienna(F.startOfDayVienna(ref), 1)),
      "-1g=" + iso(F.addCalendarDaysVienna(F.startOfDayVienna(ref), -1)),
      "+7g=" + iso(F.addCalendarDaysVienna(F.startOfDayVienna(ref), 7)),
    ].join(" | ")
  );
}
yaz("");

// 3) YMD AYRIŞTIRICILARI — DST günleri dahil, tamamen deterministik
yaz("## 3. YMD ayrıştırıcıları");
const ymdler = [
  ...new Set(damgalar.map((t) => F.viennaDayKey(t))),
  "2026-03-29",
  "2026-10-25",
  "2026-01-01",
  "2026-12-31",
  "2026-02-28",
  "2026-02-29", // 2026 artık yıl DEĞİL — geçersiz gün nasıl davranıyor
].sort();
for (const y of ymdler) {
  const s = F.startOfDayViennaFromYmd(y);
  const e = F.endOfDayViennaFromYmd(y);
  yaz(`${y} | start=${s ? iso(s) : "null"} | end=${e ? iso(e) : "null"}`);
}
yaz("");

// 4) ŞİMDİ TABANLI SINIRLAR — aynı gün içinde iki tur atıldığında sabittir
yaz("## 4. Şimdi tabanlı sınırlar (aynı takvim günü içinde sabit)");
yaz("startOfToday   = " + iso(F.startOfTodayVienna()));
yaz("endOfToday     = " + iso(F.endOfTodayVienna()));
yaz("startOfWeek    = " + iso(F.startOfWeekVienna()));
yaz("endOfWeek      = " + iso(F.endOfWeekVienna()));
yaz("startOfMonth   = " + iso(F.startOfMonthVienna()));
yaz("endOfMonth     = " + iso(F.endOfMonthVienna()));

const cikti = satirlar.join("\n") + "\n";
process.stdout.write(cikti);
console.error(`(damgalar: ${kaynak})`);
