-- HAK61 / Galzura Fleet — Migration 109 (TESLİMAT SONUCU + KANIT TASLAĞI)
-- ✅ ÇALIŞTIRILDI 21.09.2026 — ÜÇ KİRACI (HAK61 · Sendigo · galzura-demo)
--    Doğrulama sonucu: `sonuc`+`sebep` kolonu 2 / `teslimat_taslak_dosyalari`
--    tablosu 1 (üçünde de). Yani iki kolon da eklendi, taslak tablosu yaratıldı
--    ve hiçbir kiracıda satır yok — eklenen NOT NULL kolonun varsayılanını
--    yazacağı bir satır zaten yoktu (aşağıdaki ölçüm).
-- =====================================================================
-- Faz C-2: mobil "kanıt bırak" ucu. İki eksik parça ekleniyor.
-- Additive + idempotent; mevcut hiçbir satır silinmez, hiçbir kolon düşürülmez.
-- Supabase SQL Editor'da çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM ÖNCE — CANLI CEVAP (21.09.2026, PostgREST OpenAPI + satır sayımı)
-- ═══════════════════════════════════════════════════════════════════════
--
--   kiracı         teslimatlar  teslimat_fotograflari  sefer_duraklari  seferler
--   HAK61                    0                      0                0        11
--   Sendigo                  0                      0                0         0
--   galzura-demo             0                      0                0         3
--
--   `teslimatlar` üç kiracıda da 18 kolon, `durak_id` VAR (082 uygulanmış),
--   `sonuc` YOK.
--
-- Yani bu migration HİÇBİR KİRACIDA tek bir satıra dokunmuyor: eklenen NOT NULL
-- kolonun varsayılanı yazılacak bir satır yok, eklenen CHECK'lerin doğrulayacağı
-- bir satır yok. Risk veri tarafında SIFIR; risk yalnız şema tarafında ve o da
-- aşağıdaki iki tetikleyici düzeltmesiyle kapatılıyor.
--
-- ═══ 1) NEDEN `sonuc` — "TESLİM EDİLEMEDİ" BİR KANIT TÜRÜDÜR ═══
--
-- Bugün ePOD yalnız BAŞARILI teslimatı tanıyor. Başarısızlık kavramı sistemde
-- var ama BAŞKA BİR EKSENDE: `sefer_duraklari.durum='atlandi'` + `atlama_sebep`
-- (082). O iki gerçek şunu üretiyor:
--
--   · Durak "atlandı" der ve sebebini taşır — ama arkasında İMZA, FOTOĞRAF,
--     KONUM ve AN damgası YOKTUR. Yani bir plan satırının durumu değişmiştir,
--     delil üretilmemiştir.
--   · Teslimat kanıtı delil üretir — ama yalnız "teslim edildi" diyebilir.
--
-- Anlaşmazlıkta sorulan soru tam ortada: "kapıya gittiniz mi, gittiyseniz neden
-- bırakamadınız, bunu neyle kanıtlıyorsunuz?" Bugün bu sorunun kaydı yok.
-- Sektörde de yok sayılmıyor: Onfleet/Track-POD/Bringg üçünde de teslimat
-- sonucu BAŞARILI/BAŞARISIZ ikilisidir ve başarısız olan bir sebep kodu taşır.
--
-- ⚠️ NEDEN `notlar`A YAZILMIYOR: `notlar` serbest metin. "teslim edilemedi mi"
-- sorusunu bir metin alanından LIKE ile cevaplamak, raporu yazım hatasına bağlı
-- hâle getirmek olurdu. Sonuç MAKİNE OKUNUR olmak zorunda — raporlanacak,
-- sayılacak, filtrelenecek.
--
-- ⚠️ NEDEN varsayılan 'teslim': bu kolondan ÖNCE yazılmış her satır, yalnız
-- başarılı teslimatı tanıyan bir kodun ürünüdür. Varsayılan geçmişi olduğu gibi
-- bırakır. (Bugün öyle bir satır zaten yok — ölçüm yukarıda.)
--
-- ═══ 2) NEDEN `sebep` AYRI KOLON, VE NEDEN ÇİFT YÖNLÜ CHECK ═══
--
-- `iptal_at`/`iptal_sebep` ikilisinin (080) aynı ilkesi: sebepsiz bir başarısız
-- teslimat, iz bırakmayan bir "olmadı"dır. CHECK çift yönlü yazıldı:
--   · teslim_edilemedi ⇒ sebep DOLU   (sebepsiz başarısızlık yok)
--   · teslim           ⇒ sebep BOŞ    (başarılı teslimatın "sebebi" olmaz;
--                                      dolu bırakmak iki anlamlı bir satır
--                                      üretir ve rapor onu nasıl sayacağını
--                                      bilemez)
--
-- ═══ 3) 🔴 DEĞİŞMEZLİK TETİKLEYİCİSİ GENİŞLETİLMEK ZORUNDA ═══
--
-- 082 bu kuralı yazılı bıraktı (082:342-347) ve burada AYNEN geçerli:
--
--   "yeni bir kolon eklendiğinde tetikleyici onu SAYMAZSA, o kolon kanıtın
--    DEĞİŞTİRİLEBİLİR tek alanı olur."
--
-- `sonuc` tam da kanıtın ne söylediğini söyleyen alan. Tetikleyiciye
-- eklenmezse, "teslim edilemedi" diye yazılmış bir kanıt sonradan sessizce
-- "teslim edildi"ye çevrilebilirdi — delilin kendisini tersine çeviren bir
-- UPDATE. Gövde 082'dekiyle aynı, iki satır eklendi (plpgsql fonksiyonu kısmi
-- güncellenemez, bu yüzden tümü yeniden yazılıyor).
--
-- ═══ 4) NEDEN AYRI BİR TASLAK TABLOSU — VE NEDEN KANIT TABLOSUNA DOKUNULMADI ═══
--
-- Mobil akış panelin akışının TERSİ ve bu bir tercih değil, telefonun gereği:
--
--   panel : kanıt kaydı açılır → her fotoğraf ayrı istekte ona bağlanır
--   mobil : fotoğraf(lar) çekilir/yüklenir → sonra "teslim ettim" denir
--
-- Şoför kapıda önce fotoğrafı çeker; "teslim ettim" düğmesine bastığı an işin
-- SONUDUR. Panelin sırasını telefona dayatmak, kanıt kaydını fotoğraf
-- yüklenmeden açmak (yani yarım bir delil bırakmak) demekti.
--
-- Bunun için fotoğrafın kanıt YOKKEN duracağı bir yer gerekiyor. ÜÇ YOL VARDI:
--
--   (a) `teslimat_fotograflari.teslimat_id`i NULL'lanabilir yapmak ve satırı
--       sonradan BAĞLAMAK.  → REDDEDİLDİ. `trg_teslimat_foto_degismez` (080)
--       bu tablodaki HER UPDATE'i koşulsuz reddediyor. Tek bir geçişe izin
--       vermek için o koşulsuzluğu delmek gerekirdi; ePOD'un en yüksek sesle
--       yazılmış kuralı bu ve bir uç yüzünden gevşetilmez.
--   (b) Dosyayı Storage'a koyup KAYIT YAZMAMAK, yolu istemciye döndürmek.
--       → REDDEDİLDİ. `lib/upload-core.ts` tam da yetim dosyayı öldürmek için
--       yazıldı ("kaydı yoktur, kimse bulamaz"). Bilerek yetim üretmek onun
--       tersi olurdu.
--   (c) TASLAK için AYRI TABLO.  → SEÇİLDİ.
--
-- Ayrımın kendisi de doğru: **taslak delil değildir.** Henüz bir teslimata
-- bağlanmamış bir fotoğraf neyin kanıtı olduğunu söyleyemez. Bu yüzden taslak
-- satırı DEĞİŞEBİLİR ve SİLİNEBİLİR; kanıt satırı değişemez ve silinemez.
-- İki tabloya ayırmak bu farkı şemada görünür kılıyor.
--
-- Bağlama anında satır `teslimat_fotograflari`na INSERT edilir — yani kanıt
-- tarafında hâlâ YALNIZ INSERT var, tek bir UPDATE yolu açılmadı.
--
-- ⚠️ ÇİFT BAĞLAMA ŞEMADA KAPALI: `teslimat_foto_yol_uq unique (storage_path)`
-- (080) aynı dosyanın ikinci kez kanıta bağlanmasını 23505 ile reddeder. Yani
-- taslak satırı silinmeden kalsa bile aynı fotoğraf iki kanıta giremez.
--
-- ═══ 5) TASLAK NE KADAR YAŞAR ═══
--
-- Bağlananlar bağlandığı anda silinir (uygulama). Bağlanmayanlar — şoför
-- fotoğrafı yükleyip teslimatı bitirmeden vazgeçerse — KALIR ve bu bilinçli:
-- sessizce silmek, şoförün 10 dakika önce çektiği fotoğrafı haber vermeden yok
-- etmek olurdu. Süpürme AYRI bir karar ve AYRI bir cron işi; bu migration onu
-- kurmuyor, yalnız sorulabilir hâle getiriyor (aşağıdaki indeks + DOĞRULAMA
-- bölümündeki sorgu).
--
-- ⚠️ SAKLAMA: taslak tablosu telemetri temizliğine (054/090) DAHİL DEĞİL ve
-- öyle kalmalı — ama kanıt saklama kuralının (080: "kanıt silinmez") kapsamında
-- da değil, çünkü taslak kanıt değil.
--
-- ═══ RLS ═══
-- Kapalı — 066/079/080/081/082 ile tutarlı. Yalnız service-role yazar; yetki
-- uygulama katmanında (şoför yalnız KENDİ seferinin durağına taslak/kanıt
-- bırakır; yönetici kendi kapsamında).
-- =====================================================================

