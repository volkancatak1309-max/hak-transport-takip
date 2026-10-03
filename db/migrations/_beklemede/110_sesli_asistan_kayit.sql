-- HAK61 / Galzura Fleet — Migration 110 (SESLİ ASİSTAN: KULLANIM KAYDI + BİLDİR + SAKLAMA)
-- ⏸ ÇALIŞTIRILMADI — TASLAK (03.10.2026). `_beklemede/` altında: kurulum sırasında
--    (`scripts/gen-install-sql.mjs` ORDER) YOK, hiçbir kiracıda koşmadı.
--    Sıra (Volkan onayından SONRA): galzura-demo → Sendigo → HAK61. Adımlar:
--    `docs/runbook/sesli-asistan-faz2a.md`.
-- =====================================================================
-- Numara: 109 son uygulanan; 110 sesli asistana ayrılmıştı (tasarım belgesi §1.7);
-- 111 `mesaj-bildir-engelle` dalında. Bu dosya 110'u kullanır.
--
-- Additive + idempotent: yalnız YENİ iki tablo ve bir fonksiyon. Mevcut hiçbir tabloya,
-- kolona, satıra dokunulmaz. Supabase SQL Editor'da çalıştırın.
--
-- ═══ NE İÇİN ═══
-- Sesli asistan prototipinde (panel `/admin/asistan`) sınırlar yalnız tarayıcıdaydı.
-- Bu tablolarla sunucu:
--   • oturum açmadan önce kişi/gün 20 dk, kişi/ay 60 dk ve kiracı/ay bütçesini (demo 25 $)
--     denetler; dolmuşsa oturum AÇILMAZ;
--   • oturumun saniyesini kalp atışlarıyla KENDİSİ sayar (tarayıcının söylediği süreye
--     güvenmez) ve 10 dk dolunca araçları kapatır;
--   • "Bildir" denen soru-cevabı saklar (karar 5).
-- Kod bayrak arkasında (`ASISTAN_SESLI_KAYIT=1`); bu migration çalışmadan bayrak açılmaz.
--
-- ═══ SAKLAMA (Volkan kararları 5 ve 9) ═══
--   asistan_kullanim       → 2 AY
--   asistan_bildirimleri   → 90 GÜN
-- Süreler aşağıdaki fonksiyonun GÖVDESİNDE sabit: çağıran (cron) süre seçemez, yanlış bir
-- parametre bugünün kaydını silemez. Silme `/api/cron/asistan-kayit-temizle` ile günde bir
-- (demo-retention deseni: parça parça, tavanlı).
--
-- ═══ KİŞİSEL VERİ ═══
-- Kullanım kaydında İÇERİK YOK: yalnız kim, ne zaman, ne kadar, hangi motor, tahmini maliyet.
-- Bildirimde içerik VAR (soru + cevap + araç adları/süreleri) — yalnız kullanıcının "Bildir"
-- dediği tek soru-cevap, 90 gün. Ses kaydı hiçbir tabloda tutulmaz.
-- RLS AÇIK + policy YOK (varsayılan ret; yalnız servis rolü yazar/okur) — 17 Tem kuralı.

begin;

-- ── 1) KULLANIM KAYDI ────────────────────────────────────────────────────
create table if not exists public.asistan_kullanim (
  id uuid primary key default gen_random_uuid(),
  -- Her kiracının ayrı veritabanı var; kolon yine de yazılır (kayıt kendi başına okunsun).
  kiraci text not null check (length(btrim(kiraci)) between 1 and 40),
  worker_id uuid references public.workers(id) on delete set null,
  motor text not null check (motor in ('realtime', 'live', 'yazi')),
  model text not null check (length(btrim(model)) between 1 and 60),
  ses text check (ses is null or length(btrim(ses)) between 1 and 30),
  basladi_at timestamptz not null default now(),
  son_nabiz_at timestamptz,
  bitti_at timestamptz,
  -- SUNUCUNUN saydığı saniye (kalp atışında now() − basladi_at, oturum sınırıyla kırpılı).
  saniye integer not null default 0 check (saniye between 0 and 86400),
  bitis_sebebi text check (
    bitis_sebebi is null or bitis_sebebi in (
      'kullanici', 'sure_doldu', 'gun_siniri', 'ay_siniri', 'butce',
      'arka_plan', 'baglanti_koptu', 'hata', 'kopuk'
    )
  ),
  -- TAHMİNİ: sunucu tabanı (dakika × birim) ile istemcinin bildirdiğinin büyüğü.
  tahmini_maliyet_usd numeric(10, 4) not null default 0 check (tahmini_maliyet_usd >= 0),
  -- GPT-Live arka modeli / yazılı yol (`gpt-6-luna`) tokenları.
  arka_girdi_token integer not null default 0 check (arka_girdi_token >= 0),
  arka_cikti_token integer not null default 0 check (arka_cikti_token >= 0),
  created_at timestamptz not null default now(),
  check (bitti_at is null or bitti_at >= basladi_at)
);

