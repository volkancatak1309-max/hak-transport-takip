-- HAK61 / Galzura Fleet — Migration 082 (ÇOK DURAKLI SEFER)
-- =====================================================================
-- Sefer artık TEK hedefli değil: sıralı bir DURAK LİSTESİ taşıyor. Additive +
-- idempotent; hiçbir satır silinmez, hiçbir kolon düşürülmez. Supabase SQL
-- Editor'da çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM ÖNCE — DÖRT SORU, CANLI CEVAP (25.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1) MEVCUT `seferler.zone_id` NASIL TAŞINACAK
--    ÖLÇÜLDÜ (PostgREST, üç kiracı):
--      · HAK61   : 11 sefer — `zone_id` DOLU olan **0**, `vehicle_id` dolu 0,
--                  `vardi_at` dolu 0. teslimatlar 0, takip linkleri 0.
--      · Sendigo : 0 sefer, 0 geofence.
--      · galzura-demo: service anahtarı yok (kasıtlı, bkz. proje notları);
--                  şema 081 hizasında, veri ölçülemedi.
--    Yani geriye dönük taşıma HAK61 ve Sendigo'da **hiçbir satıra dokunmaz**.
--    Yine de yazıldı: galzura ve ileride açılacak kiracılar için doğru olmak
--    zorunda. Kural — `zone_id` DOLU olan her sefer 1 numaralı durağını alır;
--    `zone_id` BOŞ olan sefer durak ALMAZ. Boş hedefli bir sefere isimsiz bir
--    yer tutucu durak açmak, olmayan bir veriyi uydurmak olurdu.
--
-- 2) SERBEST ADRES Mİ, HER DURAK BİR BÖLGE Mİ — SEKTÖR NE YAPIYOR
--    Ölçüldü (25.08.2026, üretici belgeleri):
--      · Samsara — durak konumu İKİ biçimde verilir: kayıtlı **Address**
--        (kendi geofence'i, varsayılan 250 m, özelleştirilebilir) ya da
--        **singleUseLocation** (`address` + `latitude` + `longitude`, dairesel
--        geofence, varsayılan 300 m, `radiusMeters` ile geçilebilir). Samsara
--        singleUseLocation için JEOKODLAMA YAPMAZ: koordinatı çağıran verir.
--      · Onfleet — `destination.address`; `unparsed` verilirse otomatik
--        jeokodlanır, `[lng,lat]` verilirse jeokodlama ATLANIR.
--      · Routific — `location.coords` yoksa `location.address` jeokodlanır.
--    Üçünde de ortak: hedef ya KAYITLI bir yer ya SERBEST bir yer, ve serbest
--    yerde koordinat verilebiliyorsa jeokodlama atlanıyor. Model buna göre:
--    her durak `zone_id` (kayıtlı bölge) VEYA serbest `adres` + isteğe bağlı
--    `latitude/longitude` + `yaricap_m` taşır.
--
-- 3) JEOKODLAMA GEREKİYOR MU — HANGİ SERVİS, MALİYET NE
--    ÖLÇÜLDÜ: depoda jeokodlama YOK (`grep` → Nominatim/Mapbox/Google/HERE
--    çağrısı sıfır; docs/MOBIL-KESIF.md:2331 aynı şeyi söylüyor). Bu turda da
--    EKLENMİYOR. Gerekçe üç ölçüm:
--      a) Nominatim'in kullanım politikası bu ürünü ADIYLA dışarıda bırakıyor:
--         "package/vehicle tracking applications … must run their own service"
--         + kamuya açık uçta saniyede 1 istek tavanı. Yani meşru yol kendi
--         sunucumuzu işletmek — bir jeokodlama sunucusu bu turun konusu değil.
--      b) Ticari servis maliyeti (1.000 istek): Google 5,00 $ · HERE 0,83 $ ·
--         Mapbox 0,75 $ · LocationIQ 0,49 $. Ücretsiz kademe HERE 250k/ay,
--         Mapbox 100k/ay. Günde 80 durak × 30 araç ≈ 72k/ay → ücretsiz
--         kademeye sığar ama üçüncü tarafa YENİ bir dış bağımlılık ve her
--         kiracıya ayrı anahtar demek.
--      c) Gerek YOK: koordinat zaten haritadan tıklanarak alınıyor
--         (`components/GeofencePickerMap.tsx` bugün bölge merkezi için tam
--         bunu yapıyor) ve Samsara'nın singleUseLocation'ı da koordinatı
--         çağırandan istiyor. Adres bir ETİKET, koordinat bir ÖLÇÜMDÜR.
--    ⚠️ ŞEMA JEOKODLAMAYA HAZIR: `adres` dolu + `latitude/longitude` boş bir
--    durak BUGÜN meşrudur (otomatik varış çalışmaz, elle işaretlenir). Bir gün
--    jeokodlama eklenirse o satırların koordinatını doldurur — ŞEMA DEĞİŞMEZ.
--
-- 4) 070 VARIŞ KÖPRÜSÜ DURAK EKSENİNE NASIL TAŞINIR
--    070 bugün `zone_visits` okuyup `seferler.vardi_at` damgalıyor. Aynı üç
--    kural (bölge eşleşmesi · seferin günü ve açılışından sonra · VARDİYA
--    kimlik kontrolü) durak eksenine taşınıyor:
--      · `zone_id`li durak → `zone_visits` üzerinden (motor aynen kullanılır,
--        `zone_visits`e TEK BİR SATIR yazılmaz).
--      · koordinatlı durak → flespi turunun BELLEKTEKİ noktalarıyla dairesel
--        test. Ek sorgu YOK; noktalar tur içinde zaten çekiliyor.
--    `seferler.vardi_at` ANLAMINI KORUYOR: seferin İLK varışı. Durak listesi
--    olan seferde ilk durağın varışı onu da damgalar; durak listesi olmayan
--    seferde eski `zone_id` yolu aynen çalışır (geriye uyum).
--
-- ═══ NEDEN AYRI TABLO, `seferler`e KOLON DEĞİL ═══
--
-- Durak sayısı 1 değil N (son-mil dağıtımda günde 30-80). Kolona sığmaz;
-- jsonb'ye koymak ise `assignments` (006) hatasının tekrarı olurdu — o tablo
-- durakları `stops jsonb` tutuyordu ve canlıda 0 satırla öldü. jsonb'de durak
-- durumu güncellenemez (tüm diziyi yeniden yazmak gerekir, iki şoför yarışır),
-- durağa YABANCI ANAHTAR verilemez (teslimat kanıtı bağlanamaz) ve "bugün kaç
-- durak bekliyor" sorusu indekslenemez.
--
-- ═══ "DURAK" KELİMESİ İKİ ANLAMDA KULLANILIYOR — KARIŞTIRMAYIN ═══
--
-- `/api/mobile/vehicles/[id]/duraklar` GPS'ten TÜRETİLMİŞ durakları döndürür
-- (araç nerede kaç dakika durdu — `lib/metrics-trips.ts`). Bu tablo ise
-- PLANLANMIŞ duraklardır: yönetici yazar, şoför ilerletir. İkisi ayrı gerçek;
-- bu tablo o uca ne yazar ne okur.
--
-- ═══ RLS ═══
-- Kapalı — 066/079/080/081 ile tutarlı. Yalnız service-role yazar; yetki
-- uygulama katmanında (şoför yalnız KENDİ seferinin durağını ilerletir).
-- =====================================================================