begin;

-- ── 1) TESLİMAT SONUCU ──────────────────────────────────────────────
alter table public.teslimatlar
  add column if not exists sonuc text not null default 'teslim';

alter table public.teslimatlar
  add column if not exists sebep text;

-- CHECK'ler ayrı ve KORUMALI ekleniyor: `add constraint` IF NOT EXISTS
-- desteklemiyor, ikinci koşumda 42710 ile düşerdi (idempotanlık şartı).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.teslimatlar'::regclass
       and conname = 'teslimat_sonuc_gecerli'
  ) then
    alter table public.teslimatlar
      add constraint teslimat_sonuc_gecerli
      check (sonuc in ('teslim', 'teslim_edilemedi'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.teslimatlar'::regclass
       and conname = 'teslimat_sebep_butun'
  ) then
    alter table public.teslimatlar
      add constraint teslimat_sebep_butun
      check (
        (sonuc = 'teslim_edilemedi' and sebep is not null
           and length(btrim(sebep)) between 3 and 300)
        or
        (sonuc = 'teslim' and sebep is null)
      );
  end if;
end
$$;

comment on column public.teslimatlar.sonuc is
  'teslim | teslim_edilemedi. Varsayılan ''teslim'' — bu kolondan önce yazılmış her satır yalnız başarılı teslimatı tanıyan bir kodun ürünüdür. Makine okunur: rapor bunu sayar, notlar alanını değil.';
comment on column public.teslimatlar.sebep is
  'Teslim EDİLEMEDİYSE sebebi (3-300). teslim_edilemedi ⇒ dolu, teslim ⇒ boş (teslimat_sebep_butun). Durağın atlama_sebep''inden farkı: bu, delil kaydının parçasıdır.';

-- ── 2) DEĞİŞMEZLİK TETİKLEYİCİSİ — İKİ YENİ KOLONU DA SAYIYOR ───────
-- 082:342-347'nin kuralı: saymadığı kolon, kanıtın değiştirilebilir tek alanı
-- olur. Gövde 082'dekiyle aynı; `sonuc` ve `sebep` satırları eklendi.
create or replace function public.teslimat_degismez()
returns trigger
language plpgsql
as $$
begin
  if
    new.sefer_id          is distinct from old.sefer_id          or
    new.durak_no          is distinct from old.durak_no          or
    new.durak_id          is distinct from old.durak_id          or
    new.worker_id         is distinct from old.worker_id         or
    new.zone_id           is distinct from old.zone_id           or
    new.alici_ad          is distinct from old.alici_ad          or
    new.notlar            is distinct from old.notlar            or
    new.sonuc             is distinct from old.sonuc             or
    new.sebep             is distinct from old.sebep             or
    new.imza_svg          is distinct from old.imza_svg          or
    new.imza_yol          is distinct from old.imza_yol          or
    new.teslim_at         is distinct from old.teslim_at         or
    new.latitude          is distinct from old.latitude          or
    new.longitude         is distinct from old.longitude         or
    new.konum_dogruluk_m  is distinct from old.konum_dogruluk_m  or
    new.created_at        is distinct from old.created_at        or
    /**
     * 🔴 ÖNCEDEN AÇIK OLAN DELİK — 109'da KAPATILIYOR.
     *
     * ÖLÇÜLDÜ: `iptal_eden` ne 080'de ne 082'de sayılıyordu. Yani
     * `update teslimatlar set iptal_eden='<baska_kisi>'` HK080'e TAKILMIYORDU:
     * "bu kanıtı kim geçersiz ilan etti" sorusunun cevabı sessizce
     * değiştirilebilirdi. `iptal_at`/`iptal_sebep`in yazılabilir olması TASARIM
     * (iptal yolu); `iptal_eden` ise bir AKTÖR damgasıdır ve aktör damgaları
     * bu şemada hiçbir yerde değişmez (`worker_id` de sayılıyor).
     *
     * ⚠️ KOŞULSUZ YAZILAMAZ: `iptalTeslimat` bu alanı null'dan doluya yazıyor.
     * Koşulsuz karşılaştırma İPTAL YOLUNUN KENDİSİNİ kırardı. Kural bu yüzden
     * "bir kez yazılır, sonra donar" biçiminde: alan doluyken değişemez.
     */
    (old.iptal_eden is not null and new.iptal_eden is distinct from old.iptal_eden)
  then
    raise exception
      'teslimat kaniti DEGISTIRILEMEZ (id=%). Yalnizca iptal alanlari guncellenebilir; duzeltme icin YENI bir durak kaydi acin.',
      old.id
      using errcode = 'HK080';
  end if;
  return new;
