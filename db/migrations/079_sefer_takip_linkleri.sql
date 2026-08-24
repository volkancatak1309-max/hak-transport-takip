-- HAK61 / Galzura Fleet — Migration 079 (MÜŞTERİ CANLI TAKİP LİNKİ)
-- =====================================================================
-- Yönetici bir sefer için süreli bir link üretir, müşteriye gönderir. Müşteri
-- GİRİŞSİZ bir sayfada aracın konumunu, tahmini varışı ve durumu görür.
-- Additive + idempotent; mevcut hiçbir tabloya DOKUNULMAZ. Supabase SQL
-- Editor'da çalıştırın.
--
-- ═══ NEDEN AYRI TABLO, seferler'E KOLON DEĞİL ═══
--
-- Bir sefer için BİRDEN FAZLA link gerekebilir: alıcı, gönderici ve çağrı
-- merkezi aynı seferi izleyebilir ve biri iptal edilirken diğeri yaşamalıdır.
-- Kolon modelinde "linki iptal et" = "herkesinkini iptal et" olurdu.
-- Ayrıca link bir KAYIT: kim üretti, ne zaman doldu, kaç kez açıldı. Bunlar
-- seferin alanları değil, linkin kendi hayatıdır.
--
-- ═══ NEDEN TOKEN AÇIK METİN (HASH DEĞİL) — BİLİNÇLİ TAKAS ═══
--
-- Oturum parolası gibi bir sır olsaydı hash saklanırdı. Bu bir TAŞIYICI
-- YETKİ (bearer capability) ve varlık sebebi PAYLAŞILMAK: SMS/WhatsApp ile
-- gönderiliyor, müşteri linke defalarca dönüyor, yönetici "linki tekrar
-- gönder" diyebilmeli. Hash saklasaydık düz metin yalnız üretim anında
-- görünürdü ve her "tekrar gönder" YENİ bir link doğururdu.
--
-- Bedeli ve karşı önlemleri açıkça:
--   · Veritabanı sızarsa AÇIK linkler de sızar. Karşılığında: link kısa ömürlü
--     (varsayılan 2 saat), iptal edilebilir, sefer bitince ölür ve arkasında
--     YALNIZ konum + ETA + durum var. Şoför adı, plaka, filo YOK.
--   · Tahmin edilemezlik entropiden gelir: 32 bayt (256 bit) rastgelelik.
--     Kaba kuvvet, hız sınırı olmasa bile anlamsız.
--
-- ═══ NEDEN "KAPALI" BAYRAĞI YOK ═══
--
-- Link üç yoldan ölür: (a) süre doldu, (b) yönetici iptal etti, (c) SEFER
-- kapandı (tamamlandi/iptal). (c) için tabloya bir bayrak KOYULMADI: seferin
-- durumu zaten `seferler.durum`da ve okuma anında bakılıyor. Bayrak koysaydık
-- sefer kapandığında N linki güncelleyen ikinci bir yazma yolu doğar ve iki
-- gerçek sessizce ayrışırdı ("sefer kapalı ama link hâlâ açık").
--
-- ═══ NEDEN SAYAÇ VAR AMA HER İSTEKTE YAZILMIYOR ═══
--
-- `hit_count` / `last_hit_at` kötüye kullanım izidir: link yayıldıysa görünür.
-- Ama yoklama sayfası dakikada bir çağrılıyor ve HER istekte UPDATE atmak,
-- okuma yükünü yazma yüküne çevirirdi. Uygulama katmanı bu iki alanı
-- KISILMIŞ yazar: en fazla dakikada bir (lib/takip-db.ts). Sayı bu yüzden
-- "yaklaşık"tır ve öyle olması yeterlidir — burada aranan şey trend, muhasebe
-- değil.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role okur/yazar;
-- girişsiz sayfa da sunucuda çalışır ve token'ı ANAHTARLI okur.
-- =====================================================================

begin;

