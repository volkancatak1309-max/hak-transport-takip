#!/usr/bin/env node
/**
 * db/install/<musteri>-hizalama-078.sql üreticisi — MEVCUT bir kiracıyı
 * 043 seviyesinden 078'e çeker.
 *
 * ── NEDEN AYRI BİR DOSYA, `*-full.sql` DEĞİL ───────────────────────────────
 * `*-full.sql` BOŞ veritabanı içindir ve başındaki boşluk denetimi dolu bir
 * kuruluma çalıştırılmasını KASITLI olarak engeller. Sendigo ve galzura-demo'da
 * CANLI VERİ var; onlara uygulanacak dosya 001-043'ü tekrar kurmaya çalışmamalı,
 * yalnız EKSİĞİ tamamlamalı.
 *
 * ── AYNI DÖNÜŞÜMLER ────────────────────────────────────────────────────────
 * Gövde `gen-install-sql.mjs`in `parcala()`sından geçiyor: iç begin/commit
 * temizliği, yorumdaki gerçek telefonların maskelenmesi, 046'nın HAK61 sır
 * hash'inin çıkarılması. İki üreteç aynı kaynaktan beslensin diye — biri
 * düzeltilip diğeri unutulmasın.
 *
 * ── KİRACI FARKI ───────────────────────────────────────────────────────────
 * Tek fark 054 (demo telemetri temizliği): YALNIZ galzura-demo alır. Gerçek
 * müşteride o fonksiyonun var olmaması bilinçli bir güvenlik katmanıdır.
 *
 * Kullanım:
 *   node scripts/gen-align-sql.mjs sendigo
 *   node scripts/gen-align-sql.mjs galzura-demo
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { parcala, ORDER, BRIDGE_TANK, BRIDGE_ARCHIVED } from "./gen-install-sql.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "db", "install");

/** Hizalamanın başladığı numara: 043'e kadar olanlar zaten kurulu. */
const BASLANGIC = 44;

/** Kiracıya özel ek dosyalar (kurulum dosyasına girmeyenlerden). */
const KIRACI_EK = {
  "galzura-demo": ["054_demo_telemetry_retention.sql"],
};

/**
 * ÖN DENETİMLER — hepsi FAIL-LOUD.
 *
 * Hizalama tek transaction içinde koşuyor; bir kısıt mevcut veriyi reddederse
 * PostgreSQL zaten her şeyi geri alır. Ama o hata "violates foreign key
 * constraint" der ve NEDEN'ini söylemez. Buradaki denetimler aynı durumu
 * ÖNCEDEN, okunur bir cümleyle yakalar.
 */