end
$$;

-- ── 3) KANIT TASLAĞI ────────────────────────────────────────────────
-- Kanıt AÇILMADAN ÖNCE yüklenmiş dosyanın durduğu yer. Delil DEĞİL: bağlanana
-- kadar neyin kanıtı olduğunu söyleyemez (başlık §4).
create table if not exists public.teslimat_taslak_dosyalari (
  id uuid primary key default gen_random_uuid(),

  -- Hangi seferin hangi durağı için yüklendi. Sefer ya da durak giderse
  -- taslağın bağlamı kalmaz — kanıtın tersine, taslak CASCADE ile gider.
  sefer_id uuid not null references public.seferler(id) on delete cascade,
  durak_id uuid not null references public.sefer_duraklari(id) on delete cascade,

  /**
   * Yükleyen. `on delete cascade` — kanıttaki `restrict`in TERSİ ve bilerek:
   * orada silinen şey delildi, burada bağlanmamış bir dosya.
   */
  worker_id uuid not null references public.workers(id) on delete cascade,

  -- 'foto' → teslimat_fotograflari satırı olur
  -- 'imza' → teslimatlar.imza_yol olur (080'in RASTER YEDEK yolu)
  tur text not null check (tur in ('foto', 'imza')),

  -- Storage yolu: {workerId}/{yyyy}/{mm}/{uuid}.{ext} (lib/upload-core.ts).
  -- Kova AYNI: 'teslimat-kaniti' (080'de yaratıldı). İkinci bir kova, aynı
  -- delilin yarısını başka yere koymak olurdu.
  storage_path text not null unique check (length(btrim(storage_path)) > 0),

  -- Fotoğrafın KENDİ anı ve yeri — kanıt damgasından farklı olabilir.
  taken_at timestamptz not null default now(),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  konum_dogruluk_m double precision check (konum_dogruluk_m is null or konum_dogruluk_m >= 0),

  created_at timestamptz not null default now()
);

-- "Bu durakta benim bekleyen taslaklarım" — kanıt yazılırken okunan tek sorgu.
create index if not exists teslimat_taslak_durak_idx
  on public.teslimat_taslak_dosyalari (durak_id, worker_id);
-- "Bağlanmadan kalmış eski taslaklar" — süpürme sorusu (başlık §5).
create index if not exists teslimat_taslak_zaman_idx
  on public.teslimat_taslak_dosyalari (created_at);

comment on table public.teslimat_taslak_dosyalari is
  'Kanıt taslağı (109): kanıt AÇILMADAN önce yüklenmiş fotoğraf/imza dosyası. DELİL DEĞİLDİR — değişebilir ve silinebilir; bağlandığı an teslimat_fotograflari''na INSERT edilir ve orada donar. Kova: teslimat-kaniti.';
comment on column public.teslimat_taslak_dosyalari.tur is
  'foto → teslimat_fotograflari satırı olur · imza → teslimatlar.imza_yol (080 raster yedek) olur.';

commit;

-- Yeni kolonlar ve yeni tablo PostgREST'te hemen görünsün (yoksa ilk çağrı
-- 42703/PGRST204 alır ve uç "109 çalışmamış" der).
notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (ayrı çalıştırın)
--
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='teslimatlar'
--      and column_name in ('sonuc','sebep')
--    order by column_name;
--   → 2 satır:  sebep | text | YES | (null)
--               sonuc | text | NO  | 'teslim'::text
--
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='teslimatlar';
--   → 20   (082 sonrası 18 idi)
--
--   select conname from pg_constraint
--    where conrelid='public.teslimatlar'::regclass
--      and conname in ('teslimat_sonuc_gecerli','teslimat_sebep_butun')
--    order by conname;
--   → 2 satır
--
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='teslimat_taslak_dosyalari';
--   → 11   (id, sefer_id, durak_id, worker_id, tur, storage_path, taken_at,
--           latitude, longitude, konum_dogruluk_m, created_at)
--
--   select count(*) from public.teslimat_taslak_dosyalari;      → 0 beklenir
--   select count(*) from public.teslimatlar where sonuc is null; → 0 beklenir
--
--   select prosrc like '%new.sonuc%'      as sonuc_sayiliyor,
--          prosrc like '%new.sebep%'      as sebep_sayiliyor,
--          prosrc like '%old.iptal_eden%' as iptal_eden_sayiliyor
--     from pg_proc where proname='teslimat_degismez';
--   → t | t | t     (herhangi biri f ise DEĞİŞMEZLİK DELİK — hemen durun)
--
-- DEĞİŞMEZLİĞİ SINAMAK (kanıt satırı varken):
--   update public.teslimatlar set sonuc='teslim' where id='<id>';
--   → HATA HK080 "teslimat kaniti DEGISTIRILEMEZ"      (sonuc gerçekten farklıysa)
--   update public.teslimatlar set iptal_at=now(), iptal_sebep='yanlis adres'
--    where id='<id>';                                   → GEÇER
--
-- SEBEP BÜTÜNLÜĞÜNÜ SINAMAK:
--   insert into public.teslimatlar (sefer_id, worker_id, sonuc)
--   values ('<sefer>', '<worker>', 'teslim_edilemedi');
--   → HATA 23514 "teslimat_sebep_butun"   (sebepsiz başarısızlık yok)
--
-- BAĞLANMADAN KALMIŞ TASLAKLAR (süpürme sorusu, başlık §5):
--   select worker_id, count(*), min(created_at)
--     from public.teslimat_taslak_dosyalari
--    where created_at < now() - interval '7 days'
--    group by worker_id;
--
-- ⚠️ 109 UYGULANMAZSA: mobil "kanıt bırak" ucu 409 `ozellik_kapali`
-- (migration: "109") döner ve SESSİZCE DÜŞMEZ. Panelin kanıt akışı, şoför
-- ekranı ve mevcut fotoğraf ucu AYNEN çalışmaya devam eder — 109 yalnız
-- sonucu/sebebi ve taslak yolunu açar (aynı kademeli düşüş
-- 056/058/077/078/079/080/082'de de var).
-- =====================================================================
