-- 069 — 063'ÜN ONARIMI: `geofences.category` her kurulumda GERÇEKTEN olsun
-- =====================================================================
-- ═══ NEDEN GEREKLİ — CANLIDA ÖLÇÜLDÜ (20.08.2026) ═══
-- Demo'da `GET /api/mobile/geofences` **503** veriyor. Panel çalışıyor, çünkü
-- `app/actions/geofences.ts` → `selectZones` `category` kolonunu OKUMUYOR;
-- mobil yol (`lib/geofences-db.ts` → `listGeofences`) okuyor. Yani 063 demo'da
-- uygulanmamış ve bu, beş mobil bölge ucunu sessizce ölü bırakmış.
--
-- ═══ 063 NEDEN YARIM KALMIŞ OLABİLİR (kuvvetli şüphe) ═══
-- 063'ün son adımı şu indeksi kuruyor:
--     create index ... on public.geofences (active) where archived_at is null;
-- ama `archived_at` kolonunu KENDİSİ eklemiyor — daha eski bir migration'ın
-- eklediğini varsayıyor. O migration koşmamış bir veritabanında bu satır
-- hata verir; 063 tek bir `begin/commit` içinde olduğu için **tamamı geri
-- alınır** ve `category` de eklenmemiş olur. Dışarıdan görünen tek belirti
-- mobil uçların 503 vermesidir — kimse bakmazsa aylarca sürer.
--
-- Bu dosya o zinciri kırar: eksik olabilecek HER parçayı ayrı ayrı ve
-- koşulsuz-güvenli biçimde tamamlar.
--
-- ═══ GÜVENLİK ═══
-- • IDEMPOTENT: istediğin kadar çalıştır, ikincisi hiçbir şey yapmaz.
-- • Bölge SİLMEZ, TAŞIMAZ, yarıçap/merkez/amaç DEĞİŞTİRMEZ.
-- • Geriye doldurma DAR: yalnız hâlâ varsayılan `custom` değerinde duran
--   satırlara dokunur. Elle değiştirilmiş bir kategori EZİLMEZ.
-- • 063 zaten uygulanmış bir veritabanında (HAK61) çalıştırmak zararsızdır ve
--   hiçbir satırı değiştirmez.
--
-- ⚠️ ÜÇ VERİTABANI VAR (bkz. Bekleyen-Isler #128): hak-transport-takip ·
-- galzura-demo · sendigo. "Koşuldu" üç ayrı kutucuktur. Bu dosyanın asıl
-- hedefi **galzura-demo**.
--
-- Salt-okuma envanter için: db/maintenance/sema-envanteri.sql
-- =====================================================================

begin;

-- ── 1) archived_at ───────────────────────────────────────────────────
-- 063'ün varsaydığı ama eklemediği kolon. Önce bu gelir, yoksa aşağıdaki
-- kısmi indeks patlar ve tüm işlem geri alınır (bkz. yukarıdaki şüphe).
alter table public.geofences
  add column if not exists archived_at timestamptz;

-- ── 2) category ──────────────────────────────────────────────────────
-- Mobil bölge uçlarının okuduğu kolon. NOT NULL + varsayılan 'custom':
-- mevcut satırlar otomatik dolar, yazma yolları değişmeden çalışır.
alter table public.geofences
  add column if not exists category text not null default 'custom';

-- ── 3) CHECK kısıtı ──────────────────────────────────────────────────
-- Kısıt adını VARSAYMAK yerine `category` üzerindeki mevcut CHECK bulunup
-- düşürülüyor, sonra doğru hâliyle ekleniyor. Böylece dosya, kısıt farklı bir
-- adla oluşturulmuş bir veritabanında da tekrar çalıştırılabilir kalıyor
-- (064'te aynı desen `purpose` için kullanıldı).
do $$
declare k text;
begin
  select con.conname into k
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
   where ns.nspname = 'public'
     and rel.relname = 'geofences'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%category%'
   limit 1;
  if k is not null then
    execute format('alter table public.geofences drop constraint %I', k);
  end if;
end $$;

alter table public.geofences
  add constraint geofences_category_check
  check (category in ('depot','customer','restricted','custom'));

-- ── 4) GERİYE DOLDURMA ───────────────────────────────────────────────
-- 063'ün yaptığının aynısı, AYNI dar koşulla: yalnız varsayılanda duran
-- depo bölgeleri etiketlenir.
update public.geofences
   set category = 'depot'
 where purpose = 'depot' and category = 'custom';

-- 064'ten sonra doğan müşteri bölgeleri de rozetine kavuşsun. `category` bir
-- ROZET, `purpose` DAVRANIŞTIR (064 kararı) — bu satır davranışı değiştirmez,
-- yalnız rozeti davranışla tutarlı hâle getirir.
update public.geofences
   set category = 'customer'
 where purpose = 'customer' and category = 'custom';

-- ── 5) İndeks ────────────────────────────────────────────────────────
-- Arşivli olmayan bölgelerin listelenmesi (063'ün son adımı).
create index if not exists idx_geofences_not_archived
  on public.geofences (active)
  where archived_at is null;

commit;

notify pgrst, 'reload schema';

-- ── SONUÇ — koştuktan sonra bunu da çalıştır, çıktıyı bildir ─────────
select category, purpose, count(*) as adet
  from public.geofences
 group by category, purpose
 order by 1, 2;
