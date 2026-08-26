#!/usr/bin/env node
/**
 * db/install/<musteri>-full.sql üreticisi.
 *
 * `db/migrations` altındaki migration'ları DOĞRU SIRAYLA tek dosyada
 * birleştirir (bugün 001→079). Yapılan her dönüşüm burada AÇIKÇA listelidir ve
 * çalıştırıldığında rapor edilir — üretilen dosya elle düzenlenmez, bu betik
 * yeniden çalıştırılır.
 *
 * ⚠️ YENİ MIGRATION EKLEYEN: dosyayı `ORDER`a (ya da gerekçeyle `HARIC`e) ekle
 * ve bu betiği İKİ MÜŞTERİ İÇİN DE yeniden çalıştır. Unutursan
 * `npm run lint:install-sql` seni durdurur — liste 043'te bir kez bayatladı ve
 * 35 migration kurulum dosyasının dışında kaldı (24.08.2026'da yakalandı).
 *
 * Kullanım:
 *   node scripts/gen-install-sql.mjs            → db/install/sendigo-full.sql
 *   node scripts/gen-install-sql.mjs galzura    → db/install/galzura-full.sql
 *
 * MÜŞTERİ ADI YALNIZ BAŞLIĞA ve dosya adına girer (07.08.2026). Şema müşteriden
 * bağımsızdır: üretilen SQL'in gövdesi her müşteride BAYT BAYT aynıdır, çünkü
 * kurulum dosyası şemayı kurar, veriyi değil. Üçüncü müşteri için ikinci bir
 * üreteç yazmak iki kaynağın zamanla ayrışması demekti.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "db", "migrations");
/** Yeni kurulumda yazılan varsayılan sözlükler — hizalama dosyasına GİRMEZ. */
const SEED = join(ROOT, "db", "install", "seed-varsayilanlar.sql");
const OUT_DIR = join(ROOT, "db", "install");

const changes = [];

/**
 * Kurulum dosyasına giren migration'lar, ÇALIŞMA SIRASIYLA.
 *
 * ⚠️ BU LİSTE ELLE TUTULUR ve `scripts/check-install-sql.mjs` onu denetler:
 * `db/migrations` altındaki bir dosya ne burada ne `HARIC` içindeyse muhafız
 * `npm run verify`i KIRAR. Liste 24.08.2026'ya kadar 043'te takılı kalmıştı ve
 * o gün fark edildi — yeni bir müşteri açılsaydı şema 35 migration EKSİK
 * kurulacaktı. Muhafız tam olarak bunun tekrarını engellemek için var.
 *
 * Sıra dosya adındaki numaradır; 013/014 çiftleri (aynı numara, iki dosya)
 * docs/YENI-MUSTERI-KURULUM.md §1'deki sırayla korunur.
 */
const ORDER = [
  "001_initial.sql", "002_add_break_cargo.sql", "003_locations.sql",
  "004_employee_number.sql", "005_telegram.sql", "006_assignments.sql",
  "007_fuel_expenses.sql", "008_locations_require_shift.sql", "009_vehicles.sql",
  "010_undelivered.sql", "011_shift_watchdog.sql", "012_login_attempts.sql",
  "013_vehicles_flespi_device.sql",
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
  "044_mobile_token_version.sql", "045_owner_security.sql",
  "046_access_gates.sql", "047_pdf_fingerprints.sql", "048_gate_exempt.sql",
  "049_fuel_report_index.sql", "050_report_perf.sql",
  "051_drop_odometer_spans.sql", "052_shift_distance_and_refill_merge.sql",
  "053_covering_indexes.sql", "055_vehicle_device_model.sql",
  "056_vehicle_fault_reports.sql", "057_fault_report_closed.sql",
  "058_action_snoozes.sql", "059_fleets.sql",
  "060_last_recorded_at_batch.sql", "061_idle_episode_cursors_batch.sql",
  "062_autoshift_telemetry_batch.sql", "063_geofence_category.sql",
  "064_customer_zone_visits.sql", "065_latest_telemetry_batch.sql",
  "066_seferler.sql", "067_first_ignition_batch.sql",
  "068_zone_visit_zone_closed.sql", "069_geofence_category_repair.sql",
  "070_sefer_koprular.sql", "071_messaging.sql", "072_worker_fleet.sql",
  "073_messaging_groups.sql", "074_push_tokens.sql",
  "076_tenant_cost_rates.sql", "077_fuel_price_reference.sql",
  "078_worker_documents.sql", "079_sefer_takip_linkleri.sql",
  "080_teslimat_kaniti.sql",
  "081_dvir_ve_bakim.sql",
  "082_sefer_duraklari.sql",
  "083_takip_durak.sql",
  "084_haftalik_aksiyon.sql",
  "085_sefer_karlilik.sql",
  "086_mevzuat_uyari.sql",
  "087_vardiya_duzeltme_izi.sql",
  "088_sofor_odul.sql",
  "089_co2_panosu.sql",
  "090_saklama_politikasi.sql",
  "091_takograf.sql",
];

