-- 071_messaging.sql — UYGULAMA İÇİ MESAJLAŞMA (yönetici ↔ şoför)
--
-- ⚠️ BU DDL HENÜZ ÇALIŞTIRILMADI. Volkan Supabase'de çalıştıracak.
--    Claude tarafından çalıştırılmadı; bu dosya deponun ŞEMA KAYDIDIR.
--
-- ── NE ÇÖZÜYOR ─────────────────────────────────────────────────────────────
-- Telegram katmanı 20.08.2026'da tamamen söküldü ve o günden beri sistemde
-- şoföre ULAŞAN HİÇBİR KANAL YOK: veri tek yönlü akıyor (şoför üretir, yönetici
-- okur). `driver_reports` (020) var ama tek yönlü ve dört sabit seçenekli;
-- serbest metin yok, cevap yok.
--
-- ── KURAL: ŞOFÖRLER BİRBİRİYLE MESAJLAŞAMAZ ────────────────────────────────
-- Bu kural ŞEMAYA gömülü, koda değil. `conversations.worker_id` UNIQUE ve
-- konuşmanın sahibi DAİMA bir şofördür; şoför-şoför konuşması TEMSİL EDİLEMEZ.
-- Bir kontrol satırı unutulabilir, tablo şekli unutulamaz.
--
-- ── NEDEN ŞOFÖR BAŞINA TEK KONUŞMA, (yönetici,şoför) ÇİFTİ BAŞINA DEĞİL ────
-- Şoför alıcı SEÇMEZ — "Yönetim"e yazar. Çift ekseninde kursaydık aynı şoför
-- üç yöneticiyle üç ayrı geçmiş taşırdı: "bunu kime söylemiştim" sorusunun
-- cevabı kaybolurdu ve yönetici devri geçmişi parçalardı. Samsara ve Motive'in
-- şoför tarafı da alıcı seçtirmiyor (dispatch tek muhatap).
--
-- ── RLS ────────────────────────────────────────────────────────────────────
-- Kapalı — deponun kuralı. Bu kurulumda anon key YOK ve RLS politikası 0;
-- tüm erişim service-role ile sunucudan geçiyor, yetki uygulama kodunda
-- (lib/mobile-scope.ts, lib/session.ts). Burada RLS AÇMAK yanlış güven
-- duygusu verirdi: politika yazılmadan açılan RLS hiçbir şey korumaz.

begin;

-- ── 1) conversations — şoför başına TEK konuşma ────────────────────────────
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),

  -- KONUŞMANIN SAHİBİ = ŞOFÖR. UNIQUE: bir şoförün tek konuşması olur.
  -- on delete cascade: personel silinirse konuşması da gider (GDPR md. 17
  -- silme yolu). "Ayrılan personel" için silme DEĞİL is_active=false
  -- kullanılıyor (032) — o kişinin geçmişi durur.
  worker_id uuid not null unique
    references public.workers(id) on delete cascade,

  -- DENORMALİZE — yönetici listesi için. 1000 şoförlü filoda liste ekranı
  -- her satır için "son mesaj" sorgusu atsaydı 1000 sorgu olurdu; burada tek
  -- sorgu + tek indeks. Mesaj yazılırken güncellenir.
  last_message_at      timestamptz,
  last_message_preview text,
  last_sender_role     text check (last_sender_role in ('driver', 'admin')),

  created_at timestamptz not null default now()
);

-- ── 2) messages ────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.conversations(id) on delete cascade,

  -- GERÇEKTE YAZAN KİŞİ. on delete set null: personel silinse bile mesaj
  -- konuşmada kalır — karşı taraf için "cevap gelmiş miydi" sorusunun cevabı
  -- kaybolmamalı. Kim olduğu düşer, ne dediği kalır.
  sender_worker_id uuid references public.workers(id) on delete set null,

  -- GÖNDERİM ANINDA DONDURULUR. Kişinin rolü sonradan değişebilir (şoför
  -- şef olur, yönetici yetkisi alınır); o değişiklik GEÇMİŞ mesajın kimden
  -- geldiğini değiştirmemeli. Aynı gerekçe: zone_visits.worker_id dondurma.
  sender_role text not null check (sender_role in ('driver', 'admin')),

  -- Boş mesaj gönderilemez; tavan 4000 karakter. Sınır ŞEMADA da var çünkü
  -- istemci doğrulaması atlanabilir ve sınırsız metin bir DoS yüzeyidir.
  body text not null check (char_length(btrim(body)) between 1 and 4000),

  -- FİLO DUYURUSU: tek duyuru her şoförün konuşmasına BİRER satır olarak
  -- yazılır, hepsi aynı broadcast_id'yi taşır. Neden dağıtım: okuma modeli
  -- tekdüze kalır, okundu durumu şoför başına doğal olur, gelen cevap zaten
  -- kendi konuşmasına düşer. 500 şoför = 500 satır, önemsiz.
  broadcast_id uuid,

  -- ── SAKLAMA VE SİLME ─────────────────────────────────────────────────────
  -- GDPR md. 5(1)(e): saklama süresi TANIMLANMAK ZORUNDA. Süre dolduğunda
  -- silen süpürge `legal_hold = true` satırlara DOKUNMAZ. Gerekçesi somut:
  -- şoför sohbete "kaza yaptım" yazarsa o mesaj bir kayıttır ve saklama
  -- süresi dolduğu için sessizce yok edilmesi kabul edilemez.
  legal_hold boolean not null default false,

  -- Yumuşak silme (moderasyon + GDPR). Satırı gerçekten silmek "buradan bir
  -- mesaj kaldırıldı" bilgisini de yok ederdi.
  deleted_at timestamptz,
  deleted_by uuid references public.workers(id) on delete set null,

  created_at timestamptz not null default now()
);