create table if not exists public.sefer_takip_linkleri (
  id uuid primary key default gen_random_uuid(),

  -- Hangi sefer. Sefer silinirse linkleri de gider: linkin seferden bağımsız
  -- anlamı yok.
  sefer_id uuid not null references public.seferler(id) on delete cascade,

  -- URL'deki gizli parça. 32 bayt rastgele → base64url (43 karakter).
  -- ⚠️ Açık metin; gerekçesi ve bedeli başlık bloğunda.
  token text not null,

  -- MUTLAK bitiş. Süre kiracı ayarı (TAKIP_LINK_TTL_MIN, varsayılan 120 dk)
  -- ama linke YAZILIR: ayar sonradan değişse bile dağıtılmış linkin ömrü
  -- değişmez. "Gönderdiğim link ne zaman ölecek" sorusunun cevabı sabit olmalı.
  expires_at timestamptz not null,

  -- Yönetici iptali. null = iptal edilmedi.
  revoked_at timestamptz,
  revoked_by uuid references public.workers(id) on delete set null,

  -- Yöneticinin kendi notu: "hangi müşteriye gönderdim". Bir seferin birden
  -- fazla linki olabildiği için ayırt edici. ⚠️ GİRİŞSİZ SAYFADA GÖSTERİLMEZ.
  alici_not text check (alici_not is null or length(btrim(alici_not)) between 1 and 80),

  created_by uuid references public.workers(id) on delete set null,
  created_at timestamptz not null default now(),

  -- Kötüye kullanım izi. KISILMIŞ yazılır (başlık bloğu).
  hit_count integer not null default 0 check (hit_count >= 0),
  last_hit_at timestamptz,

  -- Aynı token iki kez var olamaz. Anahtarlı okuma da bu indeksten gider.
  constraint sefer_takip_token_uq unique (token),

  -- Biçim kısıtı: base64url alfabesi ve makul uzunluk. Yanlışlıkla kısa ya da
  -- boşluklu bir token yazmak şema düzeyinde imkânsız.
  constraint sefer_takip_token_bicim
    check (token ~ '^[A-Za-z0-9_-]{32,86}$'),

  -- Süre geçmişe yazılamaz: ölü doğan link, sessiz bir hata olurdu.
  constraint sefer_takip_sure_ileri check (expires_at > created_at)
);

-- Seferin linklerini listele / topluca iptal et.
create index if not exists sefer_takip_sefer_idx
  on public.sefer_takip_linkleri (sefer_id);

-- "Şu an açık linkler" — yönetici ekranı ve temizlik işleri.
-- Kısmi indeks: iptal edilmişler taranmaz.
create index if not exists sefer_takip_acik_idx
  on public.sefer_takip_linkleri (expires_at)
  where revoked_at is null;

comment on table public.sefer_takip_linkleri is
  'Müşteriye gönderilen süreli canlı takip linkleri (079). Girişsiz sayfa YALNIZ konum + ETA + durum gösterir; şoför adı/plaka/filo göstermez.';
comment on column public.sefer_takip_linkleri.token is
  'URL''deki gizli parça, 32 bayt rastgele (base64url). Açık metin saklanır — taşıyıcı yetki, tekrar gönderilebilmeli (bkz. migration başlığı).';
comment on column public.sefer_takip_linkleri.expires_at is
  'Mutlak bitiş. Kiracı ayarı değişse bile dağıtılmış linkin ömrü değişmez.';
comment on column public.sefer_takip_linkleri.hit_count is
  'Yaklaşık açılma sayısı. Uygulama katmanı en fazla dakikada bir günceller.';

commit;

notify pgrst, 'reload schema';

-- ── DOĞRULAMA (ayrı çalıştırın) ───────────────────────────────────────
-- select count(*) from public.sefer_takip_linkleri;           → 0 beklenir
-- \d public.sefer_takip_linkleri                              → 2 indeks + 3 kısıt
--
-- ⚠️ 079 UYGULANMAZSA: takip özelliği KAPALI kalır, panel ve mobil normal
-- çalışır. Okuma yolları `tabloYok` ile boş döner (aynı kademeli düşüş
-- deseni 056/058/077/078'de de var).
