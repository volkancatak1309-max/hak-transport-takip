-- 073_messaging_groups.sql — GRUP MESAJLAŞMASI (yönetici kurar, şoförler grup içinde konuşur)
--
-- ⚠️ BU DDL HENÜZ ÇALIŞTIRILMADI. Volkan Supabase'de çalıştıracak.
--    Claude tarafından çalıştırılmadı; bu dosya deponun ŞEMA KAYDIDIR.
--
-- ── NE EKLİYOR ─────────────────────────────────────────────────────────────
-- 071 "şoför başına TEK konuşma" kuruyordu (conversations.worker_id UNIQUE).
-- Grup bunu kırıyor: 5 şoförü ortak bir işe yönlendirmek için tek mesaj.
--
-- ── NEDEN AYRI `groups` TABLOSU DEĞİL ──────────────────────────────────────
-- Ayrı tablo, mesaj + makbuz + okunmamış sayacı + önizleme + saklama süpürgesi
-- + legal_hold makinesinin TAMAMINI ikinci kez yazmayı gerektirirdi ve her
-- okuma yolu bir UNION olurdu. Burada tek `conversations` tablosuna TİP
-- ekleniyor: `messages` ve `message_receipts` HİÇ DEĞİŞMİYOR. Grup mesajı
-- sıradan bir mesajdır, yalnız conversation_id'si bir gruba işaret eder.
--
-- ── "ŞOFÖRLER BİRBİRİYLE MESAJLAŞAMAZ" KURALI DURUYOR ──────────────────────
-- Kural 071'de şemaya gömülüydü ve BOZULMUYOR: `direct` konuşmanın sahibi
-- hâlâ tek bir şofördür (aşağıdaki CHECK bunu zorunlu kılıyor). Grup AÇIKÇA
-- farklı bir tür ve üyeliği açık — türetilmiş değil. Gruptan birebir sohbete
-- giden yol YOKTUR: şoför grupta başka şoförü görür ama onun `direct`
-- konuşmasına erişemez (lib/messaging.ts erisimCoz, kendi kimliği kuralı).
--
-- ── GERİYE DÖNÜK ETKİ: SIFIR ───────────────────────────────────────────────
-- Tamamı eklemeli. `kind` varsayılanı mevcut satırları kendiliğinden 'direct'
-- yapar; tek satır yeniden yazılmaz. 22.08.2026 ölçümü: conversations 0,
-- messages 0, message_receipts 0 satır — CHECK zaten trivial olarak sağlanır.
--
-- ── RLS ────────────────────────────────────────────────────────────────────
-- Kapalı — deponun kuralı (anon key yok, RLS politikası 0, yetki uygulama
-- kodunda). 071'in aynı gerekçesi.

begin;

-- ── 1) conversations — TİP KAZANIYOR ───────────────────────────────────────

alter table public.conversations
  add column if not exists kind text not null default 'direct';

