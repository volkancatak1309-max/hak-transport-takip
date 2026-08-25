-- HAK61 / Galzura Fleet — Migration 084 (HAFTALIK AKSİYON PANELİ)
-- =====================================================================
-- "Gölge filo müdürü": sistem her hafta EN FAZLA 5 YAPILACAK İŞ üretir.
-- Gösterge değil AKSİYON; kural tabanlı, yapay zeka DEĞİL; her kalem hangi
-- sayıdan ve hangi eşikten çıktığını taşır. Additive + idempotent; mevcut
-- hiçbir tabloya DOKUNULMAZ. Supabase SQL Editor'da çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM ÖNCE — DÖRT SORU, CANLI CEVAP (25.08.2026, HAK61)
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1) HANGİ SİNYALLER ELİMİZDE — hepsi tarandı ve SAYILDI:
--
--    SİNYAL              CANLI DURUM                         KARAR
--    ─────────────────────────────────────────────────────────────────────
--    güvenlik skoru      haftada 3-4 şoför skorlanıyor;      KULLANILIYOR
--                        2 şoför İKİ ardışık haftada;        (2 pencere)
--                        **0 şoför ÜÇ haftada**
--    yakıt L/100km       30 gün: 22/29 araç ölçülebilir,     KULLANILIYOR
--                        ort 11,4; 7 gün: yalnız 10/29       (30 gün)
--    sessiz araç         ≥24s: 8 · ≥72s: 7 · ≥7g: 6          KULLANILIYOR
--    açık iş emri        0 satır                             KULLANILIYOR
--    belge bitişi        0 satır (worker_documents boş)      KULLANILIYOR
--    periyodik bakım     0 plan                              KULLANILIYOR
--    kapanmamış vardiya  9 (son 7 gün, 100 vardiyada)        KULLANILIYOR
--    rölanti             177 epizod/14 araç, medyan 16,9     KULLANILMIYOR
--                        dk/HAFTA — max 45 dk                (aksiyon değeri yok)
--    açık DTC            0 (cleared_at is null)              KULLANILMIYOR
--                                                            (Dikkat'te zaten var)
--    sefer tamamlanma    11 sefer, 9'u iptal                 KULLANILMIYOR
--                                                            (n çok küçük)
--    mesaj okunmama      `message_reads` TABLOSU YOK,        SİNYAL YOK
--                        `messages` 0 satır
--
--    ⚠️ DÖRT KURAL BUGÜN HAK61'DE 0 KALEM ÜRETİR (belge, bakım, iş emri ve
--    büyük ihtimalle skor). Bu bir kusur DEĞİL: kurallar veri geldiğinde
--    çalışsın diye yazıldı ve her biri "kaç aday tarandı, kaçı eşiği geçti"
--    sayısını `haftalik_aksiyon_turlari.tarama` alanına yazıyor — yani "kural
--    çalışmadı" ile "kural çalıştı, eşiği geçen yok" AYIRT EDİLEBİLİR.
--
-- 2) EŞİK NASIL BELİRLENDİ — SİNYALİN DOĞASINA GÖRE ÜÇ AYRI YOL:
--
--    a) FİLO-GÖRELİ (yakıt). Sabit bir L/100km eşiği yanlış olurdu: filo
--       ortalaması 11,4 ve araç tipine göre değişir. Sapma yüzdesi ÖLÇÜLDÜ:
--         %15 üstü → 5 araç  (5 kalemin TAMAMINI yakıt doldururdu)
--         %25 üstü → 2 araç  ✅ SEÇİLDİ
--         %35 üstü → 1 araç  (gerçek sapmayı kaçırırdı)
--       Pencere 30 GÜN, 7 değil: 7 günde yalnız 10/29 araç ölçülebiliyor
--       (`too_little_fuel` 14 araçta), 30 günde 22/29.
--
--    b) SABİT (sessiz araç, belge, bakım, iş emri). Fiziksel ya da yasal
--       anlamı olan eşik. Sessiz araçta 72 SAAT: Dikkat panosu 24 saatte
--       "bak" diyor, haftalık panel 3 günde "cihaza bakılmalı" diyor —
--       AYNI SİNYAL, FARKLI İŞ (bkz. §4). Ölçüm: ≥24s 8 araç, ≥72s 7 araç.
--
--    c) TREND (skor). Mutlak eşik bir insanı sabit bir çizgiye göre yargılar;
--       trend onu KENDİSİYLE kıyaslar. ÖLÇÜLDÜ: üç ardışık hafta skoru olan
--       şoför SIFIR — "3 haftadır düşüyor" kuralı bugün ÖLÜ olurdu. Kural
--       İKİ ardışık pencere + en az 10 puan düşüş olarak kuruldu; üç pencere
--       varsa gerekçe onu da yazar.
--
-- 3) ÖNCELİKLENDİRME — PUAN, ÜÇ EKSEN. En yüksek 5 kalem gösterilir.
--       taban    : kuralın türsel ağırlığı (yasal/güvenlik > para > düzen)
--       büyüklük : sapmanın kendisi (yüzde, gün, puan)
--       kesinlik : ölçüm ne kadar sağlam (kapsama, örneklem)
--    ⚠️ ÇEŞİTLİLİK KURALI — ölçümle gerekti: 7 sessiz araç var ve saf puan
--    sıralaması 5 kalemin TAMAMINI sessiz araçla doldururdu. Kural başına en
--    fazla 2 kalem; kalanlar "N benzer kalem daha" diye toplanır.
--
-- 4) DİKKAT PANOSU (058) İLE İLİŞKİ — ÇAKIŞMIYOR, KATMANLI:
--       Dikkat  = ANLIK. "Bugün ne var." 19 çeşit, canlıdan hesaplanıyor,
--                 kalıcı kaydı yok (yalnız erteleme). Bugün doğru, yarın yok.
--       Haftalık= YORUM. "Bu hafta ne yap." Trend ve filo-göreli; KALICI
--                 kayıt, çünkü sorulan soru "3 hafta önce ne demişti, düzeldi mi".
--    Aynı sinyal iki yerdeyse haftalık panel DAHA YÜKSEK eşik kullanır ve
--    FARKLI bir iş önerir (sessiz araç: 24s "bak" ↔ 72s "cihaza bakılmalı").
--
--    ⚠️ `action_snoozes` GENİŞLETİLMEDİ. O tablonun `item_source` CHECK'i üç
--    değerli ('alarm','attention','leave') ve modeli ERTELEME: "şimdi değil,
--    sonra". Haftalık aksiyonun kapatması bir KARARDIR: "yaptım" (iş bitti) ya
--    da "ilgisiz" (bu kural bu özne için geçersiz). İkisini aynı tabloya
--    sıkıştırmak, iki farklı anlamı tek kolonun altına saklamak olurdu.
--
-- ═══ NEDEN AYRI SUSTURMA TABLOSU YOK ═══
--
-- "İlgisiz" bir SÜRE susturuyor ve bu süre `haftalik_aksiyonlar`dan TÜRETİLİR:
-- aynı kural + aynı özne için EN SON 'ilgisiz' kapatmanın üstünden
-- HAFTALIK_SUSTURMA_GUN geçmediyse kalem üretilmez (lib/haftalik-aksiyon.ts).
-- Ayrı tablo, aynı gerçeğin ikinci kopyası olurdu ve ikisi ayrışabilirdi.
--
-- ═══ NEDEN "TUR" VE "AKSİYON" AYRI TABLOLAR ═══
--
-- Turun kendi gerçekleri var: ne zaman koştu, kaç aday tarandı, bildirim
-- gitti mi. Bunları her aksiyon satırında tekrarlamak, 5 satıra aynı cevabı
-- beş kez yazmak olurdu — ve "bu hafta hiç aksiyon çıkmadı" hâli hiç
-- kaydedilemezdi (0 satır = "koştu ama temiz" ile "hiç koşmadı" ayrılmaz).
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar; okuma
-- yönetici kapısının ardından (requireFleetView).
-- =====================================================================