/** Listedeki son migration numarası — başlıklar bunu yazar, elle güncellenmez. */
const SON_MIGRATION = ORDER[ORDER.length - 1].slice(0, 3);

/**
 * KURULUM DOSYASINA BİLEREK GİRMEYEN migration'lar — her biri GEREKÇELİ.
 *
 * Muhafız bu sözlüğü de okur: bir dosyayı sessizce atlamak imkânsız, atlamak
 * için buraya bir cümle yazmak gerekir. Gerekçesi olmayan giriş de muhafızı
 * kırar.
 */
const HARIC = {
  "013_telegram_chat_unique.sql":
    "TAMAMI Telegram: telegram_chat_id üzerinde tekilleştirme + kısmi UNIQUE " +
    "indeks. O kolon 005 uyarlamasıyla artık kurulmuyor (Telegram katmanı " +
    "20.08.2026'da söküldü), yani bu dosya var olmayan bir kolona indeks kurardı.",
  "054_demo_telemetry_retention.sql":
    "YALNIZ galzura-demo veritabanı için. Dosyanın kendi başlığı şunu söylüyor: " +
    "fonksiyon HAK61/Sendigo'da HİÇ VAR OLMAMALI — rota oralarda 404 alsın diye. " +
    "Genel kurulum dosyasına koymak, iki katmanlı savunmanın bir katmanını " +
    "gerçek müşterilerde kaldırırdı (ham telemetriyi silen bir fonksiyon).",
  "075_phone_trunk_zero.sql":
    "SIFIR DDL — saf veri onarımı (HAK61'de 18 numaradaki ulusal trunk sıfırı). " +
    "Boş bir veritabanında yedi ifadesinin hepsi no-op; kalıcı şema katkısı YOK. " +
    "030'un bıraktığı biçim kısıtı zaten kurulu, yani şema 078'e birebir eşit.",
};

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

// ─── KÖPRÜ 2: hiçbir migration'ın ZAMANINDA yaratmadığı kolon ───────────────
// geofences.archived_at — 063 onu KULLANIYOR ama YARATMIYOR; yaratan migration
// 069, yani ALTI DOSYA SONRA. Canlı HAK61'de kolon zaten vardı (repo dışında
// eklenmiş), o yüzden fark edilmemişti.
const BRIDGE_ARCHIVED = `
-- ═══════════════════════════════════════════════════════════════════════════
-- KÖPRÜ 2 — geofences.archived_at   (migration DEĞİL, SIRA düzeltmesi)
-- ═══════════════════════════════════════════════════════════════════════════
-- 063_geofence_category.sql son adımında şu kısmi indeksi kuruyor:
--     create index ... on public.geofences (active) where archived_at is null;
-- ama kolonu KENDİSİ eklemiyor — daha eskisinin eklediğini varsayıyor. Kolonu
-- gerçekte 069 ekliyor, yani ALTI DOSYA SONRA.
--
-- ÖLÇÜLDÜ (24.08.2026, boş PostgreSQL 16 üzerinde): köprüsüz kurulum
--   "ERROR: column archived_at does not exist" ile 063'te DURUYOR.
-- Tüm dosya tek transaction olduğu için sonuç YARIM ŞEMA değil, HİÇ ŞEMA.
-- 069'un başlığındaki "kuvvetli şüphe" böylece ölçülmüş bir olgu oldu.
--
-- Kolon, geofences tablosunun yaratıldığı 015'in HEMEN ARDINDAN eklenir;
-- 069'daki \`add column if not exists\` sonra no-op'a döner ve sonuçtaki şema
-- canlı HAK61'inkiyle BİREBİR aynı kalır.
alter table public.geofences
  add column if not exists archived_at timestamptz;

comment on column public.geofences.archived_at is
  'Arşivlenme anı (NULL = etkin). 063 bu kolona kısmi indeks kuruyor, 069 ekliyor; kurulum dosyasında sıra düzeltildi.';
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

// ─── 005 UYARLAMASI ─────────────────────────────────────────────────────────
// Telegram katmanı 20.08.2026'da TAMAMEN kaldırıldı (kod + canlı şema). Yeni
// bir kiracıya onu kurmak, uygulamanın hiç okumadığı dört KİŞİSEL VERİ kolonu
// ve bir tablo yaratmak olurdu.
const REPLACE_005 = `-- ═══ 005_telegram.sql — UYARLANDI (Telegram katmanı KALDIRILDI) ═══════════
--
-- Özgün dosya üç şey yapıyor: (1) workers'a dört telegram_* kolonu, (2)
-- telegram_link_codes tablosu, (3) time_entries'e bildirim damgaları.
--
-- (1) ve (2) BU DOSYAYA ALINMADI. Telegram katmanı 20.08.2026'da tamamen
-- söküldü: kodda tek satır kalmadı (grep ile denetlendi — yalnız söküm
-- muhafızı adı geçiriyor) ve canlı HAK61'de kolonlar/tablo DÜŞÜRÜLDÜ.
-- ÖLÇÜLDÜ (24.08.2026, PostgREST OpenAPI): canlı workers'ta telegram_* YOK.
--
-- Yeni bir kiracıda onları kurmak iki bakımdan yanlış olurdu: uygulamanın
-- hiç okumadığı ölü şema, ÜSTELİK biri (telegram_username) kişisel veri.
--
-- ⚠️ (3) KORUNDU: time_entries bildirim damgaları Telegram'a ait DEĞİL,
-- vardiya akışının kendi alanları ve kod hâlâ yazıyor.
--
-- 013_telegram_chat_unique.sql da AYNI GEREKÇEYLE hiç alınmadı (yalnız
-- telegram_chat_id üzerinde tekil indeks kuruyor — kolon artık yok).
alter table public.time_entries
  add column if not exists nine_hour_notified_at timestamptz,
  add column if not exists lenkzeit_notified_at timestamptz,
  add column if not exists summary_notified_at timestamptz;