function onDenetimler(tenant) {
  return `-- ═══════════════════════════════════════════════════════════════════════════
--  ÖN DENETİMLER — sorun varsa BURADA ve OKUNUR biçimde durur
-- ═══════════════════════════════════════════════════════════════════════════

-- Zaman aşımları: büyük tablolarda indeks kurulacak (device_telemetry).
-- lock_timeout kısa: canlı uygulamayı dakikalarca bekletmektense hızlı düş,
-- sakin bir saatte tekrar çalıştır.
set local statement_timeout = '15min';
set local lock_timeout = '20s';

do $on_denetim$
declare
  v_eksik text;
  v_kotu  text;
begin
  -- 1) BU DOSYA MEVCUT KURULUM İÇİNDİR. Boş veritabanında yanlış araç.
  select string_agg(t, ', ' order by t) into v_eksik
    from unnest(array['workers','vehicles','time_entries','device_telemetry']) t
   where not exists (
     select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
   );
  if v_eksik is not null then
    raise exception
      'DURDURULDU: temel tablolar yok (%). Bu dosya MEVCUT bir kurulumu 078''e çeker; SIFIRDAN kurulum için db/install/${tenant}-full.sql kullanın.',
      v_eksik;
  end if;

  -- 2) 043 TABANI: 023 (vehicles.fleet) ve 019 (must_change_pin) burada mı?
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='vehicles' and column_name='fleet'
  ) then
    raise exception
      'DURDURULDU: vehicles.fleet yok — bu kurulum 023''ten eski. Hizalama 043 tabanı varsayar; önce eski migration''ları uygulayın.';
  end if;

  -- 3) 059 ÖN DENETİMİ — CHECK''ten FK''ye geçiş.
  --    fleets tablosunda yalnız 'bordo' ve 'mavi' olacak. Mevcut satırlarda
  --    başka bir kod varsa FK eklenemez ve işlem geri alınır.
  select string_agg(distinct fleet, ', ') into v_kotu
    from public.vehicles
   where fleet is not null and fleet not in ('bordo','mavi');
  if v_kotu is not null then
    raise exception
      'DURDURULDU (059): vehicles.fleet''te tanımsız filo kodu var: %. fleets tablosuna eklenecek kodlar yalnız bordo/mavi; önce bu satırları düzeltin.',
      v_kotu;
  end if;

  select string_agg(distinct managed_fleet, ', ') into v_kotu
    from public.workers
   where managed_fleet is not null and managed_fleet not in ('bordo','mavi');
  if v_kotu is not null then
    raise exception
      'DURDURULDU (059): workers.managed_fleet''te tanımsız filo kodu var: %.', v_kotu;
  end if;

  -- 4) 064 ÖN DENETİMİ — geofences.purpose kısıtı yeniden kurulacak.
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='geofences' and column_name='purpose'
  ) then
    select string_agg(distinct purpose, ', ') into v_kotu
      from public.geofences
     where purpose is not null and purpose not in ('rule','depot','customer');
    if v_kotu is not null then
      raise exception
        'DURDURULDU (064): geofences.purpose''ta izinli olmayan değer var: %. İzinli küme: rule/depot/customer.',
        v_kotu;
    end if;
  end if;

  raise notice 'Ön denetimler geçti — hizalama başlıyor.';
end
$on_denetim$;
${tenant === "galzura-demo" ? UYARI_KILL_SWITCH : ""}

-- ── KÖPRÜ KOLONLARI (migration DEĞİL) ──────────────────────────────────────
-- İkisi de \`if not exists\`: zaten varsa hiçbir şey olmaz.
-- KÖPRÜ 2, 063''ten ÖNCE gelmek ZORUNDA — 063 o kolona kısmi indeks kuruyor
-- ama kolonu 069 ekliyor (boş PostgreSQL 16''da ölçüldü: 063 patlıyor).
${BRIDGE_TANK}
${BRIDGE_ARCHIVED}
`;
}

/**
 * 046'nın ELLE uygulandığı kiracıya özel UYARI — yalnız NOTICE, hiçbir şeyi
 * değiştirmez ve hiçbir şeyi durdurmaz.
 *
 * Özgün migration, kurulduğu veritabanına HAK61'in gizli soru hash'ini yazıyor.
 * Bu dosya o satırı yazmaz ama VAR OLANI da silmez — silmek, kiracının kendi
 * belirlediği bir cevabı sessizce yok etmek olurdu. Doğru davranış: durumu
 * söylemek ve kararı insana bırakmak.
 */
const UYARI_KILL_SWITCH = `
-- ── UYARI: ÖLÜ ADAM ANAHTARININ SIRRI (046 elle uygulanmış) ────────────────
do $ks$
declare
  n integer;
begin
  select count(*) into n from public.kill_switch_secret;
  if n > 0 then
    raise notice '⚠️ kill_switch_secret''te % satır var. 046 elle uygulandıysa bu HAK61''in gizli soru hash''i olabilir — o cevabı bilen biri BU kurulumda da anahtarı açabilir. Kendi hash''inizle değiştirmek için dosyanın sonundaki komuta bakın.', n;
  else
    raise notice 'kill_switch_secret boş — ölü adam anahtarı fail-closed (açılamaz).';
  end if;
end
$ks$;
`;

