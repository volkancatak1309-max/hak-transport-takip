-- ═══════════════════════════════════════════════════════════════════════════
--  GALZURA DEMO — EKSİK TABLO İZİNLERİ (GRANT)
--  Belirti: GET /api/flespi/sync → "permission denied for table vehicles"
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ── NE VERİLİYOR ──────────────────────────────────────────────────────────
--
--    ROL          : service_role   (TEK rol — aşağıdaki gerekçeye bakın)
--    ŞEMA         : public         → USAGE
--    TABLOLAR     : public şemasındaki 26 tablonun TAMAMI
--                   → SELECT, INSERT, UPDATE, DELETE
--    GELECEK TABLO: aynı dört hak, default privileges ile
--
--  ── NE VERİLMİYOR (bilinçli) ──────────────────────────────────────────────
--
--    ✗ anon / authenticated — TEK BİR HAK BİLE VERİLMİYOR.
--      Bu şemada RLS 26 tablonun 25'inde KAPALI (tek istisna idle_episodes,
--      onun da policy'si yok). Yani anon'a SELECT vermek, bir gün bir anon
--      anahtarı üretilirse tüm filo, personel ve konum verisini herkese
--      açardı. Uygulama zaten anon anahtarı KULLANMIYOR: depoda ANON_KEY
--      geçen tek satır yok, tek istemci lib/supabase.ts'teki service_role.
--
--    ✗ TRUNCATE / REFERENCES / TRIGGER — uygulama bunları hiç kullanmıyor.
--
--    ✗ SEQUENCE hakları — bu şemada sequence YOK. 26 tablonun birincil
--      anahtarı 24 uuid + 2 text; serial/bigserial/nextval hiç geçmiyor.
--      Gereksiz bir hak vermemek için sequence satırı bilerek yazılmadı.
--
--    ✗ Fonksiyon hakları — gerekmiyor. Dört rapor RPC'sinin service_role
--      izni ŞEMANIN KENDİSİNDE zaten açıkça veriliyor
--      (026_report_rpcs.sql:202-204 ve 027_fuel_stats_edge_fix.sql:148),
--      o yüzden kurulumla birlikte geldi. Aşağıdaki denetim bunu doğrular.
--
--  ── NEDEN GEREKTİ ─────────────────────────────────────────────────────────
--
--  Supabase projesi "Automatically expose new tables" KAPALI kurulduğu için
--  `alter default privileges ... grant ... on tables to anon, authenticated,
--  service_role` uygulanmadı; galzura-full.sql ile yaratılan tablolar hiçbir
--  role hak taşımadan doğdu.
--
--  ⚠️ RLS DEĞİL, GRANT. Karıştırılması kolay ama ayrım kesin:
--    • service_role RLS'i baypas eder (BYPASSRLS), ama BYPASSRLS tablo
--      HAKLARINI baypas ETMEZ. Hakları atlayan tek şey superuser'dır ve
--      service_role superuser değildir.
--    • RLS reddi zaten "permission denied for table" DEMEZ — okumada boş
--      sonuç, yazmada "new row violates row-level security policy" döner.
--      Gelen hata 42501, yani saf bir yetki hatası.
--    • Üstelik vehicles'ta RLS hiç açılmadı (şemada `enable row level
--      security` geçen TEK satır idle_episodes içindir).
--
--  HAK61 ve Sendigo'da aynı şema sorunsuz çalışıyor çünkü o projeler ayar
--  AÇIKKEN kuruldu ve Supabase hakları kendiliğinden verdi. Fark şemada
--  değil, proje ayarındadır.
--
--  ── ÇALIŞTIRMA ────────────────────────────────────────────────────────────
--  Supabase → SQL Editor → yapıştır → Run. Tek transaction, tekrar
--  çalıştırmak güvenli (grant idempotenttir).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1) ŞEMA ERİŞİMİ ────────────────────────────────────────────────────────
-- Tablo hakkı tek başına yetmez: şemanın kendisine USAGE olmadan içindeki
-- hiçbir nesneye ulaşılamaz.
grant usage on schema public to service_role;

-- ── 2) MEVCUT 26 TABLO ─────────────────────────────────────────────────────
-- Uygulamanın fiilen kullandığı dört fiil. DELETE dahil, çünkü kod siliyor:
-- login_attempts temizliği (lib/auth-core.ts:143, lib/login-lock.ts:151),
-- depo muafiyeti kaldırma (app/actions/depot.ts:60), panel kayıt silme
-- (app/actions/driver-panel.ts:199) ve altı çağrı yeri daha.
grant select, insert, update, delete
  on all tables in schema public
  to service_role;

-- ── 3) BUNDAN SONRA YARATILACAK TABLOLAR ───────────────────────────────────
-- Bu satır olmadan sorun BİR SONRAKİ MİGRATION'DA aynen tekrar ederdi:
-- 044_mobile_token_version.sql henüz çalıştırılmadı ve yeni tablo/kolon
-- getiren her migration aynı duvara toslardı.
--
-- ⚠️ Default privileges, kuralı YAZAN role bağlıdır. Bu dosyayı Supabase SQL
-- Editor'da çalıştırdığınızda sahip `postgres` olur; sonraki migration'ları da
-- aynı yerden (aynı rolle) çalıştırdığınız sürece kural geçerlidir.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- ── 4) DENETİM ─────────────────────────────────────────────────────────────
-- Beklenen sayı tutmazsa transaction geri alınır — yarım izin kalmaz.
do $denetim$
declare
  v_tablo    int;
  v_yetkili  int;
  v_rpc      int;
  v_anon     int;
begin
  select count(*) into v_tablo
    from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE';

  select count(distinct table_name) into v_yetkili
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee = 'service_role'
     and privilege_type = 'SELECT';

  select count(*) into v_rpc
    from information_schema.role_routine_grants
   where routine_schema = 'public'
     and grantee = 'service_role'
     and privilege_type = 'EXECUTE';

  -- anon'a yanlışlıkla hak sızmış mı? Sızdıysa bu dosya değil, başka bir
  -- çalıştırma yapmıştır — yine de görelim.
  select count(distinct table_name) into v_anon
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon';

  if v_yetkili < v_tablo then
    raise exception
      'EKSIK: % tablodan yalniz %sinde service_role SELECT hakki var.',
      v_tablo, v_yetkili;
  end if;

  raise notice 'OK - % tablo, %sinde service_role haklari tam.', v_tablo, v_yetkili;
  raise notice 'RPC EXECUTE hakki olan fonksiyon sayisi: % (semadan gelmisti, beklenen >= 3).', v_rpc;
  raise notice 'anon rolune acik tablo sayisi: % (beklenen 0).', v_anon;
end
$denetim$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  ÇALIŞTIRDIKTAN SONRA — uygulamada doğrulama
--    GET https://demo.galzura.com/api/flespi/sync?secret=<FLESPI_SYNC_SECRET>
--    → {"ok":true,"vehicles":29,...} dönmeli.
--
--  Bir tur sonra kimlik maskelemesini de ölçün (VIN sızmamalı):
--    select count(*) from public.vehicles where vin is not null;   -- 0
-- ═══════════════════════════════════════════════════════════════════════════
