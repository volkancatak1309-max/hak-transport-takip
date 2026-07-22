-- HAK61 — Migration 029
-- Filo şefi rolü: bir çalışan, bir filonun izleme yetkisini alır.
--
-- NEDEN AYRI KOLON, is_admin DEĞİL: filo şefi yönetici DEĞİLDİR. is_admin
-- verilseydi 19 yönetici sayfasının tamamı ve tüm yazma action'ları
-- (adminCloseShiftAction, editEntryAction, adminUpdateKmAction, PIN belirleme)
-- ona da açılırdı; sonra tek tek kapatmak gerekirdi ve yarın eklenecek her yeni
-- sayfa VARSAYILAN OLARAK görünür olurdu (fail-open).
--
-- Bu tasarımda şef is_admin=false kalır: requireAdmin() onu zaten reddeder,
-- yani kapalı sayfalar ve yazma yetkisi HİÇBİR KOD YAZILMADAN kapalıdır
-- (fail-closed). Yalnız iki sayfa (/admin, /admin/harita) yeni bir
-- requireFleetView() kapısıyla açılır ve verisi filoya daraltılır.
--
-- managed_fleet NULL  → normal çalışan (bugünkü herkes)
-- managed_fleet dolu  → o filonun şefi; şoförlüğü aynen devam eder
--
-- CHECK listesi vehicles.fleet ile AYNI tutulur (migration 023). Üçüncü bir
-- filo eklenirse İKİ kısıt da aynı migration'da genişletilmelidir — aksi hâlde
-- yeni filoya şef atanamaz ve hata mesajı bunu söylemez.
--
-- Tamamen EKLEMELİ ve idempotent. Kolon yokken uygulama çökmez:
-- lib/fleet-scope.ts sorgu hatasını yakalayıp "şef yok" durumuna düşer, yani
-- panel bugünkü hâliyle çalışmaya devam eder.
--
-- ⚠️ SUPABASE SQL EDITOR'DA BU SÜRÜMÜ DEPLOY ETMEDEN ÖNCE ÇALIŞTIRIN.
--
-- NOT: kimin hangi filoya şef olduğu GERÇEK KİŞİ VERİSİDİR ve gizlilik kuralı
-- gereği bu dosyada YOKTUR (migration 023'teki plaka backfill'iyle aynı kural).
-- Atama SQL'i ayrıca verildi ve Supabase SQL Editor'da elle çalıştırılır.

alter table public.workers
  add column if not exists managed_fleet text
  check (managed_fleet is null or managed_fleet in ('bordo', 'mavi'));

comment on column public.workers.managed_fleet is
  'Dolu ise bu çalışan o filonun ŞEFİdir: /admin ve /admin/harita sayfalarını yalnız kendi filosunun verisiyle görür. is_admin ile ilgisi yoktur ve yazma yetkisi vermez.';

-- Şef sayısı avuç içi kadar; kısmi indeks yeterli.
create index if not exists idx_workers_managed_fleet
  on public.workers (managed_fleet) where managed_fleet is not null;

-- PostgREST şema önbelleğini tazele (managed_fleet /rest altında görünsün).
notify pgrst, 'reload schema';