function basSayfa(tenant, dosyalar, olcum) {
  return `-- ═══════════════════════════════════════════════════════════════════════════
--  ${tenant.toUpperCase()} — ŞEMA HİZALAMA 043 → 078
--  hak-transport-takip · üreten: scripts/gen-align-sql.mjs
-- ═══════════════════════════════════════════════════════════════════════════
--
--  NE İŞE YARAR
--  MEVCUT ve CANLI VERİSİ OLAN bir kurulumu bugünkü şemaya çeker. Eksik
--  tabloları, kolonları, indeksleri ve RPC''leri ekler.
--
--  ⚠️ BOŞ VERİTABANINDA KULLANMAYIN — onun dosyası ${tenant}-full.sql.
--
${olcum}--
--  NASIL ÇALIŞIR — HEPSİ YA DA HİÇBİRİ
--  Dosyanın tamamı TEK transaction içindedir. Bir ifade hata verirse HİÇBİR
--  ŞEY uygulanmaz; yarım şema oluşmaz. Baştaki ön denetimler, sorunu kısıt
--  hatasından önce okunur bir cümleyle söyler.
--
--  TEKRAR ÇALIŞTIRILABİLİR (idempotent). İkinci koşum hiçbir şey değiştirmez;
--  boş bir PostgreSQL 16 üzerinde iki kez üst üste ölçüldü.
--
--  VERİ KAYBI RİSKİ
--  · Hiçbir tablo ya da kolon DÜŞÜRÜLMEZ. Hiçbir satır SİLİNMEZ.
--  · Tek DROP: \`vehicle_odometer_spans\` FONKSİYONU (051) — veri değil, kod;
--    yerine 052''nin \`shift_odometer_spans\`ı geliyor ve uygulama onu çağırıyor.
--  · Yazma yapan üç yer var, üçü de YENİ kolonları dolduruyor:
--      063/069 → geofences.category (yalnız varsayılanda kalmış satırlar)
--      072     → workers.fleet (araç atamasından ve son vardiyadan türetilir)
--    Mevcut hiçbir kolonun değeri EZİLMEZ.
--  · Telefon numaralarına DOKUNULMAZ: 075 bilerek dahil edilmedi (saf veri
--    onarımı; ayrı ve bilinçli bir karar olmalı — dosyanın sonundaki nota bakın).
--
--  ÇALIŞTIRMA
--  Supabase → SQL Editor → hepsini yapıştır → Run. Sakin bir saatte çalıştırın:
--  \`lock_timeout\` 20 sn''dir, canlı yazma trafiği kilidi tutarsa dosya kendini
--  düşürür ve HİÇBİR ŞEY uygulanmaz — tekrar çalıştırmak güvenlidir.
--
--  SONRASINDA
--    select count(*) from information_schema.tables
--     where table_schema='public' and table_type='BASE TABLE';
--    -- 48 bekleniyor: 47 (bugünkü şema) + telegram_link_codes.
--    --    Telegram temizliğini de çalıştırdıysanız 47 olur (dosya sonundaki not).
--    --    ${tenant === "galzura-demo" ? "Bu kiracıda ölçülen taban 35 → 35 + 13 = 48." : "Bu kiracıda ölçülen taban 26 → 26 + 22 = 48."}
--    select code, name from public.fleets;          -- bordo, mavi
--    select count(*) from public.document_types;    -- 0 (türleri panelden açarsınız)
--
--  ⚠️ Uygulama kodu ZATEN 078''i bekliyor ve eksik tabloları kademeli düşüşle
--  karşılıyor (tablo yoksa özellik sessizce kapalı). Yani bu dosya "önce kod,
--  sonra şema" sırasını bozmaz; hizalamadan sonra özellikler AÇILIR.
-- ═══════════════════════════════════════════════════════════════════════════
--  KAPSAM: ${dosyalar.length} migration (${dosyalar[0].slice(0, 3)} → ${dosyalar[dosyalar.length - 1].slice(0, 3)})
-- ═══════════════════════════════════════════════════════════════════════════

begin;

`;
}

