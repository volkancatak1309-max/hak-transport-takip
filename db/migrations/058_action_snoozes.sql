-- 058_action_snoozes.sql — AKSİYON ERTELEME (alarm / dikkat kalemi / izin talebi)
--
-- ⚠️ BU DDL VOLKAN TARAFINDAN 11.08.2026'DA SUPABASE'DE ÇALIŞTIRILDI ve HAK61
-- canlısında UYGULANMIŞ durumdadır. Bu dosya deponun ŞEMA KAYDIDIR — yeni bir
-- kurulum migration listesini buradan yürütecek. Claude tarafından çalıştırılmadı.
--
-- ── NEDEN GEREKLİ ──────────────────────────────────────────────────────────
-- Mobildeki Aksiyon Merkezi üç kaynağı (cihaz olayları, dikkat kalemleri, izin
-- talepleri) tek listede topluyor. "Bunu şimdi değil, yarın sabah hallederim"
-- diyebilmek listenin işe yaraması için şart: erteleyemeyen yönetici kalemi
-- görmezden gelmeyi öğrenir ve liste gürültüye döner.
--
-- ── NEDEN CİHAZDA DEĞİL SUNUCUDA ───────────────────────────────────────────
-- Telefonda ertelenen bir uyarı panelde ve ikinci telefonda "bekliyor"
-- görünürdü; iki yönetici aynı filoyu iki farklı listeyle yönetirdi. Erteleme
-- ancak sunucuda kalıcıysa DOĞRUDUR. Bu, mobilde "Ertelenen" sekmesinin
-- 11.08.2026'ya kadar KAPALI ÖZELLİK olarak durmasının da sebebiydi.
--
-- ── NEDEN YABANCI ANAHTAR YOK ──────────────────────────────────────────────
-- Ertelenebilir kalemler ÜÇ ayrı kaynaktan geliyor (vehicle_events,
-- TÜRETİLMİŞ dikkat kalemleri, worker_leaves) ve tek bir tabloya bağlanamaz.
-- Türetilmiş kalemlerin (ör. "kör araç", "belge süresi doluyor") veritabanında
-- SATIRI BİLE YOK — hesaplanıyorlar. Bu yüzden kalem, (tür + kimlik) çiftiyle
-- tanımlanıyor. Başka bir yol yok; FK yokluğu bir eksiklik değil, kaynağın
-- doğasının sonucu.
--
-- item_id `text`, uuid DEĞİL: üç kaynağın kimlik uzayı farklı. vehicle_events.id
-- uuid, dikkat kalemi kimliği türetilmiş bir dizge ("silent:<aracId>" gibi),
-- worker_leaves.id uuid. Kolonu uuid yapmak dikkat kalemlerini dışarıda bırakırdı.
--
-- ── NEDEN cancelled_at, NEDEN DELETE DEĞİL ─────────────────────────────────
-- "Şimdi geri al" satırı SİLMEZ, iptal işaretler. Silmek "kim ertelemişti, kim
-- geri aldı" sorusunun cevabını yok ederdi; erteleme bir yönetici kararıdır ve
-- kararın izi kalır. `closed_at`/`closed_by` (057) ile aynı gerekçe.
--
-- ── SÜRE DOLUNCA OTOMATİK GERİ DÖNÜŞ — CRON GEREKMİYOR ─────────────────────
-- Liste ucu `snoozed_until > now()` koşuluyla süzüyor; süresi geçen kalem
-- kendiliğinden bekleyene döner. Zamanlanmış iş yazmak, sorgunun zaten
-- yaptığı şeyi ikinci kez yapmak olurdu.
--
-- ── GERİYE DÖNÜK ETKİ YOK ──────────────────────────────────────────────────
-- Yeni tablo; mevcut hiçbir sorgu, sayı ya da ekran değişmez. Bu tablosu
-- olmayan kurulumda (Sendigo/galzura-demo) erteleme uçları `tablo_yok` der ve
-- liste uçları `ertelemeler: []` + `ertelemeDurumu: "tablo_yok"` ile SÖYLER —
-- sessizce "hiç erteleme yok" gibi görünmez.
--
-- Gizlilik: bu dosyada plaka/isim YOK.

create table if not exists public.action_snoozes (
  id            uuid primary key default gen_random_uuid(),
  -- 'alarm' | 'attention' | 'leave' — mobil istemcinin kaynak öneki.
  item_source   text not null check (item_source in ('alarm','attention','leave')),
  -- Kaynağın kendi kimliği (vehicle_events.id, dikkat kalem kimliği, leave id).
  item_id       text not null,
  -- Kalem bir araca/kişiye bağlıysa taşınır: ileride "bu aracın tüm
  -- ertelemelerini göster" sorgusu tablo taraması gerektirmesin.
  vehicle_id    uuid references public.vehicles(id) on delete cascade,
  worker_id     uuid references public.workers(id) on delete cascade,
  snoozed_until timestamptz not null,
  snoozed_by    uuid not null references public.workers(id),
  created_at    timestamptz not null default now(),
  -- Geri alma SİLME DEĞİL: kim ne zaman geri aldı izi kalsın.
  cancelled_at  timestamptz
);

-- Bir kalemin AYNI ANDA tek etkin ertelemesi olur.
--
-- ⚠️ KISMİ indeks: PostgREST'in `on_conflict` parametresi WHERE yüklemini
-- taşıyamadığı için bu indeks `.upsert()` ile ARBITER olarak KULLANILAMAZ.
-- lib/action-snoozes-db.ts bu yüzden oku-sonra-yaz yapıyor ve yarışta dönen
-- 23505'i güncellemeye çeviriyor. (Ölçüldü, 11.08.2026.)
create unique index if not exists idx_action_snoozes_item_active
  on public.action_snoozes(item_source, item_id)
  where cancelled_at is null;

-- "Şu an ertelenmiş olanlar" sorgusunun taradığı yol.
create index if not exists idx_action_snoozes_until
  on public.action_snoozes(snoozed_until)
  where cancelled_at is null;

-- Servis-rol istemcisi dışında erişim yok (projedeki diğer tablolarla aynı).
alter table public.action_snoozes disable row level security;

-- PostgREST şema önbelleğini yenile (yeni tablo hemen görünür olsun).
notify pgrst, 'reload schema';