begin;

-- ── 1) DURAK ────────────────────────────────────────────────────────
create table if not exists public.sefer_duraklari (
  id uuid primary key default gen_random_uuid(),

  -- Durak seferin parçasıdır; sefer giderse durağın bağlamı kalmaz.
  sefer_id uuid not null references public.seferler(id) on delete cascade,

  /**
   * SIRA — şoförün göreceği düzen. 1'den başlar, boşluksuz tutulur (yeniden
   * sıralama tüm satırları yeniden numaralar).
   */
  sira smallint not null check (sira between 1 and 999),

  /**
   * DURAĞIN ADI — ZORUNLU ve tek zorunlu insan alanı.
   *
   * ⚠️ Bölge seçilse bile ad AYRI tutuluyor, `geofences.name`den her okumada
   * türetilmiyor: ad seferin yazıldığı ANIN anlık görüntüsüdür. Bölge yarın
   * yeniden adlandırılırsa ya da silinirse ("Metzgerei Huber" → "Müşteri 12"),
   * dün yapılan seferin kaydı "Metzgerei Huber" demeye devam etmeli.
   * `zone_visits.worker_id`in donduruluş gerekçesiyle aynı ilke.
   */
  ad text not null check (length(btrim(ad)) between 1 and 120),

  -- ── HEDEF: İKİ BİÇİM (Samsara Address / singleUseLocation ayrımı) ──
  /**
   * A) KAYITLI BÖLGE. Doluysa varış `zone_visits` motorundan gelir ve
   * yarıçap bölgenin kendi `radius_m`sidir (`yaricap_m` yok sayılır).
   *
   * ⚠️ `on delete set null` — bölge silinirse durak KAYBOLMAZ, hedefi boşalır.
   * Bu yüzden "hedef mutlaka dolu olmalı" diye bir CHECK KONMADI: öyle bir
   * kısıt, bölge silme işlemini (ON DELETE SET NULL bir UPDATE'tir ve CHECK
   * denetlenir) hata ile düşürürdü. `seferler.zone_id` ile aynı duruş.
   */
  zone_id uuid references public.geofences(id) on delete set null,

  /**
   * B) SERBEST HEDEF. `adres` bir ETİKETTİR (jeokodlanmaz, bkz. başlık §3);
   * ölçüm yapan şey koordinattır. İkisi de opsiyonel:
   *   · adres + koordinat → otomatik varış ÇALIŞIR
   *   · yalnız adres      → otomatik varış YOK, şoför elle işaretler
   * İkinci hâl bilerek meşru: 30 durağı elle haritadan tıklatmak yerine
   * adresleri yazıp yola çıkmak gerçek bir kullanım.
   */
  adres text check (adres is null or length(btrim(adres)) between 1 and 300),
  latitude  double precision check (latitude  is null or latitude  between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),

  /**
   * Serbest hedefin varış yarıçapı. Sektör ölçüsü: Samsara kayıtlı adreste
   * 250 m, tek kullanımlık konumda 300 m varsayılan. Son-mil dağıtımda 250 m
   * komşu sokağı da kapsıyor; varsayılan 150 m seçildi. Alt sınır 50 m —
   * altında GPS gürültüsü (tipik ±10-30 m, tünel/kanyon daha kötü) ölçümün
   * kendisinden büyük olur ve varış rastgele düşer.
   * `zone_id` doluysa bu alan KULLANILMAZ.
   */
  yaricap_m integer not null default 150 check (yaricap_m between 50 and 5000),

  -- ── PLAN ────────────────────────────────────────────────────────────
  /**
   * ZAMAN PENCERESİ — `time`, `timestamptz` DEĞİL.
   * Sefer bir GÜN birimidir (066). Pencere o günün saat aralığıdır; tam
   * damgalı bir alan, olmayan bir kesinlik vaat eder ve gün sınırı sorusunu
   * her okumada yeniden doğururdu. Biri boş olabilir: "12:00'dan önce" da
   * "14:00'ten sonra" da gerçek bir müşteri kısıtıdır.
   */
  pencere_bas time,
  pencere_bit time,

  -- Durakta geçmesi beklenen süre (dk). Rota planlaması için değil, şoförün
  -- günü okuyabilmesi için — bu depoda rota motoru YOK ve bu alan onu ima
  -- etmiyor.
  tahmini_sure_dk smallint check (tahmini_sure_dk is null or tahmini_sure_dk between 1 and 1440),

  notlar text check (notlar is null or length(notlar) <= 500),

  -- ── DURUM ÇİZGİSİ ───────────────────────────────────────────────────
  /**
   * bekliyor → varildi → tamamlandi   (+ atlandi: SEBEBİYLE)
   *
   * ⚠️ SEFERİN durum çizgisinden (atandi/kabul/yolda/tamamlandi/iptal) AYRI ve
   * ona bağlı DEĞİL. Sefer "yolda" iken duraklar tek tek ilerler; seferi
   * kapatmak şoförün ayrı bir eylemidir (066 kararı korunuyor).
   *
   * `atlandi` bir başarısızlık değil, GERÇEK bir sonuçtur: kapalı dükkân,
   * ulaşılamayan alıcı, yanlış adres. Sebepsiz atlama, iz bırakmayan bir
   * "yapmadım" olurdu — CHECK sebebi zorunlu kılıyor.
   */
  durum text not null default 'bekliyor'
    check (durum in ('bekliyor','varildi','tamamlandi','atlandi')),

  atlama_sebep text check (atlama_sebep is null or length(btrim(atlama_sebep)) between 3 and 300),
  constraint sefer_durak_atlama_butun
    check (durum <> 'atlandi' or atlama_sebep is not null),

  varildi_at    timestamptz,
  tamamlandi_at timestamptz,
  atlandi_at    timestamptz,

  /**
   * VARIŞI KİM DAMGALADI.
   *
   * 070'in ilkesi burada da geçerli ama BİR ADIM ÖTEYE gidiyor: orada "vardı"
   * bir durum değil bilgi damgasıydı, çünkü şoförün basmadığı bir adım durum
   * çizgisine giremezdi. Durakta ise "varıldı" GERÇEK bir adım ve hem sistem
   * hem şoför yazabiliyor. O yüzden KAYNAK kayda geçiyor: "sistem mi gördü,
   * şoför mü söyledi" sorusu sonradan cevaplanamaz olmamalı.
   */
  varis_kaynak text check (varis_kaynak is null or varis_kaynak in ('sofor','otomatik')),

  created_at timestamptz not null default now(),

  constraint sefer_durak_pencere_sira
    check (pencere_bas is null or pencere_bit is null or pencere_bas <= pencere_bit),

  /**
   * SIRA SEFER İÇİNDE TEKİL — ama ERTELENMİŞ.
   *
   * ⚠️ `deferrable initially deferred` ZORUNLU: yeniden sıralama, iki durağın
   * numarasını takas eder. Ertelenmemiş bir tekillikte tek bir toplu UPDATE
   * bile satır satır denetlendiği için ARADA çakışır ve reddedilir; çözüm
   * "önce geçici numaraya taşı" gibi bir hile olurdu. Ertelenmişte denetim
   * COMMIT'te yapılır ve tek ifade sorunsuz geçer.
   *
   * ⚠️ BEDELİ: ertelenmiş bir tekil kısıt `ON CONFLICT` hakemi OLAMAZ
   * (`upsert(onConflict:"sefer_id,sira")` → 42P10). Yeniden sıralama zaten
   * upsert kullanmıyor: aşağıdaki `sefer_duraklari_sirala()` fonksiyonu tek
   * `update` ifadesiyle yazıyor — gerekçesi o fonksiyonun başlığında.
   */
  constraint sefer_durak_sira_uq unique (sefer_id, sira) deferrable initially deferred
);

