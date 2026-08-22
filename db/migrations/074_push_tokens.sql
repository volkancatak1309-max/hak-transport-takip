-- 074_push_tokens.sql — PUSH BİLDİRİM ADRESLERİ (cihaz başına Expo jetonu)
--
-- ⚠️ BU DDL HENÜZ ÇALIŞTIRILMADI. Volkan Supabase'de çalıştıracak.
--    Claude tarafından çalıştırılmadı; bu dosya deponun ŞEMA KAYDIDIR.
--
-- ── NE ÇÖZÜYOR ─────────────────────────────────────────────────────────────
-- 071/073 mesajlaşmayı kurdu ama kanal GÜVENİLMEZ: şoför uygulamayı açmazsa
-- mesajı görmüyor. Çekme (polling) yalnız uygulama önplandayken çalışıyor
-- (use-messages: 12/30 sn) — telefon cebindeyken hiçbir şey akmıyor.
-- Bu tablo "o kişiye ULAŞILABİLECEK adresleri" tutar; gönderimi sunucu yapar.
--
-- ── NEDEN `token` BİRİNCİL ANAHTAR ─────────────────────────────────────────
-- Jeton bir KURULUMU temsil eder, bir kişiyi değil. Aynı telefonda iki şoför
-- sırayla giriyor (ortak araç telefonu — bu filoda gerçek). `token` PK olunca
-- ikinci giriş aynı satırı DEVRALIR: `worker_id` güncellenir ve önceki kişi o
-- adresten düşer. (worker_id, token) çifti PK olsaydı iki satır yan yana
-- dururdu ve çıkan kişinin mesajları yeni kullanıcının telefonuna DÜŞERDİ —
-- rahatsızlık değil, mahremiyet kusuru.
--
-- ── NEDEN CİHAZ BAŞINA DEĞİL, JETON BAŞINA ─────────────────────────────────
-- Expo jetonu sabit değil: uygulama verisi silinince, cihaz geri yüklenince
-- ya da FCM kaydı yenilenince değişir. "Cihaz kimliği" diye güvenilir bir şey
-- yok; olan tek kararlı olgu jetonun kendisi. Bir kişinin birden çok satırı
-- olması NORMAL (telefon + tablet) ve isteniyor.
--
-- ── ÖLÜ JETONLAR NASIL TEMİZLENİYOR ────────────────────────────────────────
-- İki yol, ikisi de yazılı:
--   1. ÇIKIŞTA — uygulama `DELETE /api/mobile/push/token` çağırıyor.
--   2. GÖNDERİMDE — Expo `DeviceNotRegistered` döndüğünde satır silinir
--      (lib/push.ts, `olenleriSil`). Kullanıcı uygulamayı sildiğinde tek
--      haber kaynağı budur; başka sinyal yok.
-- `last_seen_at` üçüncü bir ağ değil, teşhis: "bu jeton en son ne zaman
-- tazelendi" sorusu, bildirim gelmiyor şikâyetinde ilk bakılacak yerdir.
--
-- ── NEDEN `tenant_id` YOK ───────────────────────────────────────────────────
-- Bu kurulumda kiracı ayrımı VERİTABANI başına (HAK61 ve Sendigo ayrı Supabase
-- projeleri) — `workers` tablosunda da tenant kolonu yok. Buraya eklemek, bu
-- şemada karşılığı olmayan bir alan uydurmak olurdu.
--
-- ── RLS ────────────────────────────────────────────────────────────────────
-- Kapalı — deponun kuralı (anon key yok, RLS politikası 0, yetki uygulama
-- kodunda: lib/mobile-scope.ts). Politika yazılmadan açılan RLS hiçbir şey
-- korumaz, yalnız yanlış güven duygusu verir.
--
-- ── GERİYE DÖNÜK ETKİ: SIFIR ───────────────────────────────────────────────
-- Tamamı eklemeli; var olan hiçbir tabloya dokunulmuyor.

begin;

create table if not exists public.push_tokens (
  -- Expo jetonu: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]".
  -- Uzunluk sınırı KOYULMADI: biçim Expo'nun ve değişebilir; dar bir CHECK
  -- ileride sessizce kayıt düşürürdü.
  token text primary key,

  -- Bu adresin ŞU ANKİ sahibi. Devralma yoluyla değişebilir (yukarıya bak).
  -- on delete cascade: personel silinince adresi de gider (GDPR md. 17).
  worker_id uuid not null
    references public.workers(id) on delete cascade,

  platform text not null check (platform in ('ios', 'android')),

  -- Teşhis için: "hangi telefon". Kullanıcının verdiği cihaz adı, kimlik değil.
  device_name text,

  created_at   timestamptz not null default now(),
  -- Her açılışta tazelenir. Ölü jeton avında ilk bakılacak kolon.
  last_seen_at timestamptz not null default now()
);

-- Gönderim yolunun TEK sorgusu: "bu kişilerin adresleri".
-- Alıcı kümesi her mesajda çözülüyor; indekssiz her bildirim tam tarama olurdu.
create index if not exists push_tokens_worker_idx
  on public.push_tokens (worker_id);

commit;

-- ── ÇALIŞTIRDIKTAN SONRA — DOĞRULAMA SORGULARI ─────────────────────────────
--
-- 1) Tablo ve indeks yerinde mi (beklenen: 1 satir + 2 indeks):
--
--    select count(*) from information_schema.tables
--      where table_schema='public' and table_name='push_tokens';
--    select indexname from pg_indexes
--      where schemaname='public' and tablename='push_tokens';
--
-- 2) Platform kisiti calisiyor mu — HATA VERMELI:
--
--    insert into public.push_tokens (token, worker_id, platform)
--      values ('T1', (select id from public.workers limit 1), 'web');  -- RED
--
-- 3) DEVRALMA calisiyor mu (ortak telefon senaryosu):
--
--    begin;
--      insert into public.push_tokens (token, worker_id, platform)
--        values ('ExponentPushToken[TEST]', (select id from public.workers order by id limit 1), 'android');
--      insert into public.push_tokens (token, worker_id, platform)
--        values ('ExponentPushToken[TEST]', (select id from public.workers order by id offset 1 limit 1), 'android')
--        on conflict (token) do update
--          set worker_id = excluded.worker_id, last_seen_at = now();
--      -- BEKLENEN: tek satir, worker_id IKINCI kisi.
--      select token, worker_id from public.push_tokens where token='ExponentPushToken[TEST]';
--    rollback;   -- ⚠️ ROLLBACK: test verisi birakmaz