-- Grup adı. `direct` konuşmada NULL (muhatabın adı workers'tan geliyor).
alter table public.conversations
  add column if not exists title text;

alter table public.conversations
  add column if not exists created_by uuid references public.workers(id) on delete set null;

-- ── ARŞİV = SİLME DEĞİL ────────────────────────────────────────────────────
-- Grup silinmez, arşivlenir: herkes için SALT OKUNUR olur, geçmiş bozulmaz.
-- Gerekçe deponun mevcut felsefesi (messages.deleted_at, legal_hold,
-- action_snoozes.cancelled_at): "silmek kim ne yaptı bilgisini de yok eder".
-- Grup akışı bir OPERASYON KAYDIDIR — sevkiyat talimatları orada duruyor.
alter table public.conversations
  add column if not exists archived_at timestamptz;
alter table public.conversations
  add column if not exists archived_by uuid references public.workers(id) on delete set null;

-- `worker_id` artık zorunlu DEĞİL — grupta sahip yok.
-- ⚠️ UNIQUE kısıtına DOKUNULMUYOR ve bu bilinçli: PostgreSQL unique kısıtında
-- BİRDEN ÇOK NULL'a izin verir, yani gruplar (worker_id IS NULL) birbiriyle
-- çakışmaz. Kısıtı düşürüp kısmi indeksle yeniden kurmak aynı sonucu verirdi
-- ama "şoför başına tek konuşma" güvencesini bir an için ortadan kaldırırdı.
alter table public.conversations
  alter column worker_id drop not null;

-- ── BİÇİM KISITI — ASIL KORUMA BURADA ──────────────────────────────────────
-- direct ⇒ sahibi var, başlığı yok.   group ⇒ sahibi yok, başlığı var.
-- Bu kısıt olmadan "başlıklı ama sahipli" ya da "sahipsiz ve başlıksız" gibi
-- anlamsız satırlar yazılabilirdi ve okuma yolları sessizce yanlış davranırdı.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_kind_check') then
    alter table public.conversations
      add constraint conversations_kind_check
      check (kind in ('direct', 'group'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_shape_check') then
    alter table public.conversations
      add constraint conversations_shape_check
      check (
        (kind = 'direct' and worker_id is not null and title is null)
        or
        (kind = 'group'  and worker_id is null     and title is not null)
      );
  end if;
end $$;

-- ── 2) conversation_members — GRUP ÜYELİĞİ ─────────────────────────────────
--
-- ⚠️ ÇIKARILAN ÜYENİN SATIRI SİLİNMEZ, `left_at` İŞARETLENİR.
-- WhatsApp davranışı: çıkarılan kişi grubu listesinde görmeye devam eder,
-- geçmişi okur, yeni mesaj almaz. Filo ürününde ek ve daha güçlü gerekçe:
-- o şoföre o grupta bir TALİMAT verildi ("yarın 06:30 A deposu"). Gruptan
-- çıkarmak, ona söylenmiş şeyi ekranından silmemeli — 071'deki "kaza yaptım
-- kaydını sessizce yok etme" sorununun aynısı.
--
-- Okuma penceresi: üye `left_at`'ten SONRAKİ mesajları GÖRMEZ. Süzgeç uygulama
-- kodunda (messages.created_at <= left_at); şemada tutulamaz çünkü aynı mesaj
-- farklı üyeler için farklı görünürlükte.
create table if not exists public.conversation_members (
  conversation_id uuid not null
    references public.conversations(id) on delete cascade,
  worker_id uuid not null
    references public.workers(id) on delete cascade,

  joined_at timestamptz not null default now(),
  -- Kim ekledi — yetki tartışmasında "bunu kim yaptı" sorusunun cevabı.
  added_by uuid references public.workers(id) on delete set null,
  -- null = AKTİF üye. Dolu = çıkarıldı; geçmişi bu ana kadar okur.
  left_at timestamptz,
  -- Kim çıkardı. Çıkarılma bir yönetici kararıdır ve izi kalır.
  removed_by uuid references public.workers(id) on delete set null,

  -- PK çifti: aynı kişi iki kez eklenemez. Yeniden ekleme `left_at`'i
  -- temizler (upsert), yeni satır AÇMAZ — yoksa "kaç kez çıkarıldı" gürültüsü
  -- üyelik sorgusunu belirsizleştirirdi.
  primary key (conversation_id, worker_id)
);

-- ── 3) ARŞİV KİLİDİ — ŞEMAYA GÖMÜLÜ ────────────────────────────────────────
--
-- Arşivlenmiş grupta HİÇ KİMSE yazamaz: şoför de, şef de, patron da.
--
-- ⚠️ BU TETİKLEYİCİ UÇ KAPISININ YERİNE GEÇMEZ, ALTINA KONULUYOR.
-- Uç (POST /messages/[id]) arşivi ÖNCE denetleyip temiz bir 409 döndürecek;
-- bu tetikleyici, o kapının unutulduğu ya da atlandığı her yol için son hat:
-- yeni bir uç, duyuru dağıtımı, elle çalıştırılan bir SQL. Deponun kuralı
-- budur — koruma "kapı eklemekle" değil, YAPISAL OLARAK MÜMKÜN OLMAMAKLA
-- sağlanır (bkz. conversations.worker_id UNIQUE = şoför-şoför sohbeti yok).
--
-- SQLSTATE 'HK001' özel bir sınıf (PostgreSQL 'HK' sınıfını kullanmıyor).
-- Uç bunu yakalarsa 409 'conversation_archived' döndürmeli; yakalamazsa
-- 500 write_failed olur ve detayda bu mesaj görünür — sessiz başarı ASLA.
create or replace function public.mesaj_arsive_yazilamaz()
returns trigger
language plpgsql
as $$
declare
  ark timestamptz;
begin
  select archived_at into ark
  from public.conversations
  where id = new.conversation_id;

  if ark is not null then
    raise exception
      'arsivlenmis konusmaya mesaj yazilamaz (conversation_id=%, archived_at=%)',
      new.conversation_id, ark
      using errcode = 'HK001';
  end if;
  return new;
end;
$$;

-- `drop ... if exists` + `create`: yeniden çalıştırılabilir, ad çakışmasında
-- patlamaz.
drop trigger if exists trg_mesaj_arsive_yazilamaz on public.messages;
create trigger trg_mesaj_arsive_yazilamaz
  before insert on public.messages
  for each row
  execute function public.mesaj_arsive_yazilamaz();

-- ── İNDEKSLER ──────────────────────────────────────────────────────────────

-- "Benim gruplarım" — şoför/şef listesinin tek sorgusu. Kısmi: çıkmış üyeler
-- de listelenecek (salt okunur), bu yüzden left_at süzgeci indekste YOK.
create index if not exists idx_conv_members_worker
  on public.conversation_members (worker_id);

-- Grubun üye listesi + "n/m okudu" paydası.
create index if not exists idx_conv_members_conversation
  on public.conversation_members (conversation_id);

-- Yönetici liste ekranı gruplarda da sıralı gelsin; arşivlenmişler ayrı
-- bölümde gösterileceği için kısmi indeks AKTİF grupları hedefliyor.
create index if not exists idx_conversations_group_active
  on public.conversations (last_message_at desc nulls last)
  where kind = 'group' and archived_at is null;

comment on column public.conversations.kind is
  'direct = sofor basina tek konusma (071 kurali korunuyor) · group = uyeleri '
  'conversation_members''ta tutulan ortak oda.';
comment on column public.conversations.archived_at is
  'Dolu ise grup SALT OKUNUR — trg_mesaj_arsive_yazilamaz hicbir yazmaya izin '
  'vermez. Grup SILINMEZ, arsivlenir.';
comment on column public.conversation_members.left_at is
  'null = aktif uye. Dolu = cikarildi; gecmisi YALNIZ bu ana kadar okur '
  '(suzgec uygulama kodunda: messages.created_at <= left_at).';

commit;

-- ── ÇALIŞTIRDIKTAN SONRA — DOĞRULAMA SORGULARI ─────────────────────────────
--
-- 1) Mevcut konusmalarin hepsi 'direct' mi (beklenen: group=0):
--
--    select kind, count(*) from public.conversations group by 1;
--
-- 2) Bicim kisiti calisiyor mu — IKISI DE HATA VERMELI:
--
--    insert into public.conversations (kind, worker_id, title)
--      values ('group', gen_random_uuid(), null);      -- sahipli grup -> RED
--    insert into public.conversations (kind, worker_id, title)
--      values ('direct', null, 'olmaz');               -- sahipsiz birebir -> RED
--
-- 3) Arsiv kilidi calisiyor mu (gecici bir grupla):
--
--    begin;
--      insert into public.conversations (kind, title, archived_at)
--        values ('group','KILIT TESTI', now()) returning id;   -- <id> not al
--      insert into public.messages (conversation_id, sender_role, body)
--        values ('<id>', 'admin', 'gecmemeli');   -- HK001 HATASI BEKLENIYOR
--    rollback;   -- ⚠️ ROLLBACK: test verisi birakmaz
--
-- Beklenen hata: 'arsivlenmis konusmaya mesaj yazilamaz ...' (SQLSTATE HK001)
