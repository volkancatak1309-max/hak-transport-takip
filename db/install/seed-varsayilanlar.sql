-- =====================================================================
--  YENİ KURULUM VARSAYILANLARI — sözlükler boş ekranla açılmasın
-- =====================================================================
--
-- ⚠️ BU DOSYA YALNIZ `*-full.sql` KURULUM DOSYALARININ SONUNA EKLENİR.
--    Hizalama dosyalarına (044→081) GİRMEZ ve MEVCUT kiracılara ASLA
--    uygulanmaz. HAK61 · Sendigo · galzura-demo bu satırları GÖRMEZ:
--    onların sözlükleri kendi verileriyle doludur ve buraya yazılan
--    "makul varsayılan", orada uydurma veri olurdu.
--
-- ═══ HER BLOK "TABLO BOŞSA" KOŞULLU ═══
--
-- `where not exists (select 1 from <tablo>)` — üç şey birden sağlar:
--   1. Kurulum dosyası ikinci kez çalıştırılırsa satırlar İKİLENMEZ.
--   2. Kiracı kendi sözlüğünü kurduktan sonra dosya yeniden koşarsa
--      onun verisi EZİLMEZ.
--   3. Tek bir satır bile varsa hiçbir şey yazılmaz — yarım karışık bir
--      liste, boş listeden daha kafa karıştırıcıdır.
--
-- ═══ BUNLAR ÖNERİ, DAYATMA DEĞİL ═══
--
-- Kiracı hepsini düzenler, pasifleştirir ya da siler (panelde Düzenle/Sil
-- her satırda var). Amaç ilk günü boş ekranla başlatmamak; doğru listeyi
-- ürünün bildiğini iddia etmek değil. Aralıklar Avrupa hafif ticari araç
-- pratiğinden alınmış makul değerlerdir — üreticinin servis kitabı esastır.
--
-- ═══ KENDİ TRANSACTION'I YOK — BİLEREK ═══
--
-- Kurulum dosyası şemanın TAMAMINI tek transaction'da uygular ve bu blok o
-- commit'ten SONRA gelir. Buraya ikinci bir begin/commit koymak, kurulum
-- dosyasında iki transaction demek olurdu ve `lint:install-sql` muhafızı
-- (K3) tam olarak bunu yasaklıyor: içeride kalan bir commit, hata hâlinde
-- yarım şema bırakır. Üç blok da birbirinden bağımsız ve tek ifadelik —
-- biri düşerse diğerleri yine de doğru sonucu verir.

-- ── 1) BAKIM KURALLARI (081) ─────────────────────────────────────────
-- `vehicle_id` NULL = FİLO GENELİ: tek kural tüm araçlara uygulanır ve
-- uyarı ARAÇ BAŞINA çıkar. Km ve ay birlikte verilen kurallarda hangisi
-- önce dolarsa o tetikler — cihazı susmuş araç süre ekseninden yakalanır.
insert into public.bakim_planlari (vehicle_id, tip, aralik_km, aralik_ay, uyari_km, uyari_gun)
select * from (values
  (null::uuid, 'Yağ değişimi',   15000, 12,   500, 14),
  (null::uuid, 'Fren kontrolü',  30000, null, 1000, 14),
  -- Lastik yalnız SÜRE ekseninde: yazlık/kışlık değişimi mevsime bağlıdır,
  -- kilometreye değil.
  (null::uuid, 'Lastik değişimi', null,  6,    500, 21),
  (null::uuid, 'Genel bakım',    20000, 12,   500, 14)
) as v(vehicle_id, tip, aralik_km, aralik_ay, uyari_km, uyari_gun)
where not exists (select 1 from public.bakim_planlari);

-- ── 2) ARAÇ KONTROL MADDELERİ (081) ──────────────────────────────────
-- `arac_tipi` NULL = her araçta sorulur. `tur`: once | sonra | ikisi.
-- Hasar/temizlik gibi sefer SONU maddeleri kiracıya bırakıldı — burada
-- yalnız her filoda karşılığı olan güvenlik kalemleri var.
insert into public.dvir_maddeleri (kod, etiket, aciklama, tur, sira)
select * from (values
  ('fren',        'Frenler',              'Pedal hissi, kaçak, hortum aşınması', 'ikisi', 10),
  ('lastik',      'Lastikler',            'Diş derinliği, basınç, yanak hasarı', 'once',  20),
  ('aydinlatma',  'Farlar ve sinyaller',  'Kısa/uzun far, fren lambası, sinyal', 'once',  30),
  ('motor_yagi',  'Motor yağı',           'Seviye ve kaçak',                     'once',  40),
  ('cam_suyu',    'Cam suyu ve silecek',  'Seviye, silecek lastiği',             'once',  50),
  ('aynalar',     'Aynalar',              'Kırık, gevşek, kirli',                'once',  60),
  ('yangin',      'Yangın söndürücü',     'Yerinde, dolu, muayene tarihi geçmemiş', 'ikisi', 70),
  ('ilk_yardim',  'İlk yardım çantası',   'Yerinde ve son kullanma tarihi geçmemiş', 'ikisi', 80)
) as v(kod, etiket, aciklama, tur, sira)
where not exists (select 1 from public.dvir_maddeleri);

-- ── 3) BELGE TÜRLERİ (078) ───────────────────────────────────────────
-- ⚠️ EHLİYET BURADA YOK ve olmayacak: kendi ekseninde takip ediliyor
-- (`workers.license_expiry`). Tür olarak da açsaydık aynı gerçek iki yerde
-- tutulur, Dikkat panosunda iki kalem çıkardı.
--
-- Oturma/çalışma izni 90 gün uyarır: yenilemesi randevuya bağlı ve
-- haftalar sürebiliyor. Diğerleri 30 gün — sınav/muayene randevusu için
-- yeterli.
insert into public.document_types (code, label, warn_days, requires_number, sort_order)
select * from (values
  ('src',         'SRC Belgesi',          30, true,  10),
  ('psikoteknik', 'Psikoteknik Belgesi',  30, false, 20),
  ('adr',         'ADR Belgesi',          30, true,  30),
  ('saglik',      'Sağlık Raporu',        30, false, 40),
  ('oturma_izni', 'Oturma / Çalışma İzni', 90, true,  50)
) as v(code, label, warn_days, requires_number, sort_order)
where not exists (select 1 from public.document_types);

-- ── DOĞRULAMA (ayrı çalıştırın) ───────────────────────────────────────
-- select count(*) from public.bakim_planlari;    → 4
-- select count(*) from public.dvir_maddeleri;    → 8
-- select count(*) from public.document_types;    → 5
--
-- İkinci kez çalıştırın: sayılar DEĞİŞMEMELİ (koşullu ekleme).
