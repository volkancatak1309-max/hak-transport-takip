-- HAK61 / Galzura Fleet — Migration 111 (MESAJ BİLDİR + ENGELLE)
-- ⚠️ BU DDL HENÜZ ÇALIŞTIRILMADI — hiçbir kiracıda koşmadı (dal: mesaj-bildir-engelle).
--    Ne zaman, hangi sırayla, hangi kiracıda: docs/MESAJ-BILDIR-ENGELLE.md (mobil depo)
--    "BUILD 4 GÜNÜ" bölümü. Durum notu bu başlığa DEĞİL belgeye yazılır: bu
--    dosyaya eklenen her yorum dört üretilmiş kurulum dosyasını bayatlatır.
-- =====================================================================
-- App Store Guideline 1.2 (kullanıcı içeriği) ve Google Play UGC kuralı
-- dört şey istiyor: BİLDİR, ENGELLE, SÜZGEÇ ve yayımlanmış iletişim. Üçünün
-- veri tarafı burada; süzgeç bir kelime listesi (lib/mesaj-suzgec.ts), şema
-- istemiyor. Yönetici SİLMESİ için de şema gerekmiyor: 071'in
-- `messages.deleted_at` / `deleted_by` kolonları bunun için konmuştu ve bugüne
-- dek hiçbir yol onları yazmıyordu.
--
-- Additive + idempotent: yalnız İKİ YENİ TABLO. Var olan hiçbir tabloya,
-- kolona, satıra dokunulmaz; mevcut kod bu tabloları okumaz. Yani migration
-- kodun önünde de koşsa arkasında da koşsa hiçbir ekran değişmez.
--
-- ── NEDEN `tenant_id` / kiracı KOLONU YOK ──────────────────────────────────
-- Kiracı ayrımı bu kurulumda VERİTABANI başına (HAK61, Sendigo ve galzura-demo
-- ayrı Supabase projeleri). `workers`, `messages`, `push_tokens` dahil hiçbir
-- tabloda kiracı kolonu yok — 074'ün başlığındaki gerekçenin aynısı: bu şemada
-- karşılığı olmayan bir alan uydurmak olurdu. Bir bildirimin kiracısı,
-- yazıldığı veritabanının kendisidir.
--
-- ── RLS ────────────────────────────────────────────────────────────────────
-- Kapalı — deponun kuralı (anon key yok, RLS politikası 0, yetki uygulama
-- kodunda: lib/mesaj-moderasyon.ts + lib/mobile-scope.ts). Politika yazılmadan
-- açılan RLS hiçbir şey korumaz, yalnız yanlış güven duygusu verir (071).

begin;