-- Şoförün ve panelin birincil okuması: seferin durakları, sırasıyla.
create index if not exists idx_sefer_durak_sefer
  on public.sefer_duraklari (sefer_id, sira);

-- VARIŞ KÖPRÜSÜNÜN okuması: yalnız BEKLEYEN duraklar. Kapanmış/atlanmış
-- satırlar indekse hiç girmez — köprü her turda koşuyor, tarama dar kalmalı.
create index if not exists idx_sefer_durak_bekleyen
  on public.sefer_duraklari (sefer_id)
  where durum = 'bekliyor';

/**
 * YENİDEN SIRALAMA — TEK İFADE, VERİTABANINDA.
 *
 * ═══ NEDEN FONKSİYON, PostgREST upsert'i DEĞİL ═══
 *
 * ÖLÇÜLDÜ (25.08.2026, QA yığınında): supabase-js `upsert` çağrısı yalnız
 * `id`+`sira` gövdesiyle **23502 ile düşüyor** — "null value in column
 * `sefer_id`". Sebep PostgREST'in upsert'i INSERT olarak kurması ve eksik
 * kolonları NULL'la doldurması; çakışma çözülse bile NOT NULL denetimi önce
 * çalışıyor. Tek çıkış yolu TAM SATIR göndermekti ve o da EŞZAMANLI DURUM
 * DEĞİŞİKLİĞİNİ EZERDİ: yönetici sıralarken şoför bir durağı "tamamlandı"
 * yaparsa, okunmuş eski `durum` geri yazılır ve şoförün eylemi SİLİNİRDİ.
 *
 * Bu fonksiyon yalnız `sira` kolonuna dokunuyor. Tek `update` ifadesi olduğu
 * için `sefer_durak_sira_uq` (ertelenmiş) COMMIT'te bir kez denetleniyor —
 * takas (1↔3) sorunsuz geçiyor.
 *
 * ⚠️ `p_sefer` KAPI DEĞİL, EMNİYET KİLİDİ: kimlik denetimi uygulama
 * katmanında (app/actions/duraklar.ts). Buradaki `d.sefer_id = p_sefer`
 * koşulu, yanlış seferin kimliklerinin sızmasını imkânsız kılıyor.
 *
 * ⚠️ EKSİK LİSTE SESSİZ KALMAZ: dizide adı geçmeyen durak eski numarasında
 * kalır ve tekillik ihlali doğar (23505). Uygulama zaten TAM liste şartı
 * koyuyor; bu, o şartın veritabanındaki karşılığı.
 */