`;

// ─── 046 UYARLAMASI ─────────────────────────────────────────────────────────
// Migration, kill_switch_secret tablosunu kurduktan sonra HAK61'in gizli soru
// CEVABININ bcrypt hash'ini de yazıyor. Başka bir müşterinin veritabanına o
// hash'i taşımak, HAK61'in cevabını bilen birine o müşterinin ölü adam
// anahtarını açma yetkisi vermek olurdu.
const DROP_046_INSERT = `-- ═══ [birleştirici] HAK61'İN GİZLİ SORU HASH'İ ÇIKARILDI ═════════════════
-- Özgün 046, tabloyu kurduktan sonra HAK61'in cevabının bcrypt hash'ini de
-- yazıyordu. O satır BU MÜŞTERİYE AİT DEĞİLDİR: hash'i taşımak, HAK61'in
-- cevabını bilen birinin burada da ölü adam anahtarını açabilmesi demekti.
--
-- SATIRSIZ DAVRANIŞ GÜVENLİ: lib/kill-switch.ts verifySecret() satır yoksa
-- \`false\` döner (fail-closed) — anahtar AÇILAMAZ, sistem normal çalışır.
--
-- Kendi cevabınızı belirlemek için (düz metin hiçbir yere yazılmaz):
--   node -e "console.log(require('bcryptjs').hashSync('CEVABINIZ', 10))"
--   insert into public.kill_switch_secret (answer_hash) values ('<hash>');
`;

/**
 * SENTETİK LİTERALLER — kurulum dosyasında DURMASI GEREKEN sahte değerler.
 *
 * 028'in yarattığı kalıcı test hesabının numarası ve parola yeri tutucusu.
 * İkisi de gerçek kimseye ait değil; maskelenirse test hesabı bozulur.
 * Muhafız (`check-install-sql.mjs`) da bu listeyi okuyor — tek kaynak.
 */
export const SENTETIK = {
  telefonlar: ["+430000000001"],
  hashler: ["$2a$10$0000000000000000000000000000000000000000000000000000"],
};

/** Yorumdaki gerçek numaranın yerine geçen metin. */
const TELEFON_MASKESI = "'+XXXXXXXXXXXX'";

