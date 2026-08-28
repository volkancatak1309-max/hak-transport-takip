-- HAK61 / Galzura Fleet — Migration 093 (MÜKERRER İNDEKS DÜŞÜRME)
-- =====================================================================
-- Idempotent (`if exists`). ⚠️ SIFIRDAN KURULUMUN PARÇASI DEĞİLDİR:
-- `gen-install-sql.mjs` → HARIC. Gerekçe orada yazılı, özeti şu: düşürülen
-- indeksi HİÇBİR migration yaratmıyor, dolayısıyla yeni bir kiracıda zaten
-- yok ve bu dosya orada no-op olurdu.
--
-- Bu bir CANLI ŞEMA ONARIMIDIR: HAK61'in veritabanında, repoda karşılığı
-- olmayan, elle açılmış bir indeks var ve 053'ün kurduğunun BİREBİR AYNISI.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÖNCE 1. BÖLÜMÜ ÇALIŞTIR. "DÜŞÜR" ÇIKMAZSA BU DOSYAYI ÇALIŞTIRMA.
-- ═══════════════════════════════════════════════════════════════════════
--
-- Bulguyu ben ölçmedim — `pg_index`e erişimim yok (tek kanal PostgREST,
-- ayrıntı `docs/HAK61-SAGLIK.md` § 0). Bu dosyayı yazarken dayandığım şey
-- Volkan'ın SQL Editor'dan aldığı `pg_indexes` çıktısıdır:
--
--   idx_device_telemetry_fuel
--     btree (vehicle_id, recorded_at) INCLUDE (fuel_level_pct, odometer_km)
--     WHERE (fuel_level_pct IS NOT NULL)        101 MB · idx_scan 9.198
--
--   idx_device_telemetry_vehicle_fuel_pct
--     btree (vehicle_id, recorded_at) INCLUDE (fuel_level_pct, odometer_km)
--     WHERE (fuel_level_pct IS NOT NULL)         80 MB · idx_scan 29.243
--
-- 🔴 NEDEN `pg_indexes` KARŞILAŞTIRMASI YETMEZ — ÖLÇÜLDÜ.
--
-- `indexdef` metni tanım ŞEKLİNİ iyi anlatır (opclass, collation, desc,
-- nulls first, INCLUDE, WHERE, unique — hepsi varsayılan dışıysa basılır).
-- Anlatmadığı şey indeksin DURUMUDUR. Yerel bir PostgreSQL 15 konteynerinde
-- birebir kuruldu ve ölçüldü (28.08.2026):
--
--     A· iki indexdef metni (ad dışı) eşit mi ....... true
--     B· kalan indeks indisvalid .................... FALSE
--     C· aşağıdaki karar sorgusunun kararı .......... DURDUR
--
-- Yani başarısız bir `create index concurrently` kalıntısı GEÇERSİZ bir
-- indeks bırakır, metni ise sapasağlam görünür. O hâlde "metinler aynı,
-- birini düşür" denseydi, planlayıcının kullanabildiği TEK indeks düşerdi.
-- Aşağıdaki sorgu tanımı OID düzeyinde karşılaştırır VE düşürmeyi güvensiz
-- kılan yedi durumu ayrı ayrı eler.
--
-- Sorgunun kendisi de sınandı: dokuz farklı bozma denemesinin (desc,
-- farklı WHERE, kolon sırası, INCLUDE sırası, INCLUDE eksik, unique,
-- nulls first, opclass, btree↔hash) DOKUZUNDA da DURDUR döndü; yalnız
-- birebir aynı çiftte DÜŞÜR dedi. Ayrıntı: `docs/INDEKS-DIYETI.md` § 1.