create or replace function public.sefer_duraklari_sirala(p_sefer uuid, p_ids uuid[])
returns integer
language plpgsql
as $$
declare
  v_etkilenen integer;
begin
  update public.sefer_duraklari d
     set sira = x.yeni
    from (
      select t.id, t.ord::smallint as yeni
        from unnest(p_ids) with ordinality as t(id, ord)
    ) x
   where d.id = x.id
     and d.sefer_id = p_sefer
     and d.sira is distinct from x.yeni;
  get diagnostics v_etkilenen = row_count;
  return v_etkilenen;
end
$$;

comment on function public.sefer_duraklari_sirala(uuid, uuid[]) is
  'Durakları verilen kimlik sırasına göre 1..N numaralar. TEK ifade — ertelenmiş tekillik takasa izin verir. Yalnız `sira` kolonuna dokunur (eşzamanlı durum değişikliği ezilmez).';

comment on table public.sefer_duraklari is
  'Seferin PLANLANMIŞ durakları (082). Sıralı liste; hedef ya kayıtlı bölge (zone_id) ya serbest adres+koordinat. GPS''ten türetilen duraklarla (metrics-trips) ilgisi YOKTUR.';
comment on column public.sefer_duraklari.ad is
  'Durağın adı — bölge seçilse bile AYRI tutulur: seferin yazıldığı anın anlık görüntüsü, bölge yeniden adlandırılsa/silinse bile doğru kalır.';
