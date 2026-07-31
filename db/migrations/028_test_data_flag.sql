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

-- ── 2-3) Test şoförü + test aracı ───────────────────────────────────────────
--
-- ⚠️ 31.07.2026 — BOŞ VERİTABANI DÜZELTMESİ.
-- Bu bölüm 21.07.2026'da açılmış HAK61 test hesabının UUID'sini DÜZ YAZIYORDU.
-- Sıfırdan kurulan bir veritabanında o kayıt yoktur: update 0 satır etkiler,
-- ardından gelen insert `assigned_worker_id`'ye var olmayan bir UUID yazmaya
-- çalışır ve `vehicles.assigned_worker_id → workers(id)` yabancı anahtarı
-- (migration 009) yüzünden HATA verir. Migration zinciri 028'de durur, 029-040
-- hiç çalışmaz. İkinci müşteri kurulumunda yakalandı.
--
-- Çözüm: kimlik ARANIR, bulunamazsa YARATILIR. Üç aşamalı, sırayla:
--   1. Bilinen HAK61 test hesabı (varsa)  → canlıda bugünkü davranış birebir
--   2. is_test zaten işaretli bir hesap    → tekrar çalıştırmada sabit kalır
--   3. Hiçbiri yoksa yeni test hesabı      → boş veritabanı yolu
--
-- HAK61 canlısında 1. adım eşleşir; update'ler aynı değerleri yazar, araç zaten
-- vardır, insert atlanır. Yani bu düzeltme canlıda TAM NO-OP'tur.
do $$
declare
  v_worker uuid;
begin
  -- 1) Bilinen HAK61 test hesabı.
  select id into v_worker
    from public.workers
   where id = 'fa3841cc-f540-46f5-b170-91daa5e4c005';

  -- 2) Yoksa: zaten işaretlenmiş bir test hesabı (bu migration'ın tekrarı).
  if v_worker is null then
    select id into v_worker
      from public.workers
     where is_test
     order by created_at
     limit 1;
  end if;

  -- 3) O da yoksa: yeni test hesabı. PIN karşılığı olmayan bir bcrypt dizesi
  --    konur — hesap PANELDEN giriş yapabilsin diye VARDIR, ama kurulumcu
  --    PIN'i /admin/workers üzerinden bilinçli olarak belirleyene kadar hiçbir
  --    PIN bu hash'i açmaz. Telefon numarası gerçek bir numarayla ÇAKIŞMAZ.
  if v_worker is null then
    insert into public.workers (name, phone, pin_hash, is_admin, is_active, is_test)
    values (
      'Test Şoför',
      '+430000000001',
      '$2a$10$0000000000000000000000000000000000000000000000000000',
      false,
      true,
      true
    )
    returning id into v_worker;
  end if;

  -- Test şoförü işaretlenir. employee_number NULL'a çekilir:
  -- nextEmployeeNumber() en büyük numarayı baz alıyor (app/actions/workers.ts),
  -- test hesabı sırada durursa gerçek personel numaralandırmasını kaydırır.
  update public.workers
     set is_test         = true,
         employee_number = null,
         plate           = 'TEST-001'  -- vehicles.assigned_worker_id'nin türetilmiş aynası
   where id = v_worker;

  -- Test aracı. Plaka bilerek gerçek DO-* deseninden uzak: bir yerde sızarsa
  -- insan gözü anında yakalasın. Cihaz alanları NULL — gerçek donanım yok,
  -- dolayısıyla device_telemetry / vehicle_events / idle_episodes / vehicle_dtc
  -- tarafında tek satır bile üretmez ve telemetri türevi ekranlarda
  -- kendiliğinden yoktur.
  insert into public.vehicles (
    plate, make, model, year, status, fleet,
    assigned_worker_id, flespi_device_id, imei, tank_capacity_l, notes, is_test
  )
  select
    'TEST-001', 'TEST', 'TEST', null, 'active', 'mavi',
    v_worker, null, null, null,
    'Test aracı — gerçek donanım yok. Yönetici yüzeylerinde gizlidir (is_test).',
    true
  where not exists (
    select 1 from public.vehicles where plate = 'TEST-001'
  );

  -- Kayıt zaten varsa (tekrar çalıştırma) işareti ve atamayı garantiye al.
  update public.vehicles
     set is_test            = true,
         status             = 'active',
         assigned_worker_id = v_worker
   where plate = 'TEST-001';
end $$;

-- PostgREST şema önbelleğini tazele (is_test kolonu /rest altında görünsün).
notify pgrst, 'reload schema';