/** Kiracıya özgü, ÖLÇÜLMÜŞ ya da ÖLÇÜLMEMİŞ durum bloğu. */
const OLCUM = {
  sendigo: `--  BU KİRACIDA NE DEĞİŞECEK — ÖLÇÜLDÜ (24.08.2026, canlı Sendigo şeması)
--    · +22 TABLO: action_snoozes · audit_log · conversations · conversation_members
--      · country_approvals · device_approvals · document_types · fleets
--      · fuel_price_reference · kill_switch · kill_switch_attempts
--      · kill_switch_secret · login_sessions · message_receipts · messages
--      · pdf_fingerprints · push_tokens · seferler · tenant_cost_rates
--      · vehicle_fault_reports · worker_documents · zone_visits
--    · +13 KOLON: geofences(archived_at, category, customer_name, customer_ref,
--      min_dwell_s) · vehicles(device_model) · workers(access_hours_start,
--      access_hours_end, allowed_countries, fleet, gate_exempt, is_owner,
--      session_version)
--    · +5 RPC: last_recorded_at_batch · idle_episode_cursors_batch
--      · autoshift_telemetry_batch · latest_telemetry_batch · first_ignition_batch
--    · SİLİNEN SATIR: 0.  DÜŞÜRÜLEN TABLO/KOLON: 0.
--
--  CANLI VERİ (24.08.2026): 9 personel · 5 araç · 26 vardiya · 0 bölge
--  · 207.388 device_telemetry satırı. Bölge tablosu BOŞ olduğu için 063/064/069
--  kısıt ve geri-doldurma adımları bu kiracıda hiçbir satıra dokunmaz.
--  vehicles.fleet''in 5 satırının hepsi 'mavi' → 059''un FK''si sorunsuz kurulur.
--  telegram_chat_id dolu 0 satır → Telegram kalıntısı kimseyi etkilemiyor.
`,
  "galzura-demo": `--  BU KİRACIDA NE DEĞİŞECEK — TABLO LİSTESİ ÖLÇÜLDÜ (24.08.2026, canlı)
--
--  MEVCUT TABAN: 35 tablo. Bu, 043 kurulum dosyasının üstüne 045 · 046 · 047
--  ve 064''ün ELLE uygulanmış olmasıyla birebir örtüşüyor — taban Docker''da
--  yeniden kurulup canlı listeyle karşılaştırıldı: 35/35, sıfır fark.
--  ⚠️ Sendigo''dan FARKLI bir taban: güvenlik katmanı (045/046/047) burada
--  UYGULANMIŞ, \`zone_visits\` (064) VAR; buna karşılık \`action_snoozes\` ve
--  \`fleets\` YOK. Yani "iki kiracı aynı yerde" varsayımı YANLIŞ olurdu.
--
--    · +13 TABLO: action_snoozes (058) · conversations + messages +
--      message_receipts (071) · conversation_members (073) · document_types +
--      worker_documents (078) · fleets (059) · fuel_price_reference (077) ·
--      push_tokens (074) · seferler (066) · tenant_cost_rates (076) ·
--      vehicle_fault_reports (056)
--    · SİLİNEN SATIR: 0.  DÜŞÜRÜLEN TABLO/KOLON: 0.
--
--  🔴 KOLON ve RPC ÖLÇÜLMEDİ — elde yalnız TABLO listesi var. Bu yüzden
--  "kaç kolon eklenecek" sayısı VERİLMEDİ; tahmin edilmedi. Dosya bu belirsizliği
--  taşıyabilir: her adım \`if not exists\` ile yazılmıştır, zaten var olana
--  dokunmaz. Kesin tablo için hizalamadan SONRA db/install/ENVANTER.sql
--  çalıştırın — "hizalama gerekli mi" satırı HAYIR demeli.
--
--  ⚠️ 046 BU KİRACIDA ZATEN UYGULANMIŞ. Özgün 046, kurulduğu veritabanına
--  HAK61''in gizli soru hash''ini de yazar. Bu dosya o satırı YAZMAZ ve mevcut
--  satıra DOKUNMAZ — ama halihazırda oradaysa, HAK61''in cevabını bilen biri
--  bu kurulumda da ölü adam anahtarını açabilir. Aşağıdaki ön denetim satır
--  sayısını NOTICE olarak basar; çıktıda görürseniz kendi hash''inizle
--  değiştirin (komut dosyanın sonunda).
--
--  ⚠️ DEMO''DA TELEMETRİ HACMİ YÜKSEK (günde ~50 bin satır). İndeks kuran
--  adımlar (049 · 053) Sendigo''dakinden uzun sürebilir; statement_timeout
--  15 dakikaya çekildi. Yine de sakin bir saatte çalıştırın.
`,
};