comment on column public.sefer_duraklari.yaricap_m is
  'Serbest hedefin varış yarıçapı (m). zone_id doluysa KULLANILMAZ — o durumda bölgenin kendi radius_m''si geçerlidir.';
comment on column public.sefer_duraklari.varis_kaynak is
  'Varışı kim damgaladı: sofor (elle) | otomatik (telemetri/zone_visits). null = henüz varılmadı.';

-- ── 2) TESLİMAT KANITI DURAĞA BAĞLANIYOR ────────────────────────────
--
-- 080 kanıtı zaten `durak_no` ile seferin BİR DURAĞINA bağlıyordu ve "durak
-- listesi eklendiği gün aynı tablo N satır taşır, HİÇBİR ŞEMA DEĞİŞİKLİĞİ
-- gerekmez" diyordu. Bir tek şey eksikti: `durak_no` bir SAYI, durak ise artık
-- bir SATIR. Sayı yeniden sıralamada değişir; kanıtın bağı değişmemeli.
--
-- ⚠️ `on delete set null` — durak silinirse kanıt DURUR. Delil, bağlandığı
-- planlama satırından uzun yaşar; kanıtı silmek 080'in tüm duruşuna aykırı
-- olurdu (kanıt silinmez, yalnız geçersiz ilan edilir).
alter table public.teslimatlar
  add column if not exists durak_id uuid references public.sefer_duraklari(id) on delete set null;

comment on column public.teslimatlar.durak_id is
  'Kanıtın bağlı olduğu durak satırı (082). durak_no ile FARKI: durak_no yeniden sıralamada değişebilen bir SAYI (yazıldığı andaki sıra), durak_id KALICI bağdır.';