begin;

-- ── 1) HAFTALIK TUR ─────────────────────────────────────────────────
create table if not exists public.haftalik_aksiyon_turlari (
  id uuid primary key default gen_random_uuid(),

  /**
   * Turun kapsadığı haftanın PAZARTESİSİ (kiracı takvimi, Europe/Vienna).
   *
   * ⚠️ `date`, `timestamptz` DEĞİL: hafta bir GÜN birimidir ve turun koştuğu
   * AN ayrı alanda (`uretildi_at`). İkisini tek alana sıkıştırmak "hangi
   * haftanın turu" sorusunu saat dilimi sorusuna çevirirdi (066'daki
   * `seferler.tarih` ile aynı gerekçe).
   *
   * TEKİL: bir haftanın tek turu olur. Cron iki kez koşarsa ikinci koşum
   * satır YAZMAZ ve bunu SÖYLER — "günde tam 1" (bakim-alerts) deseninin
   * haftalık karşılığı. Yeniden üretmek isteyen önce turu siler.
   */
  hafta_basi date not null,

  /** Turun GERÇEKTEN koştuğu an. */
  uretildi_at timestamptz not null default now(),

  /**
   * TARAMA SAYAÇLARI — "kural çalışmadı" ile "kural çalıştı, eşiği geçen yok"
   * ayrımı BURADA yaşıyor.
   *
   * Şekli: {"kural_adi": {"aday": 29, "gecen": 2, "esik": "%25"}, …}
   * ⚠️ Bu alan olmadan boş bir hafta sessiz bir arızadan ayırt edilemezdi —
   * ölçüldü ki dört kural HAK61'de bugün 0 kalem üretiyor (§1) ve bunun
   * "veri yok" olduğunu ancak bu sayaç söyleyebilir.
   */
  tarama jsonb not null default '{}'::jsonb,

  /** Üretilen (kaydedilen) aksiyon sayısı — en fazla 5. */
  aksiyon_sayisi integer not null default 0 check (aksiyon_sayisi >= 0),
  /** Eşiği geçen AMA 5 sınırına/çeşitliliğe takılan kalem sayısı. */
  elenen_sayisi integer not null default 0 check (elenen_sayisi >= 0),

  /**
   * BİLDİRİM SONUCU — kaç yöneticiye, kaç cihaza gitti.
   *
   * ⚠️ `push.ts` bilerek `void` döndürüyor ("bildirim mesajı düşürmez").
   * Burada SONUÇ kaydediliyor çünkü haftalık panel "bildirim gitti mi"
   * sorusunu cevaplayabilmeli: ölçüldü ki HAK61'de bugün push jetonu SIFIR,
   * yani gönderim yolu çalışsa bile hiçbir cihaz çalmaz. Bunu "gitti"
   * saymak yalan olurdu.
   *
   * 🔴 NULL = DENENMEDİ. `not null default 0` ilk yazımdaydı ve QA'da yakalandı:
   * turu cron DIŞINDA üreten bir yol (doğrudan `haftalikTuruUret`) bildirim
   * göndermiyor, ama satır 0/0 ile açıldığı için panel "kayıtlı cihaz yok"
   * yazıyordu — DENENMEMİŞ gönderimi BAŞARISIZ gönderim gibi göstermek.
   * Aynı hata sınıfı: "sessiz eksik". Üç durum ayrı: NULL denenmedi ·
   * 0 denendi/cihaz yok · >0 gitti.
   */
  bildirim_alici integer check (bildirim_alici >= 0),
  bildirim_jeton integer check (bildirim_jeton >= 0),
  bildirim_hata text,

  created_at timestamptz not null default now(),

  constraint haftalik_tur_hafta_uq unique (hafta_basi),
  -- Hafta PAZARTESİ olmalı: 0=Pazar … 1=Pazartesi (ISO değil, Postgres `dow`).
  constraint haftalik_tur_pazartesi check (extract(dow from hafta_basi) = 1)
);