-- ═══ 1) mesaj_bildirimleri — "bu mesajı yönetime bildiriyorum" ═══
--
-- Bir satır = bir kişinin bir mesaj hakkındaki bir bildirimi. Aynı mesajı üç
-- kişi bildirirse üç satır olur; yönetici ekranı onları MESAJ başına toplar.
create table if not exists public.mesaj_bildirimleri (
  id uuid primary key default gen_random_uuid(),

  -- Bildirilen mesaj. Mesaj YUMUŞAK silinir (deleted_at) ve satırı kalır, yani
  -- yönetici mesajı sildiğinde bildirim de kalır. `cascade` yalnız SERT silmede
  -- çalışır: personel silinince konuşması ve mesajları gider (071, GDPR md. 17)
  -- ve o mesajlar hakkındaki bildirimin bağlamı kalmaz.
  message_id uuid not null references public.messages(id) on delete cascade,

  -- Bildiren kişi. `set null`: bildiren personel silinse bile "bu mesaj
  -- bildirilmişti" bilgisi kalır — kim olduğu düşer, ne olduğu kalır
  -- (071'in messages.sender_worker_id gerekçesi).
  bildiren_id uuid references public.workers(id) on delete set null,

  -- Sebep MAKİNE OKUNUR: yönetici ekranı sayar ve süzer. Serbest metin ayrı.
  sebep text not null
    check (sebep in ('harassment', 'inappropriate', 'spam', 'other')),

  -- İsteğe bağlı açıklama. Tavan 500 (080 `teslimatlar.notlar` ile aynı):
  -- sınırsız metin bir DoS yüzeyidir ve istemci doğrulaması atlanabilir.
  notlar text check (notlar is null or length(btrim(notlar)) between 1 and 500),

  durum text not null default 'open' check (durum in ('open', 'resolved')),

  created_at timestamptz not null default now(),

  -- Kim, ne zaman çözdü. Çözmek bir yönetici kararıdır ve izi kalır.
  cozuldu_at timestamptz,
  cozen_id uuid references public.workers(id) on delete set null,

  -- BİÇİM: açık bildirimin çözüm izi olmaz; çözülmüşün zamanı olur.
  -- `cozen_id` çözülmüşte NULL OLABİLİR — çözen yönetici sonradan silinirse
  -- (set null) satır biçim dışı kalmasın.
  constraint mesaj_bildirimleri_bicim check (
    (durum = 'open' and cozuldu_at is null and cozen_id is null)
    or (durum = 'resolved' and cozuldu_at is not null)
  )
);

-- AYNI KİŞİ AYNI MESAJI İKİ KEZ AÇIK BİLDİREMEZ — ama çözüldükten sonra
-- yeniden bildirebilir (mesaj silinmediyse ve hâlâ rahatsız ediyorsa, yönetici
-- bunu görmeli). Bu yüzden tam UNIQUE değil, KISMİ tekil indeks.
-- Uç çift bildirimde 23505'i yakalar ve 200 döner — hata DEĞİL, aynı sonuç.
create unique index if not exists mesaj_bildirimleri_acik_tekil
  on public.mesaj_bildirimleri (message_id, bildiren_id)
  where durum = 'open';

-- Yönetici ekranının tek sorgusu: "açık bildirimler, en yeni üstte".
create index if not exists mesaj_bildirimleri_durum_an
  on public.mesaj_bildirimleri (durum, created_at desc);

-- Mesaj başına toplama ve "bu mesajın açık bildirimlerini çöz".
create index if not exists mesaj_bildirimleri_mesaj
  on public.mesaj_bildirimleri (message_id);

-- ═══ 2) mesaj_engeller — "bu kişinin grup mesajlarını bana gösterme" ═══
--
-- Engel KİŞİ ÇİFTİ ekseninde ve YÖNLÜ: A'nın B'yi engellemesi B'nin A'yı
-- engellemesi demek değildir. Süzgeç SUNUCUDA (lib/messaging.ts
-- konusmaGecmisi + okunmamış sayacı + liste önizlemesi, lib/push.ts
-- mesajBildir): istemcide gizlemek yetmezdi, veri yine telefona inerdi.
--
-- ⚠️ YALNIZ GRUP KONUŞMALARINDA uygulanır. Birebir kanal işveren kanalıdır
-- (şoför ↔ yönetim, 071): şoförün yönetimi engellemesi iş talimatını
-- susturmak olurdu. Orada BİLDİR var, yönetici tarafında da "Hesabı pasife al".
--
-- Satır SERT silinir (engeli kaldırmak = satırı silmek). Engel bir operasyon
-- kaydı değil kişisel bir tercih; geçmişini tutmak, kimin kimi ne zaman
-- engellediğini gereksiz yere saklamak olurdu (GDPR md. 5(1)(c) veri
-- minimizasyonu).
create table if not exists public.mesaj_engeller (
  engelleyen_id uuid not null references public.workers(id) on delete cascade,
  engellenen_id uuid not null references public.workers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (engelleyen_id, engellenen_id),
  -- Kendini engellemek anlamsız; uç da 400 döner, şema son hat.
  constraint mesaj_engeller_kendisi check (engelleyen_id <> engellenen_id)
);

-- Bildirim yolunun sorgusu: "gönderen X'i kimler engelledi" (alıcılardan
-- düşülecekler). PK (engelleyen, engellenen) bu yönde işe yaramaz.
create index if not exists mesaj_engeller_engellenen
  on public.mesaj_engeller (engellenen_id);

-- ═══ RLS: deponun kuralı (başlıktaki nota bakın) ═══
alter table public.mesaj_bildirimleri disable row level security;
alter table public.mesaj_engeller     disable row level security;

comment on table public.mesaj_bildirimleri is
  'Mesaj bildirimi (App Store 1.2 / Play UGC). Aynı kişi aynı mesajı yalnız bir '
  'kez AÇIK bildirebilir (kısmi tekil indeks); çözülünce yeniden bildirebilir.';
comment on table public.mesaj_engeller is
  'Kişi çifti engeli, YÖNLÜ. Yalnız GRUP konuşmalarında süzülür (sunucuda); '
  'birebir işveren kanalında uygulanmaz. Engeli kaldırmak satırı siler.';

commit;

-- ── ÇALIŞTIRDIKTAN SONRA — DOĞRULAMA SORGULARI ─────────────────────────────
--
-- 1) İki tablo ve dört indeks yerinde mi (beklenen: 2 satır + 4 satır):
--
--    select table_name from information_schema.tables
--      where table_schema='public'
--        and table_name in ('mesaj_bildirimleri','mesaj_engeller');
--    select indexname from pg_indexes
--      where schemaname='public'
--        and tablename in ('mesaj_bildirimleri','mesaj_engeller')
--        and indexname not like '%_pkey';
--
-- 2) Kısıtlar çalışıyor mu — ÜÇÜ DE HATA VERMELİ (rollback ile, iz bırakmaz):
--
--    begin;
--      insert into public.mesaj_engeller (engelleyen_id, engellenen_id)
--        select id, id from public.workers limit 1;          -- kendisi -> RED
--    rollback;
--    begin;
--      insert into public.mesaj_bildirimleri (message_id, sebep)
--        select id, 'kotu' from public.messages limit 1;     -- sebep -> RED
--    rollback;
--    begin;
--      insert into public.mesaj_bildirimleri (message_id, sebep, durum)
--        select id, 'spam', 'resolved' from public.messages limit 1;  -- biçim -> RED
--    rollback;
--
-- 3) Satır sayısı (beklenen: 0 ve 0 — yeni tablolar boş doğar):
--
--    select (select count(*) from public.mesaj_bildirimleri) as bildirim,
--           (select count(*) from public.mesaj_engeller)     as engel;