-- ── 3) message_receipts — MESAJ BAŞINA ✓✓ ──────────────────────────────────
--
-- NEDEN AYRI TABLO, NEDEN messages.read_at DEĞİL: şoförün yazdığı bir mesajı
-- BİRDEN ÇOK yönetici okuyabilir. Tek kolon "Volkan okudu, Serkan okumadı"
-- durumunu ifade edemez ve ikinci yöneticinin okumamış olması görünmez olurdu.
--
-- ⚠️ NEXT_PUBLIC_READ_RECEIPTS_ENABLED=false olan kurulumda bu tabloya
-- HİÇBİR SATIR YAZILMAZ (uç seviyesinde, arayüzde gizleyerek değil). Avusturya
-- §96(1)3 ArbVG / Almanya §87 BetrVG: çalışanı izleyen teknik sistem işyeri
-- konseyi onayına bağlı. "Tutmuyoruz" diyip yazmaya devam etmek yanlış beyan
-- olurdu — bu yüzden kapı yazma yolunda.
create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  worker_id  uuid not null references public.workers(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_id, worker_id)
);

-- ── İNDEKSLER ──────────────────────────────────────────────────────────────

-- Konuşma ekranı: son N mesaj, sayfalı.
create index if not exists idx_messages_conversation
  on public.messages (conversation_id, created_at desc);

-- Yönetici liste ekranı: en son konuşulan üstte. NULLS LAST — hiç mesajı
-- olmayan konuşma (yeni açılmış) listenin sonunda kalır.
create index if not exists idx_conversations_recent
  on public.conversations (last_message_at desc nulls last);

-- Duyurunun kopyalarını toplamak (yönetici "bu duyuruyu kim okudu").
create index if not exists idx_messages_broadcast
  on public.messages (broadcast_id)
  where broadcast_id is not null;

-- Okunmamış sayacı: "bana ait makbuzu OLMAYAN mesajlar" (NOT EXISTS).
-- PK (message_id, worker_id) bu yönde işe yaramaz; ters sıra gerekiyor.
create index if not exists idx_receipts_worker
  on public.message_receipts (worker_id, message_id);

-- Saklama süpürgesi: dokunulabilir satırları taramak. Kısmi indeks, çünkü
-- legal_hold ve silinmiş satırlar süpürgenin ilgi alanı dışında.
create index if not exists idx_messages_retention
  on public.messages (created_at)
  where legal_hold = false and deleted_at is null;

-- ── RLS: deponun kuralı (yukarıdaki nota bakın) ────────────────────────────
alter table public.conversations    disable row level security;
alter table public.messages         disable row level security;
alter table public.message_receipts disable row level security;

comment on table public.conversations is
  'Sofor basina TEK konusma. worker_id UNIQUE oldugu icin sofor-sofor '
  'mesajlasmasi semada TEMSIL EDILEMEZ.';
comment on column public.messages.sender_role is
  'Gonderim aninda dondurulur — kisinin rolu sonradan degisse bile gecmis '
  'mesajin kimden geldigi degismez.';
comment on column public.messages.legal_hold is
  'true ise saklama supurgesi DOKUNMAZ (kaza/ihtilaf kaydi).';
comment on table public.message_receipts is
  'Mesaj basina okundu (✓✓). NEXT_PUBLIC_READ_RECEIPTS_ENABLED=false olan '
  'kurulumda hic satir yazilmaz (DACH §96 ArbVG / §87 BetrVG).';

commit;