// ─── Dosya bazlı cerrahi dönüşümler ─────────────────────────────────────────
function transform(file, sql) {
  // GÖVDESİ TÜMÜYLE DEĞİŞTİRİLEN İKİ DOSYA EN ÖNDE: özgün metinleri hiç
  // kullanılmadığı için aşağıdaki tarama adımlarına girmemeliler. 030 ÇALIŞAN
  // bir ifadede gerçek numara taşıyor ve telefon denetimi (h) onu boşuna
  // durdururdu — oysa o satır zaten çıkarılıyor.
  //
  // (g) 005: telegram kolonları/tablosu çıkar, bildirim damgaları kalır.
  if (file === "005_telegram.sql") {
    changes.push(`${file}: telegram_* kolonları + telegram_link_codes ALINMADI`);
    return REPLACE_005;
  }

  // (b) 030 tamamen uyarlanmış sürümle değiştirilir.
  if (file === "030_phone_sanitize.sql") {
    changes.push(`${file}: veri-onarımı çıkarıldı, yalnız biçim kısıtı alındı`);
    return REPLACE_030;
  }

  /**
   * (a) İÇ İŞLEM BLOKLARI — HER DOSYADA.
   *
   * Kurulum dosyasının tamamı TEK transaction içinde koşuyor. Bir dosyanın
   * içindeki `commit;` dış transaction'ı ERKEN kapatır; ondan sonraki her şey
   * transaction DIŞINDA çalışır ve hata hâlinde yarım şema kalır.
   *
   * ⚠️ Eskiden yalnız 008'e uygulanıyordu, çünkü 001-043 arasında iç işlem
   * bloğu olan tek dosya oydu (030 zaten tümüyle değiştiriliyor). 044-078
   * arasında AYNI desendeki 18 dosya var — kural dosyaya değil, DESENE
   * bağlandı: yeni migration'lar da otomatik kapsanır.
   *
   * plpgsql gövdelerindeki `begin` (noktalı virgülsüz) ve `end;` EŞLEŞMEZ:
   * desen yalnız satırın tamamı `begin;` / `commit;` olan ifadeleri alır.
   */
  {
    const before = sql;
    sql = sql.replace(/^\s*(begin|commit)\s*;\s*$/gim, (m) =>
      `-- [birleştirici] kaldırıldı: ${m.trim()}  (dosyanın tamamı tek transaction içinde)`
    );
    if (sql !== before) changes.push(`${file}: iç begin/commit yorumlandı`);
  }

  /**
   * (h) GERÇEK TELEFON NUMARALARI — HER DOSYADA.
   *
   * Migration'ların "çalıştırdıktan sonra şunu yap" örnekleri gerçek numara
   * içeriyor (045'te patronun, 048'de muafiyet örneğinin). O örnekler HAK61
   * için yazıldı; başka bir müşterinin veritabanına kopyalanacak bir dosyada
   * durmaları gerekmiyor ve kişisel veri.
   *
   * YORUM satırındaki numara maskelenir. ÇALIŞAN bir ifadede sentetik olmayan
   * numara görülürse betik DURUR: orada maskelemek davranışı sessizce
   * değiştirmek olurdu, kararı insan versin.
   */
  {
    const telefon = /'\+\d{8,}'/g;
    const izinli = new Set(SENTETIK.telefonlar.map((t) => `'${t}'`));
    let maskelenen = 0;
    sql = sql
      .split("\n")
      .map((satir) => {
        const bulunan = satir.match(telefon)?.filter((t) => !izinli.has(t));
        if (!bulunan || bulunan.length === 0) return satir;
        if (!/^\s*--/.test(satir)) {
          throw new Error(
            `${file}: ÇALIŞAN ifadede gerçek telefon numarası var (${bulunan[0]}). ` +
              "Kurulum dosyası başka müşterinin veritabanına gidiyor; maskeleme " +
              "davranışı değiştirebileceği için elle karar verilmeli."
          );
        }
        maskelenen += bulunan.length;
        return satir.replace(telefon, (m) => (izinli.has(m) ? m : TELEFON_MASKESI));
      })
      .join("\n");
    if (maskelenen > 0) {
      changes.push(`${file}: yorumdaki ${maskelenen} gerçek telefon numarası maskelendi`);
    }
  }

  // (e) 046: tablo kalır, HAK61'in sır hash'i çıkar.
  if (file === "046_access_gates.sql") {
    const before = sql;
    sql = sql.replace(
      /insert into public\.kill_switch_secret[\s\S]*?where not exists \(select 1 from public\.kill_switch_secret\);\n/,
      DROP_046_INSERT
    );
    if (sql === before) {
      throw new Error(
        "046 kill_switch_secret INSERT'i bulunamadı — dosya değişmiş olabilir. " +
          "Birleştirici sessizce HAK61'in sır hash'ini yazmasın diye durduruldu."
      );
    }
    changes.push(`${file}: HAK61'in gizli soru hash'i çıkarıldı (fail-closed)`);
    return sql;
  }

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
function basSayfa(TENANT) {
  return `-- ═══════════════════════════════════════════════════════════════════════════
--  ${TENANT.toUpperCase()} — TEK PARÇA KURULUM SQL'İ
--  hak-transport-takip · şema 001 → ${SON_MIGRATION} · üreten: scripts/gen-install-sql.mjs
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
--  ÇALIŞTIRDIKTAN SONRA (24.08.2026'da boş PostgreSQL 16'da ÖLÇÜLDÜ)
--    select count(*) from information_schema.tables
--     where table_schema='public' and table_type='BASE TABLE';   -- 47
--    select count(*) from pg_indexes where schemaname='public';  -- 156
--    select plate, is_test from public.vehicles;      -- TEST-001, true
--  Sonra: npm run bootstrap:admin (ilk yönetici) — bkz. docs/SENDIGO-KURULUM.md
--
-- ───────────────────────────────────────────────────────────────────────────
--  SAPMALAR — kaynak migration'lara göre bilinçli 7 fark
--  1) İKİ KÖPRÜ KOLONU eklendi (ikisi de boş veritabanında ÖLÇÜLDÜ):
--     • vehicles.tank_capacity_l — hiçbir migration yaratmıyor (canlı HAK61'e
--       elle eklenmiş); yokluğunda 028 KIRILIR.
--     • geofences.archived_at — 063 kullanıyor, 069 yaratıyor (altı dosya
--       sonra); yokluğunda kurulum 063'te "column does not exist" ile DURUR.
--  2) İç \`begin;\`/\`commit;\` satırları YORUMLANDI (20 dosyada) — dosyanın
--     tamamı zaten tek transaction. İç commit dış transaction'ı erken kapatır
--     ve sonrasındaki her şey transaction DIŞINDA kalırdı.
--  3) 030 uyarlandı: HAK61'e özgü veri onarımı ve gerçek telefon parçaları
--     içeren DELETE çıkarıldı; kalıcı şema parçası (biçim kısıtı) korundu.
--  4) 006/007'deki create table/index/trigger idempotent yapıldı. Boş
--     veritabanında sonuç BİREBİR aynı; yalnız ikinci çalıştırma hata vermez.
--  5) 033 ve 046'daki HAK61'E ÖZEL SATIRLAR çıkarıldı: cihaz eşiği kaydı
--     (başka filonun olayı) ve gizli soru hash'i (başka müşterinin SIRRI).
--     Tablolar kurulur, satırlar yazılmaz — ikisi de fail-closed davranır.
--  6) TELEGRAM KATMANI HİÇ KURULMAZ: 005'in telegram_* kolonları ve
--     telegram_link_codes tablosu çıkarıldı, 013_telegram_chat_unique hiç
--     alınmadı. Katman 20.08.2026'da söküldü; kodda tek satır yok, canlı
--     HAK61'de kolonlar düşürüldü. Biri (telegram_username) kişisel veridir.
--  7) ÜÇ MIGRATION HİÇ ALINMADI: 013_telegram_chat_unique (üstteki madde),
--     054 (yalnız galzura-demo'ya ait telemetri silme fonksiyonu — gerçek
--     müşteride VAR OLMAMASI bir güvenlik katmanı) ve 075 (sıfır DDL, saf
--     veri onarımı; boş veritabanında tümüyle no-op).
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
}

/**
 * Kurulum dosyasını BELLEKTE üretir — dosyaya yazmaz.
 *
 * Muhafız (`scripts/check-install-sql.mjs`) bunu çağırıp diskteki dosyayla
 * bayt bayt karşılaştırıyor: liste ya da bir migration değiştiği hâlde
 * `db/install/*-full.sql` yeniden üretilmediyse `npm run verify` kırılır.
 * "Üretmeyi unuttum" sessiz kalamaz.
 */
/**
 * Verilen migration'ları dönüştürüp başlıklı parçalar hâline getirir.
 *
 * `build()` (sıfırdan kurulum) ve `scripts/gen-align-sql.mjs` (mevcut kiracıyı
 * hizalama) AYNI dönüşümleri kullansın diye ayrıldı: iç begin/commit temizliği,
 * telefon maskeleme, 046'nın sır satırı, 033'ün HAK61 kaydı… İki yerde
 * tekrarlansaydı biri düzeltilip diğeri unutulurdu.
 *
 * `koprular` false ise köprü kolonları eklenmez (çağıran kendi yerleştirir).
 */
export function parcala(dosyalar, { koprular = true } = {}) {
  changes.length = 0;
  const parts = [];

  for (const file of dosyalar) {
    let sql = readFileSync(join(SRC, file), "utf8").replace(/\r\n/g, "\n").trimEnd();
    sql = transform(file, sql);

    parts.push(
      `\n\n-- ╔═══════════════════════════════════════════════════════════════════════╗\n` +
        `-- ║  ${file.padEnd(67)}║\n` +
        `-- ╚═══════════════════════════════════════════════════════════════════════╝\n\n` +
        sql +
        "\n"
    );

    if (!koprular) continue;
    // Köprü, vehicles tablosunun yaratıldığı 009'un HEMEN ARDINDAN girer:
    // ondan sonraki her okuma/yazma (026 yorumu, 028 insert) kolonu bulur.
    if (file === "009_vehicles.sql") {
      parts.push("\n" + BRIDGE_TANK);
      changes.push("009 sonrası: KÖPRÜ 1 — vehicles.tank_capacity_l eklendi");
    }
    // İkinci köprü, geofences tablosunun yaratıldığı 015'in ardından: 063'ün
    // kullandığı ama 069'un eklediği kolon (boş DB'de ölçüldü, 063 patlıyordu).
    if (file === "015_geofences.sql") {
      parts.push("\n" + BRIDGE_ARCHIVED);
      changes.push("015 sonrası: KÖPRÜ 2 — geofences.archived_at eklendi");
    }
  }

  return { parts, changes: [...changes] };
}

/** Hizalama üreteci de aynı köprü metnini kullansın — tek kaynak. */
export { BRIDGE_TANK, BRIDGE_ARCHIVED };

export function build(tenant) {
  const TENANT = String(tenant ?? "sendigo").trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(TENANT)) {
    throw new Error(`Geçersiz müşteri kodu: "${TENANT}" (yalnız a-z, 0-9, tire)`);
  }
  const { parts: govde, changes: uygulanan } = parcala(ORDER);
  const parts = [basSayfa(TENANT), ...govde];
  changes.length = 0;
  changes.push(...uygulanan);

  parts.push(`

-- ═══════════════════════════════════════════════════════════════════════════
--  BİTTİ — şema hazır.
-- ═══════════════════════════════════════════════════════════════════════════
commit;
`);

  /**
   * VARSAYILAN SÖZLÜKLER — YALNIZ KURULUM DOSYASINA.
   *
   * Hizalama dosyası (gen-align-sql.mjs) `parcala()`yı çağırır ve buraya HİÇ
   * uğramaz; yani mevcut kiracılara bu satırlar GİTMEZ. Yeni kiracı ise bakım
   * kuralı / kontrol maddesi / belge türü ekranlarını boş açmaz.
   *
   * Bloklar "tablo boşsa" koşullu: dosya ikinci kez koşarsa satırlar ikilenmez
   * ve kiracının kendi sözlüğü ezilmez.
   */
  parts.push(`
` + readFileSync(SEED, "utf8"));

  return { tenant: TENANT, sql: parts.join(""), changes: [...changes] };
}

/** Muhafızın da okuduğu liste — tek kaynak. */
export { ORDER, HARIC };

// ─── CLI ────────────────────────────────────────────────────────────────────
// Yalnız DOĞRUDAN çalıştırıldığında yazar; içe aktarıldığında (muhafız) yazmaz.
const dogrudan =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (dogrudan) {
  const { tenant, sql, changes: uygulanan } = build(process.argv[2] ?? "sendigo");
  const OUT = join(OUT_DIR, `${tenant}-full.sql`);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, sql, "utf8");
  console.log(`✓ ${OUT}`);
  console.log(
    `  ${ORDER.length} migration (001 → ${ORDER[ORDER.length - 1].slice(0, 3)}) · ` +
      `${Object.keys(HARIC).length} bilerek hariç · ` +
      `${sql.split("\n").length} satır · ${sql.length} bayt`
  );
  console.log("\nUYGULANAN DÖNÜŞÜMLER:");
  for (const c of uygulanan) console.log("  • " + c);
  console.log("\nBİLEREK ALINMAYANLAR:");
  for (const [f, sebep] of Object.entries(HARIC)) {
    console.log(`  • ${f}\n      ${sebep.replace(/\s+/g, " ").slice(0, 120)}…`);
  }
}