create index if not exists idx_haftalik_tur_hafta
  on public.haftalik_aksiyon_turlari (hafta_basi desc);

comment on table public.haftalik_aksiyon_turlari is
  'Haftalık aksiyon üretiminin TURU (084): ne zaman koştu, ne tarandı, bildirim gitti mi. Boş hafta da kayıtlıdır — "koştu ama temiz" ile "hiç koşmadı" ayrılabilsin.';
comment on column public.haftalik_aksiyon_turlari.tarama is
  'Kural başına {aday, gecen, esik} sayaçları. "Kural çalışmadı" ile "eşiği geçen yok" ayrımının TEK kaynağı.';

-- ── 2) AKSİYON ──────────────────────────────────────────────────────
create table if not exists public.haftalik_aksiyonlar (
  id uuid primary key default gen_random_uuid(),

  tur_id uuid not null references public.haftalik_aksiyon_turlari(id) on delete cascade,

  /**
   * KURAL KİMLİĞİ — kod tarafındaki kural adı (`lib/haftalik-aksiyon.ts`).
   *
   * ⚠️ CHECK ile KISITLANMADI, bilerek. Yeni bir kural eklemek bir migration
   * gerektirmemeli; kural kümesi kodda yaşıyor ve orada tek kaynak
   * (`KURALLAR`). Şemaya CHECK koymak, her yeni kuralı üç kiracıda SQL
   * çalıştırmaya bağlardı — 063'ün `category` kararında öğrenilen ders.
   */
  kural text not null check (length(btrim(kural)) between 1 and 60),

  /** Aksiyonun ÖZNESİ. Filo geneli kalemlerde ikisi de null. */
  worker_id uuid references public.workers(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete cascade,

  /**
   * ÖNCELİK PUANI — büyük olan üstte. Hesap kodda (§3), burada SONUÇ duruyor.
   * Saklanıyor çünkü "geçen hafta bu neden 1. sıradaydı" sorusu sonradan
   * cevaplanabilmeli; yeniden hesaplamak o günün verisini gerektirirdi.
   */
  oncelik integer not null check (oncelik between 0 and 10000),

  /** Kullanıcının okuduğu tek cümle — YAPILACAK İŞ. */
  baslik text not null check (length(btrim(baslik)) between 1 and 200),

  /**
   * GEREKÇE — hangi sayıdan çıktı. "Skoru 68'den 41'e düştü, iki hafta üst
   * üste." Başlık İŞİ söyler, gerekçe SEBEBİ.
   */
  gerekce text not null check (length(btrim(gerekce)) between 1 and 500),

  /**
   * KANIT — açıklanabilirliğin makine tarafı.
   *
   * Şekli kurala göre değişir ama ÜÇ ALAN HER ZAMAN VAR:
   *   {"olculen": 16.3, "esik": 14.25, "birim": "L/100km", …}
   * Ekran bunu "16,3 ölçüldü · eşik 14,25 L/100km" diye basar; kullanıcı
   * kalemin nereden çıktığını GÖREBİLİR. Görmezse bu bir kara kutudur ve
   * kural tabanlı olmasının hiçbir anlamı kalmaz.
   */
  kanit jsonb not null,

  /**
   * HEDEF EKRAN — tıklayınca nereye gidilecek (şoför kartı, araç detayı…).
   * Göreli yol; null = hedef yok (filo geneli kalem).
   */
  hedef_yol text check (hedef_yol is null or hedef_yol ~ '^/[A-Za-z0-9/_-]*$'),

  /**
   * DURUM.
   *   acik     → yapılacak
   *   yapildi  → iş bitti (o haftaya ait, kalıcı)
   *   ilgisiz  → bu kural bu özne için geçersiz → kuralı BİR SÜRE susturur
   *
   * ⚠️ SİLME YOK. Kapatılan kalem listeden düşer ama KAYITTA kalır: haftalık
   * panelin vaadi "3 hafta önce ne demişti, düzeldi mi" ve silinen bir kalem
   * o soruyu cevaplayamaz.
   */
  durum text not null default 'acik' check (durum in ('acik','yapildi','ilgisiz')),
  kapatan uuid references public.workers(id) on delete set null,
  kapatildi_at timestamptz,
  /** "İlgisiz" derken yazılan serbest not (opsiyonel). */
  kapatma_notu text check (kapatma_notu is null or length(btrim(kapatma_notu)) between 1 and 300),

  created_at timestamptz not null default now(),

  -- Kapatıldıysa ANI da vardır; kapatan kişi silinmiş olabilir (set null).
  constraint haftalik_aksiyon_kapanis_butun
    check ((durum = 'acik' and kapatildi_at is null) or (durum <> 'acik' and kapatildi_at is not null))
);

/**
 * BİR TURDA AYNI KURAL + AYNI ÖZNE İKİ KEZ OLAMAZ.
 *
 * `coalesce` ile ifade indeksi: özne şoför, araç ya da FİLO GENELİ (ikisi de
 * null) olabiliyor ve düz bir `unique (tur_id, kural, worker_id, vehicle_id)`
 * NULL'ları farklı sayacağı için filo geneli kalemi iki kez yazmayı serbest
 * bırakırdı.
 */
create unique index if not exists haftalik_aksiyon_tekil
  on public.haftalik_aksiyonlar (
    tur_id,
    kural,
    coalesce(worker_id, vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Panelin birincil okuması: turun kalemleri, önceliğe göre.
create index if not exists idx_haftalik_aksiyon_tur
  on public.haftalik_aksiyonlar (tur_id, oncelik desc);

/**
 * SUSTURMA SORGUSU — "bu kural bu özne için son ne zaman 'ilgisiz' kapandı".
 * Kısmi indeks: açık ve yapılmış kalemler taranmaz.
 */
create index if not exists idx_haftalik_aksiyon_ilgisiz
  on public.haftalik_aksiyonlar (kural, kapatildi_at desc)
  where durum = 'ilgisiz';

comment on table public.haftalik_aksiyonlar is
  'Haftalık üretilen AKSİYONLAR (084). Gösterge değil yapılacak iş; her satır hangi sayıdan/eşikten çıktığını `kanit` alanında taşır. Kapatılan kalem SİLİNMEZ — geçmiş sorusu ("düzeldi mi") ona bağlı.';
comment on column public.haftalik_aksiyonlar.kanit is
  'Açıklanabilirlik: {olculen, esik, birim, …}. Ekran bunu okunur cümleye çevirir. Bu alan olmadan kural tabanlı olmanın anlamı kalmaz.';
comment on column public.haftalik_aksiyonlar.durum is
  'acik | yapildi | ilgisiz. "ilgisiz" aynı kural+özne için üretimi BİR SÜRE susturur (süre kodda: HAFTALIK_SUSTURMA_GUN).';

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (ayrı çalıştırın)
--
--   select count(*) from public.haftalik_aksiyon_turlari;   → 0
--   select count(*) from public.haftalik_aksiyonlar;        → 0
--
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='haftalik_aksiyon_turlari';  → 10
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='haftalik_aksiyonlar';       → 15
--
--   select indexname from pg_indexes where schemaname='public'
--    and tablename in ('haftalik_aksiyon_turlari','haftalik_aksiyonlar')
--    order by 1;
--   → haftalik_aksiyon_tekil, haftalik_aksiyon_turlari_pkey,
--     haftalik_aksiyonlar_pkey, haftalik_tur_hafta_uq,
--     idx_haftalik_aksiyon_ilgisiz, idx_haftalik_aksiyon_tur,
--     idx_haftalik_tur_hafta
--
-- KISITLARI SINAMAK (satır yazmadan):
--   insert into public.haftalik_aksiyon_turlari (hafta_basi) values (current_date + 1);
--   → PAZARTESİ değilse HATA: haftalik_tur_pazartesi
--
--   insert into public.haftalik_aksiyonlar (…, durum, kapatildi_at)
--     values (…, 'yapildi', null);
--   → HATA: haftalik_aksiyon_kapanis_butun
--
-- ⚠️ 084 UYGULANMAZSA: haftalık panel KAPALI kalır. Yönetici ekranı "bu
-- kurulumda kapalı" der, cron 503 döner, Dikkat panosu ve diğer her şey
-- normal çalışır (aynı kademeli düşüş 056/058/077/078/079/080/082/083'te de var).
--
-- ⚠️ CRON KAYDI: haftalık üretim `POST /api/cron/haftalik-aksiyon` ile
-- tetikleniyor — dış zamanlayıcıya HAFTADA BİR kayıt eklenmeli
-- (bkz. docs/CRON-KAYITLARI.md). Kayıt kurulmazsa panel boş kalır; sessizce
-- değil: ekran "bu hafta için tur üretilmemiş" der.
-- =====================================================================