-- Kişi/gün ve kişi/ay toplamı.
create index if not exists asistan_kullanim_worker_basladi_idx
  on public.asistan_kullanim (worker_id, basladi_at desc);
-- Kiracı/ay bütçesi + saklama temizliği.
create index if not exists asistan_kullanim_basladi_idx
  on public.asistan_kullanim (basladi_at);

alter table public.asistan_kullanim enable row level security;

comment on table public.asistan_kullanim is
  'Sesli asistan oturum kaydı (migration 110). İçerik YOK. 2 ay saklanır (asistan_kayit_temizle).';
comment on column public.asistan_kullanim.saniye is
  'Sunucunun kalp atışlarıyla saydığı süre — tarayıcının bildirdiği değil.';

-- ── 2) BİLDİR ────────────────────────────────────────────────────────────
create table if not exists public.asistan_bildirimleri (
  id uuid primary key default gen_random_uuid(),
  kiraci text not null check (length(btrim(kiraci)) between 1 and 40),
  worker_id uuid references public.workers(id) on delete set null,
  kullanim_id uuid references public.asistan_kullanim(id) on delete set null,
  motor text not null check (motor in ('realtime', 'live', 'yazi')),
  model text check (model is null or length(btrim(model)) between 1 and 60),
  dil text check (dil is null or dil in ('tr', 'de', 'en')),
  soru text not null check (length(btrim(soru)) between 1 and 2000),
  cevap text check (cevap is null or length(cevap) <= 4000),
  -- [{ad, sureMs, onbellek}] — araç adları ve süreleri; araç SONUCU tutulmaz.
  arac_cagrilari jsonb not null default '[]'::jsonb
    check (jsonb_typeof(arac_cagrilari) = 'array' and jsonb_array_length(arac_cagrilari) <= 20),
  created_at timestamptz not null default now()
);

create index if not exists asistan_bildirimleri_created_idx
  on public.asistan_bildirimleri (created_at);

alter table public.asistan_bildirimleri enable row level security;

comment on table public.asistan_bildirimleri is
  'Sesli asistanda kullanıcının "Bildir" dediği soru-cevap (migration 110, karar 5). 90 gün saklanır.';

-- ── 3) SAKLAMA TEMİZLİĞİ ─────────────────────────────────────────────────
-- Süreler GÖVDEDE sabit (2 ay / 90 gün). Parça parça siler; çağıran tur atar.
create or replace function public.asistan_kayit_temizle(p_limit int default 5000)
returns jsonb
language plpgsql
volatile
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 5000), 1), 20000);
  v_bildirim bigint;
  v_kullanim bigint;
begin
  -- Önce bildirim (kullanıma bağlı olabilir; bağ `on delete set null`, sıra yine de net).
  with kurbanlar as (
    select ctid
    from public.asistan_bildirimleri
    where created_at < now() - interval '90 days'
    order by created_at
    limit v_limit
  )
  delete from public.asistan_bildirimleri b
  using kurbanlar k
  where b.ctid = k.ctid;
  get diagnostics v_bildirim = row_count;

  with kurbanlar as (
    select ctid
    from public.asistan_kullanim
    where basladi_at < now() - interval '2 months'
    order by basladi_at
    limit v_limit
  )
  delete from public.asistan_kullanim u
  using kurbanlar k
  where u.ctid = k.ctid;
  get diagnostics v_kullanim = row_count;

  return jsonb_build_object('bildirim', v_bildirim, 'kullanim', v_kullanim);
end;
$$;

-- Yalnız servis rolü çağırır (cron rotası). Anon/authenticated PostgREST'ten çağıramaz.
revoke all on function public.asistan_kayit_temizle(int) from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- ═══ DOĞRULAMA (çalıştırdıktan sonra) ═══
--   select count(*) from information_schema.tables
--    where table_schema = 'public' and table_name in ('asistan_kullanim', 'asistan_bildirimleri');  -- 2
--   select public.asistan_kayit_temizle(1);   -- {"bildirim": 0, "kullanim": 0}
--
-- ═══ GERİ ALMA (gerekirse; veri SİLİNİR) ═══
--   drop function if exists public.asistan_kayit_temizle(int);
--   drop table if exists public.asistan_bildirimleri;
--   drop table if exists public.asistan_kullanim;