/**
 * TEKİLLİK İKİYE BÖLÜNÜYOR — GARANTİ KORUNUYOR.
 *
 * 080'deki `teslimat_durak_uq (sefer_id, durak_no)` "aynı durağın iki kanıtı
 * olamaz" diyordu ve durak_no sabitken doğruydu. Duraklar yeniden
 * sıralanabildiği an ikisi birden bozuluyor: A durağı 1 numarayken kanıt
 * bıraktı, sıralama değişti, B durağı 1 oldu ve kanıt bırakamıyor — oysa hiç
 * kanıtı yok.
 *
 * Yerine İKİ KISMİ tekil indeks:
 *   · durak_id BOŞ satırlar (durak listesi olmayan eski/sade seferler)
 *     BUGÜNKÜ garantiyi aynen sürdürür: (sefer_id, durak_no) tekil.
 *   · durak_id DOLU satırlarda garanti DURAĞIN KENDİSİNE bağlanır ve
 *     `iptal_at is null` ile sınırlanır: bir durağın AYNI ANDA tek GEÇERLİ
 *     kanıtı olur. Geçersiz ilan edilmiş kanıt yeni denemeyi ENGELLEMEZ —
 *     yanlış kanıt zaten sebebiyle kayıtta duruyor (080), üstüne doğrusunu
 *     yazabilmek düzeltmenin ta kendisi.
 *
 * ⚠️ HİÇBİR SATIR SİLİNMİYOR/DEĞİŞMİYOR. Yalnız kısıt kısmi indekse çevriliyor.
 */
alter table public.teslimatlar drop constraint if exists teslimat_durak_uq;

create unique index if not exists teslimat_durak_no_uq
  on public.teslimatlar (sefer_id, durak_no)
  where durak_id is null;

create unique index if not exists teslimat_durak_id_uq
  on public.teslimatlar (durak_id)
  where durak_id is not null and iptal_at is null;

/**
 * DEĞİŞMEZLİK TETİKLEYİCİSİ GENİŞLETİLİYOR (080'in trg_teslimat_degismez).
 *
 * ⚠️ ZORUNLU: yeni bir kolon eklendiğinde tetikleyici onu SAYMAZSA, o kolon
 * kanıtın DEĞİŞTİRİLEBİLİR tek alanı olur. `durak_id` tam da kanıtın hangi
 * teslimata ait olduğunu söyleyen alan — güncellenebilir kalması, bir kanıtı
 * başka bir durağa taşımak demekti.
 *
 * Gövde 080'dekiyle AYNI, tek fark `durak_id` satırı. Yeniden yazılıyor çünkü
 * plpgsql fonksiyonu kısmi güncellenemez.
 */
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
    new.imza_svg          is distinct from old.imza_svg          or
    new.imza_yol          is distinct from old.imza_yol          or
    new.teslim_at         is distinct from old.teslim_at         or
    new.latitude          is distinct from old.latitude          or
    new.longitude         is distinct from old.longitude         or
    new.konum_dogruluk_m  is distinct from old.konum_dogruluk_m  or
    new.created_at        is distinct from old.created_at
  then
    raise exception
      'teslimat kaniti DEGISTIRILEMEZ (id=%). Yalnizca iptal alanlari guncellenebilir; duzeltme icin YENI bir durak kaydi acin.',
      old.id
      using errcode = 'HK080';
  end if;
  return new;
end
$$;

-- ── 3) GERİYE TAŞIMA: tek hedefli sefer → 1 duraklı sefer ────────────
--
-- ÖLÇÜLDÜ: HAK61'de 0, Sendigo'da 0 satır etkilenir (başlık §1). Yazılmasının
-- sebebi galzura-demo ve ileride açılacak kiracılar.
--
-- · `zone_id` BOŞ olan sefer durak ALMAZ — yer tutucu uydurulmaz.
-- · `not exists` koruması: dosya ikinci kez çalışırsa durak İKİLENMEZ.
-- · `ad` bölgenin O ANKİ adından donduruluyor; bölge adsızsa kaba bir yedek
--   yazılır ki NOT NULL kısıtı taşımayı düşürmesin.
-- · Durum `bekliyor` DEĞİL, seferin durumundan türetiliyor: kapanmış bir
--   seferin durağını "bekliyor" diye açmak, bitmiş işi açık göstermek olurdu.
--   `vardi_at` damgası varsa varış anı da taşınıyor (varis_kaynak='otomatik':
--   o damgayı 070 köprüsü yazmıştı, şoför değil).
insert into public.sefer_duraklari
  (sefer_id, sira, ad, zone_id, durum, varildi_at, varis_kaynak, tamamlandi_at)