export function hizalama(tenant) {
  const TENANT = String(tenant ?? "sendigo").trim().toLowerCase();
  if (!OLCUM[TENANT]) {
    throw new Error(`Bilinmeyen kiracı: "${TENANT}" (sendigo | galzura-demo)`);
  }
  const dosyalar = [
    ...ORDER.filter((f) => Number(f.slice(0, 3)) >= BASLANGIC),
    ...(KIRACI_EK[TENANT] ?? []),
  ].sort((a, b) => Number(a.slice(0, 3)) - Number(b.slice(0, 3)));

  const { parts, changes } = parcala(dosyalar, { koprular: false });

  const sql =
    basSayfa(TENANT, dosyalar, OLCUM[TENANT]) +
    onDenetimler(TENANT) +
    parts.join("") +
    `

-- ═══════════════════════════════════════════════════════════════════════════
--  BİTTİ — şema 078 hizasında.
-- ═══════════════════════════════════════════════════════════════════════════
-- PostgREST şema önbelleğini tazele: yeni tablolar API''de hemen görünsün.
notify pgrst, 'reload schema';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  DOĞRULAMA (commit''ten SONRA, ayrı çalıştırın)
-- ═══════════════════════════════════════════════════════════════════════════
-- select count(*) from information_schema.tables
--  where table_schema='public' and table_type='BASE TABLE';
-- select code from public.fleets order by sort_order;      -- bordo, mavi
-- select count(*) from public.messages;                    -- 0
-- select count(*) from public.worker_documents;            -- 0
-- select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and proname like '%_batch' order by 1;   -- 5 satır
--
-- ═══════════════════════════════════════════════════════════════════════════
--  BU DOSYANIN YAPMADIĞI İKİ ŞEY — bilinçli, ayrı karar gerektirir
-- ═══════════════════════════════════════════════════════════════════════════
--
--  1) TELEGRAM KALINTISI DÜŞÜRÜLMEDİ.
--     Katman 20.08.2026''da söküldü; kodda tek satır yok. Bu kurulumda
--     \`telegram_link_codes\` tablosu ve \`workers.telegram_*\` dört kolonu
--     hâlâ duruyor (canlı HAK61''de düşürüldü). Uygulama onları hiç okumuyor,
--     yani zararsızlar — ama biri (telegram_username) kişisel veridir.
--     Silmek İSTERSENİZ, ayrı ve bilinçli bir adım olarak:
--
--       begin;
--       drop table if exists public.telegram_link_codes;
--       alter table public.workers
--         drop column if exists telegram_chat_id,
--         drop column if exists telegram_username,
--         drop column if exists telegram_linked_at,
--         drop column if exists telegram_locale;
--       commit;
--
--     ⚠️ GERİ ALINAMAZ. Önce \`select count(*) from public.workers
--        where telegram_chat_id is not null;\` ile ne kaybedeceğinizi görün.
--
--  2) TELEFON NUMARASI NORMALİZASYONU (075) YAPILMADI.
--     075, "+430660…" biçimindeki numaralardan ulusal trunk sıfırını atar
--     ("+43660…"). Bu bir ŞEMA değişikliği değil, VERİ değişikliğidir ve
--     \`workers.phone\` UNIQUE olduğu için çakışma üretebilir. Kod her iki
--     biçimi de tanıyor (lib/phone.ts phoneVariants), yani giriş bozulmuyor.
--     Uygulamak isterseniz db/migrations/075_phone_trunk_zero.sql''i AYRI
--     çalıştırın: içindeki DO bloğu çakışma varsa kendini durdurur.
${
  tenant === "galzura-demo"
    ? `--
--  3) ÖLÜ ADAM ANAHTARININ CEVABI DEĞİŞTİRİLMEDİ.
--     046 bu kurulumda elle uygulandığı için \`kill_switch_secret\`te HAK61''in
--     hash''i duruyor OLABİLİR (koşum başındaki NOTICE satır sayısını söyler).
--     Bu dosya o satıra DOKUNMAZ: silmek, kiracının kendi belirlediği bir cevabı
--     sessizce yok etmek olurdu. Kendi cevabınızı koymak için:
--
--       -- 1) Hash üret (düz metin hiçbir yere yazılmaz):
--       --    node -e "console.log(require('bcryptjs').hashSync('CEVABINIZ', 10))"
--       -- 2) Tek satırı değiştir:
--       begin;
--       update public.kill_switch_secret set answer_hash = '<yeni-hash>', updated_at = now();
--       commit;
--
--     Satır hiç yoksa anahtar zaten AÇILAMAZ (fail-closed) — acele etmeyin.
`
    : ""
}`;

  return { tenant: TENANT, sql, dosyalar, changes };
}

const dogrudan =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (dogrudan) {
  const hedef = process.argv[2] ?? "sendigo";
  const { tenant, sql, dosyalar, changes } = hizalama(hedef);
  const OUT = join(OUT_DIR, `${tenant}-hizalama-078.sql`);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, sql, "utf8");
  console.log(`✓ ${OUT}`);
  console.log(
    `  ${dosyalar.length} migration (${dosyalar[0].slice(0, 3)} → ${dosyalar[dosyalar.length - 1].slice(0, 3)}) · ` +
      `${sql.split("\n").length} satır · ${sql.length} bayt`
  );
  console.log("\nUYGULANAN DÖNÜŞÜMLER:");
  for (const c of changes) console.log("  • " + c);
}
