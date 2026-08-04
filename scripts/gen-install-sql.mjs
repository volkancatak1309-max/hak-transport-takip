#!/usr/bin/env node
/**
 * db/install/sendigo-full.sql üreticisi.
 *
 * 001→043 migration'larını DOĞRU SIRAYLA tek dosyada birleştirir. Yapılan her
 * dönüşüm burada AÇIKÇA listelidir ve çalıştırıldığında rapor edilir — üretilen
 * dosya elle düzenlenmez, bu betik yeniden çalıştırılır.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "db", "migrations");
const OUT_DIR = join(ROOT, "db", "install");
const OUT = join(OUT_DIR, "sendigo-full.sql");

const changes = [];

/** docs/YENI-MUSTERI-KURULUM.md §1'deki sıra — 013/014 çiftleri dahil. */
const ORDER = [
  "001_initial.sql", "002_add_break_cargo.sql", "003_locations.sql",
  "004_employee_number.sql", "005_telegram.sql", "006_assignments.sql",
  "007_fuel_expenses.sql", "008_locations_require_shift.sql", "009_vehicles.sql",
  "010_undelivered.sql", "011_shift_watchdog.sql", "012_login_attempts.sql",
  "013_telegram_chat_unique.sql", "013_vehicles_flespi_device.sql",
  "014_device_telemetry.sql", "014_vehicle_penalties.sql",
  "015_geofences.sql", "016_vehicles_imei.sql", "017_telemetry_obd.sql",
  "018_vehicle_events.sql", "019_must_change_pin.sql", "020_driver_panel_v2.sql",
  "021_telemetry_extended.sql", "022_dtc_enrichment.sql", "023_vehicle_fleet.sql",
  "024_idle_episodes.sql", "025_worker_profile.sql", "026_report_rpcs.sql",
  "027_fuel_stats_edge_fix.sql", "028_test_data_flag.sql", "029_fleet_chief.sql",
  "030_phone_sanitize.sql", "031_worker_leaves.sql", "032_worker_terminated.sql",
  "033_device_config_epochs.sql", "034_geofence_purpose.sql", "035_depot_lock.sql",
  "036_depot_autostart.sql", "037_manual_shift_start.sql",
  "038_start_time_estimated.sql", "039_fuel_volume.sql", "040_shift_edit_log.sql",
  "041_counts_as_driver.sql", "042_login_unlock_log.sql",
  "043_worker_admin_log.sql",
];

// ─── KÖPRÜ: hiçbir migration'ın yaratmadığı kolon ────────────────────────────
// vehicles.tank_capacity_l canlı HAK61'e ELLE eklenmiş; repoda DDL'i yok.
// 028 bu kolona INSERT ediyor → boş veritabanında zincir 028'de KIRILIR.
const BRIDGE_TANK = `
-- ═══════════════════════════════════════════════════════════════════════════
-- KÖPRÜ 1 — vehicles.tank_capacity_l   (migration DEĞİL, eksik DDL tamamlaması)
-- ═══════════════════════════════════════════════════════════════════════════
-- Bu kolon HİÇBİR migration dosyasında yaratılmıyor: canlı HAK61 veritabanına
-- 2026 ortasında Supabase SQL Editor'dan elle eklenmiş ve repoya hiç girmemiş.
-- Boş bir veritabanında yokluğu ZİNCİRİ KIRAR:
--   • 028_test_data_flag.sql → insert into public.vehicles (... tank_capacity_l ...)
--     "column tank_capacity_l of relation vehicles does not exist" → 028-040 çalışmaz.
--   • lib/reports.ts:630 → .select("id, plate, assigned_worker_id, tank_capacity_l")
--     yakıt raporu kolon hatası döndürür.
-- Tip/ölçek canlı HAK61 şemasından alındı (numeric, litre; NULL = bilinmiyor).
alter table public.vehicles
  add column if not exists tank_capacity_l numeric;

comment on column public.vehicles.tank_capacity_l is
  'Depo kapasitesi (litre). Yakıt raporunda yüzde→litre çevrimi için; NULL ise litre hesaplanmaz.';
`;

// ─── 030 UYARLAMASI ─────────────────────────────────────────────────────────
// Özgün dosya bir HAK61 VERİ ONARIMIDIR (iki çalışanın numarasındaki görünmez
// Unicode işaretleri). Boş veritabanında onarılacak satır yoktur; kalıcı ŞEMA
// parçası yalnız biçim kısıtıdır.
const REPLACE_030 = `-- ═══ 030_phone_sanitize.sql — UYARLANDI (bkz. dosya başındaki "Sapmalar") ═══
--
-- Özgün dosya HAK61'e özgü bir VERİ ONARIMI: iki çalışanın numarasına yapışmış
-- görünmez Unicode yön işaretlerini (U+202A/U+202C) temizler, öncesinde/sonrasında
-- teşhis SELECT'leri basar. Boş bir veritabanında temizlenecek satır YOKTUR.
--
-- Buraya YALNIZ kalıcı şema parçası alındı: numara biçimi kısıtı (nüks koruması).
--
-- ÇIKARILANLAR ve gerekçesi:
--   • 6 teşhis SELECT'i    → boş DB'de 0 satır; kurulum çıktısını kirletir.
--   • UPDATE workers SET phone = regexp_replace(...) → temizlenecek kayıt yok (no-op).
--   • DELETE FROM login_attempts WHERE identifier LIKE '%8110302%' OR ...
--     → GERÇEK HAK61 telefon parçaları içerir. Başka bir müşterinin kurulum
--       dosyasında bulunmamalı (gizlilik kuralı) ve boş DB'de zaten no-op.
--
-- Kısıt, 028'in yarattığı test hesabının numarasıyla (+430000000001) uyumludur.
alter table public.workers
  drop constraint if exists workers_phone_temiz;

alter table public.workers
  add constraint workers_phone_temiz
  check (phone is null or phone ~ '^\\+?[0-9]{6,20}$');
`;