-- ═════════════════════ 1 · DOĞRULAMA (SALT OKUMA) ══════════════════════
--
-- 1a — TAM ENVANTER. Kaç indeks var, hangileri? (Repodan türettiğim liste
--      9 nesne diyor; Volkan'ın bulduğu `idx_device_telemetry_fuel` o
--      listede YOK, yani canlıda en az 10 var. Bu sorgu sayıyı kesinleştirir
--      ve 053'ün gerçekten uygulanıp uygulanmadığını da gösterir.)
--
--   select
--     c.relname                                   as indeks,
--     am.amname                                   as yontem,
--     pg_size_pretty(pg_relation_size(c.oid))     as boyut,
--     s.idx_scan                                  as tarama,
--     i.indisvalid, i.indisready, i.indislive,
--     pg_get_indexdef(i.indexrelid)               as tanim
--   from pg_index i
--   join pg_class c  on c.oid = i.indexrelid
--   join pg_am   am  on am.oid = c.relam
--   left join pg_stat_user_indexes s on s.indexrelid = i.indexrelid
--   where i.indrelid = 'public.device_telemetry'::regclass
--   order by pg_relation_size(c.oid) desc;
--
--
-- 1b — 🔴 KARAR SORGUSU. Tek satır döner. `karar` sütunu 'DÜŞÜR' demiyorsa
--      2. bölümü ÇALIŞTIRMA; hangi kontrolün `false` döndüğünü bildir.
--
--   with
--     a as (select * from pg_index where indexrelid = 'public.idx_device_telemetry_fuel'::regclass),
--     b as (select * from pg_index where indexrelid = 'public.idx_device_telemetry_vehicle_fuel_pct'::regclass),
--     ca as (select relam from pg_class where oid = 'public.idx_device_telemetry_fuel'::regclass),
--     cb as (select relam from pg_class where oid = 'public.idx_device_telemetry_vehicle_fuel_pct'::regclass),
--     k as (
--       select
--         -- ── TANIM EŞİTLİĞİ (hepsi true olmalı) ───────────────────────
--         (ca.relam = cb.relam)                                as ayni_yontem,
--         -- indkey ANAHTAR + INCLUDE kolonlarının tamamını, SIRASIYLA taşır
--         (a.indkey::text = b.indkey::text)                    as ayni_kolon_sirasi,
--         (a.indnkeyatts = b.indnkeyatts)                      as ayni_anahtar_sayisi,
--         (a.indnatts    = b.indnatts)                         as ayni_toplam_kolon,
--         (a.indclass::text = b.indclass::text)                as ayni_opclass,
--         (a.indcollation::text = b.indcollation::text)        as ayni_collation,
--         -- indoption: asc/desc + nulls first/last bayrakları
--         (a.indoption::text = b.indoption::text)              as ayni_siralama,
--         (coalesce(pg_get_expr(a.indpred,   a.indrelid), '')
--          = coalesce(pg_get_expr(b.indpred,   b.indrelid), '')) as ayni_where,
--         (coalesce(pg_get_expr(a.indexprs, a.indrelid), '')
--          = coalesce(pg_get_expr(b.indexprs, b.indrelid), '')) as ayni_ifade,
--         -- ── DÜŞÜRÜLECEK OLANIN GÜVENLİĞİ (hepsi true olmalı) ─────────
--         (not a.indisunique)                                  as dusen_unique_degil,
--         (not a.indisprimary)                                 as dusen_pk_degil,
--         (not a.indisexclusion)                               as dusen_exclusion_degil,
--         (not a.indisreplident)                               as dusen_replica_identity_degil,
--         (not exists (select 1 from pg_constraint
--                       where conindid = 'public.idx_device_telemetry_fuel'::regclass))
--                                                              as dusen_kisit_tasimiyor,
--         -- ── KALACAK OLANIN SAĞLIĞI (hepsi true olmalı) ───────────────
--         b.indisvalid                                         as kalan_gecerli,
--         b.indisready                                         as kalan_hazir,
--         b.indislive                                          as kalan_canli
--       from a, b, ca, cb
--     )
--   select *,
--     case when ayni_yontem and ayni_kolon_sirasi and ayni_anahtar_sayisi
--               and ayni_toplam_kolon and ayni_opclass and ayni_collation
--               and ayni_siralama and ayni_where and ayni_ifade
--               and dusen_unique_degil and dusen_pk_degil and dusen_exclusion_degil
--               and dusen_replica_identity_degil and dusen_kisit_tasimiyor
--               and kalan_gecerli and kalan_hazir and kalan_canli
--          then 'DÜŞÜR'
--          else '🔴 DURDUR — yukarıdaki false sütuna bak'
--     end as karar
--   from k;
--
-- Sorgu "0 satır" dönerse indekslerden biri YOKTUR (`regclass` cast'i o
-- durumda hata verir, 42P01) — o da bir cevaptır: düşürecek bir şey yok.
--
-- ⚠️ NEDEN `indisreplident` KONTROL EDİLİYOR: Supabase realtime mantıksal
-- çoğaltma kullanıyor. Bir tablo `replica identity using index` ile
-- yapılandırılmışsa o indeksi düşürmek çoğaltmayı bozar. Bu tabloda öyle
-- olmadığını beklerim ama beklenti kontrol değildir.


-- ═════════════════════ 2 · DÜŞÜRME ═════════════════════════════════════
--
-- ── KİLİT KARARI ───────────────────────────────────────────────────────
--
-- `drop index` tabloda ACCESS EXCLUSIVE kilidi alır. İki ayrı süre var ve
-- karıştırılırsa yanlış araç seçilir:
--
--   TUTMA süresi : milisaniye. İş yalnız katalog satırlarını silmek ve
--                  dosya unlink'ini commit'e yazmaktır — 101 MB'ın boyutu
--                  bu süreyi etkilemez (veri okunmuyor, dosya siliniyor).
--   BEKLEME süresi : sınırsız olabilir. Ve asıl tehlike budur.
--
-- 🔴 TEHLİKE KUYRUKTUR, TUTMA DEĞİL. ACCESS EXCLUSIVE bekleyen bir ifade
-- kuyruğun BAŞINA geçer: o beklerken gelen HER yeni sorgu (30 saniyede bir
-- koşan flespi sync yazması dahil) onun arkasına dizilir. Yani drop, 7
-- saniye süren bir yakıt raporu ifadesinin (ölçüldü, `docs/HAK61-SAGLIK.md`
-- § 8.2) arkasına düşerse device_telemetry o 7 saniye boyunca fiilen kilitli
-- kalır — düşürme işi 5 ms sürse bile.
--
-- ✅ ÇÖZÜM: `lock_timeout`. Kilit N ms içinde alınamazsa ifade İPTAL olur,
-- işlem geri alınır ve KUYRUK HİÇ OLUŞMAZ. Maliyeti "hiçbir şey olmadı,
-- tekrar dene"dir. 3 saniye seçildi: sync yazmaları kısa, 3 sn tipik bir
-- pencereyi yakalamaya yeter; yakalayamazsa da zarar yok.
--
-- ── NEDEN `CONCURRENTLY` DEĞİL ─────────────────────────────────────────
--
-- `drop index concurrently` daha zayıf bir kilit (SHARE UPDATE EXCLUSIVE)
-- alır ve okumayı/yazmayı engellemez — cazip. Kullanılmadı, üç sebeple:
--
--   1. İŞLEM BLOĞUNDA ÇALIŞMAZ (25001). Bu depodaki migration'lar
--      `begin; … commit;` ile koşuyor ve Supabase SQL Editor'a yapıştırılan
--      çok ifadeli bir betiği PostgreSQL zaten örtük tek işlem olarak
--      çalıştırır. 049 ve 053 aynı uyarıyı kendi başlıklarında taşıyor.
--   2. YARIM KALIRSA İZ BIRAKIR. İptal edilen bir CONCURRENTLY düşürme
--      indeksi INVALID hâlde bırakabilir; temizlemek için ikinci bir düz
--      drop gerekir. Yani "güvenli yol" arızada daha karmaşık bir hâl üretir.
--   3. KAZANCI KÜÇÜK. CONCURRENTLY, CREATE tarafında (dakikalarca süren
--      indeks kurulumu) hayat kurtarır. DROP tarafında kaçınılan şey zaten
--      milisaniyelik bir tutmadır; asıl risk olan BEKLEME'yi ise CONCURRENTLY
--      değil `lock_timeout` çözer.
--
-- Karar: DÜZ `drop index` + `set local lock_timeout`.
--
-- ── ÇALIŞTIRMA ─────────────────────────────────────────────────────────
-- Yoğun saatte koşturmaya gerek yok ama şart da değil. `55P03` (lock_timeout)
-- alırsan hiçbir şey olmamıştır: birkaç dakika sonra tekrar çalıştır.
-- Üst üste 3 kez 55P03 alıyorsan device_telemetry üzerinde uzun koşan bir
-- sorgu var demektir — `pg_stat_activity`ye bak, sonra tekrar dene.

begin;

-- Kilidi 3 saniyeden uzun BEKLEME. Süre dolarsa 55P03 ile iptal olur ve
-- `commit` hiç çalışmaz; canlıda tek satır bile değişmez.
set local lock_timeout = '3s';

/**
 * DÜŞÜRÜLEN: idx_device_telemetry_fuel
 *
 * KAYNAĞI: HİÇBİR MIGRATION. Depoda (`db/migrations`, `db/install`, `lib`,
 * `app`, `scripts`, `docs`) bu ad tam eşleşmeyle HİÇ geçmiyor — arandı.
 * Canlı HAK61'e Supabase SQL Editor'dan elle açılmış. Bu, depoda kaydı
 * olmayan İKİNCİ elle şema nesnesi: birincisi `vehicles.tank_capacity_l`
 * (bkz. gen-install-sql.mjs → KÖPRÜ 1).
 *
 * KALAN: idx_device_telemetry_vehicle_fuel_pct — migration 053
 * (`053_covering_indexes.sql:70`), dört kurulum dosyasında da var.
 *
 * NEDEN BÜYÜK OLAN DÜŞÜYOR: ikisinin tanımı aynı, fark yalnız şişkinlik
 * (101 MB ↔ 80 MB). Aynı tanımdan ikisini tutmanın hiçbir okuma faydası
 * yok — planlayıcı ikisinden birini keyfî seçiyor, `idx_scan` sayıları
 * (9.198 ↔ 29.243) bunu gösteriyor. Düşünce sonrası 9.198 tarama kalan
 * indekse gider; plan DEĞİŞMEZ, çünkü tanım birebir aynı.
 *
 * Kalanı seçmenin ikinci sebebi: düşünce sonrası canlı HAK61'in şeması
 * `db/install/hak61-full.sql` ile hizalanır. Bugün fazladan bir nesne
 * taşıyor ve hiçbir belge onu anlatmıyor.
 */
drop index if exists public.idx_device_telemetry_fuel;

commit;


-- ═════════════════════ 3 · GERİ ALMA ═══════════════════════════════════
--
-- Aşağıdaki cümle indeksi birebir geri kurar. ⚠️ İŞLEM BLOĞUNA KOYMA ve
-- TEK BAŞINA çalıştır (`concurrently` transaction içinde çalışmaz).
--
--   create index concurrently if not exists idx_device_telemetry_fuel
--     on public.device_telemetry (vehicle_id, recorded_at)
--     include (fuel_level_pct, odometer_km)
--     where fuel_level_pct is not null;
--
-- `concurrently` BURADA gerekli: ~1,7 M satırlık tabloda ~100 MB'lık bir
-- indeksi düz `create index` ile kurmak, kurulum boyunca SHARE kilidi tutar
-- ve YAZMAYI ENGELLER — yani flespi sync o süre boyunca telemetri yazamaz.
-- Düşürmede kaçınılan milisaniye burada dakikaya dönüşüyor; araç da
-- ona göre değişiyor.
--
-- Kurulum yarıda kalırsa indeks INVALID kalır. Kontrol ve temizlik:
--   select indisvalid from pg_index
--    where indexrelid = 'public.idx_device_telemetry_fuel'::regclass;
--   -- false ise:  drop index concurrently idx_device_telemetry_fuel;
--
-- NOT: geri almak İSTEYECEĞİN bir senaryo bilmiyorum. Kalan indeks aynı
-- tanımı taşıdığı için hiçbir sorgu planı bozulamaz. Bu bölüm "her
-- migration'ın geri dönüşü yazılı olsun" kuralı için var.


-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorguları):
--
--   select count(*) from pg_index
--    where indrelid = 'public.device_telemetry'::regclass;
--   → 1. bölümdeki sayının BİR EKSİĞİ
--
--   select to_regclass('public.idx_device_telemetry_fuel');
--   → NULL
--
--   select to_regclass('public.idx_device_telemetry_vehicle_fuel_pct');
--   → idx_device_telemetry_vehicle_fuel_pct   ⚠️ NULL ÇIKARSA YANLIŞ
--                                                 İNDEKS DÜŞMÜŞ DEMEKTİR
--
--   select pg_size_pretty(pg_indexes_size('public.device_telemetry'::regclass));
--   → öncekinden ~101 MB küçük
--
-- ⚠️ DİSK HEMEN GERİ GELMEYEBİLİR: dosya unlink'i commit'te olur ama
-- dosya sistemi/işletim sistemi seviyesinde alanın görünür şekilde
-- boşalması Supabase panelinde birkaç dakika gecikebilir.
--
-- VERİYE ETKİSİ: SIFIR SATIR değişir. Bu dosya yalnız bir indeks nesnesi
-- düşürür; tablo, kolon, fonksiyon, tetikleyici ve veri aynen kalır.
-- =====================================================================
