-- HAK61 — Migration 028
-- Test şoför / test araç işareti (is_test).
--
-- NEDEN: canlıda bir akışı şoför gözünden denemek için gerçek bir şoförün
-- hesabına girip PIN'ini değiştirmek zorunda kalıyorduk. Artık kalıcı bir test
-- hesabı ve test aracı var; ikisi de HAK61'in hiçbir yönetici yüzeyinde
-- görünmez ama şoför panelinde birebir gerçek gibi çalışır.
--
-- NEDEN AYRI KOLON (is_active / status='inactive' DEĞİL):
--   • is_active=false girişi kırar (app/actions/auth.ts) ve vardiya açmayı
--     kırar (app/actions/shift.ts) → test hesabı işe yaramaz hâle gelir.
--   • vehicles.status='inactive' aracı vardiya başlatmada reddettirir
--     (app/actions/shift.ts: status === "active" şartı).
--   • fleet'e üçüncü değer eklemek workers tarafını çözmez ve FLEET_STYLE
--     rozet/filtre UI'ının her yerine dokunur.
-- is_test bu üçünden de bağımsız: kayıt her yönüyle "canlı" kalır, yalnız
-- yönetici LİSTE okumalarından düşer.
--
-- Tamamen EKLEMELİ ve idempotent: iki yeni kolon, iki kısmi indeks, iki veri
-- satırı. Hiçbir mevcut kolon/akış değişmez, hiçbir satır silinmez.
--
-- ⚠️ SUPABASE SQL EDITOR'DA BU SÜRÜMÜ DEPLOY ETMEDEN ÖNCE ÇALIŞTIRIN.
--    (026'daki kuralın aynısı.) Kolon yokken uygulama çökmez — lib/test-data.ts
--    hatayı yakalayıp boş kümeye düşer, yani panel bugünkü hâliyle çalışmaya
--    devam eder; yalnız test kaydı gizlenmemiş olur.

-- ── 1) Kolonlar ─────────────────────────────────────────────────────────────
alter table public.workers
  add column if not exists is_test boolean not null default false;

alter table public.vehicles
  add column if not exists is_test boolean not null default false;

comment on column public.workers.is_test is
  'true = test hesabı. Yönetici liste okumalarından düşer (lib/test-data.ts); giriş ve şoför paneli normal çalışır.';
comment on column public.vehicles.is_test is
  'true = test aracı. Yönetici liste okumalarından düşer; vardiya açma/kapatma normal çalışır.';

-- Kısmi indeks: test satırları avuç içi kadar, tam indeks israf olur.
create index if not exists idx_workers_is_test
  on public.workers (id) where is_test;
create index if not exists idx_vehicles_is_test
  on public.vehicles (id) where is_test;

-- ── 2) Mevcut "Test şoför" kaydı işaretlenir ────────────────────────────────
-- 21.07.2026'da açılmış, hiç vardiyası yok, PIN'i belirlenmiş durumda.
-- employee_number NULL'a çekilir: nextEmployeeNumber() en büyük numarayı baz
-- alıyor (app/actions/workers.ts), test hesabı sırada durursa gerçek personel
-- numaralandırmasını kaydırır.
update public.workers
   set is_test         = true,
       employee_number = null,
       plate           = 'TEST-001'   -- vehicles.assigned_worker_id'nin türetilmiş aynası
 where id = 'fa3841cc-f540-46f5-b170-91daa5e4c005';

-- ── 3) Test aracı ───────────────────────────────────────────────────────────
-- Plaka bilerek gerçek DO-* deseninden uzak: bir yerde sızarsa insan gözü
-- anında yakalasın. Cihaz alanları NULL — gerçek donanım yok, dolayısıyla
-- device_telemetry / vehicle_events / idle_episodes / vehicle_dtc tarafında
-- tek satır bile üretmez ve telemetri türevi ekranlarda kendiliğinden yoktur.
insert into public.vehicles (
  plate, make, model, year, status, fleet,
  assigned_worker_id, flespi_device_id, imei, tank_capacity_l, notes, is_test
)
select
  'TEST-001', 'TEST', 'TEST', null, 'active', 'mavi',
  'fa3841cc-f540-46f5-b170-91daa5e4c005', null, null, null,
  'Test aracı — gerçek donanım yok. Yönetici yüzeylerinde gizlidir (is_test).',
  true
where not exists (
  select 1 from public.vehicles where plate = 'TEST-001'
);

-- Kayıt zaten varsa (tekrar çalıştırma) işareti ve atamayı garantiye al.
update public.vehicles
   set is_test            = true,
       status             = 'active',
       assigned_worker_id = 'fa3841cc-f540-46f5-b170-91daa5e4c005'
 where plate = 'TEST-001';

-- PostgREST şema önbelleğini tazele (is_test kolonu /rest altında görünsün).
notify pgrst, 'reload schema';