// ─── 033 UYARLAMASI ─────────────────────────────────────────────────────────
// Migration, tabloyu kurduktan sonra HAK61'in KENDİ cihaz dönem kaydını da
// yazıyor. Yeni bir müşteride bu kayıt hem yanlış hem başkasının verisi.
const DROP_033_INSERT = `-- ═══ [birleştirici] HAK61'E ÖZEL VERİ SATIRI ÇIKARILDI ═══════════════════
-- Özgün 033, tabloyu kurduktan sonra şu kaydı da yazıyordu:
--   params = '11104: 120->131'
--   note   = 'Asiri hiz uyari esigi 120->131 km/s (28 cihaz + DO-505GS kuyruk…)'
--
-- Bu, HAK61 filosunda 23.07.2026'da yapılan bir cihaz ayarı değişikliğinin
-- kaydıdır: 28 cihazı ve bir HAK61 PLAKASINI (DO-505GS) adlandırır. Yeni bir
-- kurulumda böyle bir eşik değişikliği HİÇ OLMADI; kayıt hem olguyu yanlış
-- anlatır hem başka bir müşterinin verisini taşır.
--
-- CANLI ETKİ (Sendigo kabul testi, 31.07.2026): /admin/alarmlar sayfasında
-- "Seit den neuen Schwellen" (yeni eşiklerden beri) filtresi çıkıyordu —
-- Sendigo'da hiç yaşanmamış bir olaya göre süzme seçeneği.
--
-- Tablo KURULUR (kod onu okuyor, yokluğunda alarm sayfası hata verir);
-- yalnız satır yazılmaz. Yeni müşteri kendi cihaz ayarını değiştirdiğinde
-- kaydı kendisi ekler.
`;

// ─── Dosya bazlı cerrahi dönüşümler ─────────────────────────────────────────
function transform(file, sql) {
  // (d) 033: tablo kalır, HAK61'e özel INSERT çıkar.
  if (file === "033_device_config_epochs.sql") {
    const before = sql;
    sql = sql.replace(
      /insert into public\.device_config_epochs[\s\S]*?\n\);\n/,
      DROP_033_INSERT
    );
    if (sql === before) {
      throw new Error(
        "033 INSERT bloğu bulunamadı — dosya değişmiş olabilir. " +
          "Birleştirici sessizce HAK61 verisini yazmasın diye durduruldu."
      );
    }
    changes.push(`${file}: HAK61'e özel device_config_epochs satırı çıkarıldı`);
    return sql;
  }

  // (a) İç içe işlem bloklarını kaldır: tüm dosya TEK transaction içinde koşuyor.
  //     İçerideki `commit;` dış transaction'ı erkenden kapatır ve kalan
  //     ifadeler transaction DIŞINDA çalışırdı — kısmi kurulum riski.
  if (file === "008_locations_require_shift.sql") {
    const before = sql;
    sql = sql.replace(/^\s*(begin|commit)\s*;\s*$/gim, (m) =>
      `-- [birleştirici] kaldırıldı: ${m.trim()}  (dosyanın tamamı tek transaction içinde)`
    );
    if (sql !== before) changes.push(`${file}: iç begin/commit yorumlandı`);
  }

  // (b) 030 tamamen uyarlanmış sürümle değiştirilir.
  if (file === "030_phone_sanitize.sql") {
    changes.push(`${file}: veri-onarımı çıkarıldı, yalnız biçim kısıtı alındı`);
    return REPLACE_030;
  }

  // (c) 006/007: tekrar çalıştırmaya dayanıklılık. Boş veritabanında davranış
  //     BİREBİR aynı; yalnız ikinci çalıştırma hata vermek yerine no-op olur.
  if (file === "006_assignments.sql" || file === "007_fuel_expenses.sql") {
    const before = sql;
    sql = sql.replace(/^create table public\./gim, "create table if not exists public.");
    sql = sql.replace(/^create index idx_/gim, "create index if not exists idx_");
    // create trigger'ın IF NOT EXISTS'i yok → önüne drop if exists konur.
    sql = sql.replace(
      /^create trigger (\w+)\n(\s*)before update on (public\.\w+)/gim,
      (_m, trg, ind, tbl) =>
        `drop trigger if exists ${trg} on ${tbl};\ncreate trigger ${trg}\n${ind}before update on ${tbl}`
    );
    if (sql !== before) changes.push(`${file}: create table/index/trigger idempotent yapıldı`);
  }

  return sql;
}

