-- ═══════════════════════════════════════════════════════════════════════════
--  SENDIGO DÜZELTMESİ — HAK61'e ait cihaz dönem kaydını sil
--  31.07.2026 · Sendigo Supabase → SQL Editor → yapıştır → Run
-- ═══════════════════════════════════════════════════════════════════════════
--
--  NE OLDU
--  Migration 033 tabloyu kurduktan sonra HAK61'in KENDİ cihaz ayarı kaydını da
--  yazıyordu. Sendigo'nun veritabanına bu satır kuruluş anında düştü:
--     params = '11104: 120->131'
--     note   = 'Asiri hiz uyari esigi 120->131 km/s (28 cihaz + DO-505GS
--               kuyruk; gonderim UTC 2026-07-23T21:38)'
--  Yani HAK61'in 28 cihazına ve bir HAK61 PLAKASINA atıf yapan bir kayıt.
--
--  CANLI ETKİSİ (Sendigo kabul testinde görüldü)
--  /admin/alarmlar sayfasında "Seit den neuen Schwellen" filtresi çıkıyordu —
--  Sendigo'da hiç yaşanmamış bir olaya göre süzme seçeneği.
--
--  ⚠️ HAK61'DE ÇALIŞTIRMAYIN. Orada bu kayıt GERÇEKTİR ve raporların eşik
--     karşılaştırmaları ona dayanır (lib/config-epoch.ts).
--     Alttaki güvenlik kilidi zaten HAK61'de silme yapmayı engeller.
--
--  Kaynak düzeltmesi ayrıca yapıldı: db/install/sendigo-full.sql artık bu
--  satırı hiç yazmıyor (scripts/gen-install-sql.mjs). Bu dosya YALNIZ
--  31.07.2026'dan önce kurulmuş veritabanları içindir.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1) ÖNCE GÖR: ne silinecek? ─────────────────────────────────────────────
select id, changed_at, params, note
  from public.device_config_epochs
 where params like '%11104%'
   and note like '%DO-505GS%';
-- Beklenen: TAM 1 satır. Başka bir şey dönerse DUR ve önce incele.

-- ── 2) GÜVENLİK KİLİDİ: burası HAK61 veritabanı mı? ────────────────────────
-- HAK61'de silme YAPILMAMALI. Ayırt edici ölçüt: HAK61'in cihazlı araçları
-- var (flespi_device_id dolu) ve o kayıt gerçek bir olayı anlatıyor. Yeni
-- kurulumda henüz hiç cihaz eşlenmemiştir.
do $lock$
declare
  v_devices int;
begin
  select count(*) into v_devices
    from public.vehicles
   where flespi_device_id is not null;

  if v_devices > 0 then
    raise exception
      'DURDURULDU: bu veritabanında % cihazlı araç var. Bu betik YENİ ve henüz cihaz eşlenmemiş bir kurulum içindir; HAK61''de çalıştırılmamalıdır. Gerçekten devam etmek istiyorsanız bu bloğu elle kaldırın.',
      v_devices;
  end if;
end
$lock$;

-- ── 3) SİL ─────────────────────────────────────────────────────────────────
delete from public.device_config_epochs
 where params like '%11104%'
   and note like '%DO-505GS%';
-- Beklenen: DELETE 1

-- ── 4) DOĞRULA ─────────────────────────────────────────────────────────────
select count(*) as kalan_kayit from public.device_config_epochs;
-- Beklenen: 0

commit;

-- PostgREST önbelleğini tazele (alarm sayfası filtreyi yeniden okusun).
notify pgrst, 'reload schema';

-- Sonra: /admin/alarmlar sayfasında "Seit den neuen Schwellen" seçeneği
-- kalkmış olmalı.