select
  s.id,
  1,
  coalesce(nullif(btrim(g.name), ''), 'Hedef'),
  s.zone_id,
  case
    when s.durum = 'tamamlandi' then 'tamamlandi'
    when s.vardi_at is not null then 'varildi'
    else 'bekliyor'
  end,
  s.vardi_at,
  case when s.vardi_at is not null then 'otomatik' end,
  case when s.durum = 'tamamlandi' then s.tamamlandi_at end
  from public.seferler s
  left join public.geofences g on g.id = s.zone_id
 where s.zone_id is not null
   and not exists (
     select 1 from public.sefer_duraklari d where d.sefer_id = s.id
   );

/**
 * `seferler.zone_id` DÜŞÜRÜLMÜYOR — ama artık OKUNMUYOR.
 *
 * Kolon duruyor çünkü (a) düşürmek geri alınamaz, (b) taşımanın doğruluğu
 * ancak kaynağı yerinde dururken denetlenebilir, (c) 070 köprüsünün eski yolu
 * durak listesi OLMAYAN seferlerde hâlâ çalışıyor.
 *
 * Kod tarafındaki kural TEK CÜMLE: **durak listesi varsa duraklar konuşur;
 * yoksa eski tek hedef.** Çözüm tek yerde (lib/sefer-duraklari.ts →
 * `seferHedefi`), böylece iki gerçek doğmuyor.
 */
comment on column public.seferler.zone_id is
  'ESKİ tek hedef (066). 082''den sonra YALNIZ durak listesi olmayan seferler için geçerlidir — hedef çözümü lib/sefer-duraklari.ts:seferHedefi() üzerinden yapılır. Yeni yüzeyler bu kolonu OKUMAZ.';

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (ayrı çalıştırın)
--
--   select count(*) from public.sefer_duraklari;
--   → HAK61: 0 · Sendigo: 0 (zone_id dolu sefer yok — ölçüldü 25.08.2026)
--
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='sefer_duraklari';
--   → 20  (id, sefer_id, sira, ad, zone_id, adres, latitude, longitude,
--          yaricap_m, pencere_bas, pencere_bit, tahmini_sure_dk, notlar,
--          durum, atlama_sebep, varildi_at, tamamlandi_at, atlandi_at,
--          varis_kaynak, created_at)
--
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='teslimatlar'
--      and column_name='durak_id';                          → 1
--
--   select count(*) from pg_proc where proname='sefer_duraklari_sirala';  → 1
--
--   select indexname from pg_indexes
--    where schemaname='public' and tablename='teslimatlar'
--      and indexname in ('teslimat_durak_no_uq','teslimat_durak_id_uq');
--   → 2 satır
--
--   select conname from pg_constraint
--    where conrelid='public.teslimatlar'::regclass and conname='teslimat_durak_uq';
--   → 0 satır (kısmi indekslere çevrildi)
--
--   select condeferred from pg_constraint where conname='sefer_durak_sira_uq';
--   → t  (ertelenmiş — yeniden sıralamanın ön koşulu)
--
-- ERTELENMİŞ TEKİLLİĞİ SINAMAK (durak varken):
--   begin;
--     update public.sefer_duraklari set sira=2 where id='<A>';
--     update public.sefer_duraklari set sira=1 where id='<B>';
--   commit;        → GEÇER (ertelenmemiş kısıtta ilk UPDATE'te 23505 verirdi)
--
-- ⚠️ 082 UYGULANMAZSA: çok duraklı sefer KAPALI kalır. Panel ve şoför ekranı
-- normal çalışır, durak bölümü "bu kurulumda kapalı" der ve sefer eski TEK
-- hedefli davranışını sürdürür (aynı kademeli düşüş 056/058/077/078/079/080'de
-- de var).
-- =====================================================================