// ─── Birleştir ──────────────────────────────────────────────────────────────
const HEADER = `-- ═══════════════════════════════════════════════════════════════════════════
--  SENDIGO — TEK PARÇA KURULUM SQL'İ
--  hak-transport-takip · şema 001 → 043 · üretim tarihi: 04.08.2026
-- ═══════════════════════════════════════════════════════════════════════════
--
--  NE İŞE YARAR
--  BOŞ bir Supabase projesini uygulamanın beklediği tam şemaya getirir.
--  Supabase → SQL Editor → hepsini yapıştır → Run. Tek seferde.
--
--  NASIL ÇALIŞIR — HEPSİ YA DA HİÇBİRİ
--  Dosyanın tamamı TEK transaction içindedir. Herhangi bir ifade hata verirse
--  HİÇBİR ŞEY uygulanmaz; yarım kalmış şema oluşmaz. Hatayı düzeltip dosyayı
--  baştan çalıştırmak güvenlidir.
--
--  ÖNCE BOŞLUK DENETİMİ
--  İlk blok veritabanının boş olduğunu doğrular. Doluysa betik kendini durdurur
--  — mevcut bir müşterinin veritabanına yanlışlıkla çalıştırılamaz.
--
--  ⚠️  HAK61'DE ÇALIŞTIRMAYIN. Bu dosya sıfırdan kurulum içindir.
--
--  ÇALIŞTIRDIKTAN SONRA
--    select count(*) from information_schema.tables where table_schema='public';
--    -- 20+ tablo bekleniyor
--    select plate, is_test from public.vehicles;      -- TEST-001, true
--  Sonra: npm run bootstrap:admin (ilk yönetici) — bkz. docs/SENDIGO-KURULUM.md
--
-- ───────────────────────────────────────────────────────────────────────────
--  SAPMALAR — kaynak migration'lara göre bilinçli 4 fark
--  1) KÖPRÜ: vehicles.tank_capacity_l eklendi. Hiçbir migration onu
--     yaratmıyor (canlı HAK61'e elle eklenmiş); yokluğunda 028 KIRILIR.
--  2) 008 ve 030'daki iç \`begin;\`/\`commit;\` kaldırıldı — dosyanın tamamı
--     zaten tek transaction. İç commit dış transaction'ı erken kapatırdı.
--  3) 030 uyarlandı: HAK61'e özgü veri onarımı ve gerçek telefon parçaları
--     içeren DELETE çıkarıldı; kalıcı şema parçası (biçim kısıtı) korundu.
--  4) 006/007'deki create table/index/trigger idempotent yapıldı. Boş
--     veritabanında sonuç BİREBİR aynı; yalnız ikinci çalıştırma hata vermez.
--  SEED DOSYALARI DAHİL DEĞİLDİR (db/seed/* — demo araç/rota verisi).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── BOŞLUK DENETİMİ ────────────────────────────────────────────────────────
do $guard$
declare
  v_found text;
begin
  select string_agg(table_name, ', ' order by table_name) into v_found
    from information_schema.tables
   where table_schema = 'public'
     and table_name in ('workers','time_entries','vehicles','device_telemetry');
  if v_found is not null then
    raise exception
      'DURDURULDU: bu veritabanı BOŞ DEĞİL (bulunan tablolar: %). Bu dosya yalnız SIFIRDAN kurulum içindir; mevcut bir kuruluma çalıştırılmaz.',
      v_found;
  end if;
end
$guard$;

`;

const parts = [HEADER];

for (const file of ORDER) {
  let sql = readFileSync(join(SRC, file), "utf8").replace(/\r\n/g, "\n").trimEnd();
  sql = transform(file, sql);

  parts.push(
    `\n\n-- ╔═══════════════════════════════════════════════════════════════════════╗\n` +
      `-- ║  ${file.padEnd(67)}║\n` +
      `-- ╚═══════════════════════════════════════════════════════════════════════╝\n\n` +
      sql +
      "\n"
  );

  // Köprü, vehicles tablosunun yaratıldığı 009'un HEMEN ARDINDAN girer:
  // ondan sonraki her okuma/yazma (026 yorumu, 028 insert) kolonu bulur.
  if (file === "009_vehicles.sql") {
    parts.push("\n" + BRIDGE_TANK);
    changes.push("009 sonrası: KÖPRÜ vehicles.tank_capacity_l eklendi");
  }
}

parts.push(`

-- ═══════════════════════════════════════════════════════════════════════════
--  BİTTİ — şema hazır.
-- ═══════════════════════════════════════════════════════════════════════════
commit;
`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, parts.join(""), "utf8");

const text = parts.join("");
console.log(`✓ ${OUT}`);
console.log(`  ${ORDER.length} migration · ${text.split("\n").length} satır · ${text.length} bayt`);
console.log("\nUYGULANAN DÖNÜŞÜMLER:");
for (const c of changes) console.log("  • " + c);
