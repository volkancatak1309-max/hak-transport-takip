-- 041_counts_as_driver.sql — ARAÇ KULLANAN YÖNETİCİ (kayıt bazında muafiyet)
--
-- workers.counts_as_driver: bu YÖNETİCİ kaydının vardiyaları şoför metriklerine
-- ve § 26 AZG raporuna DAHİL edilsin mi. false (varsayılan) = bugünkü davranış.
--
-- ── NEDEN GEREKLİ ──────────────────────────────────────────────────────────
-- lib/driver-scope.ts 28.07.2026'dan beri is_admin=true olan HER kaydı şoför
-- yüzeylerinden düşürüyor: harita, aktif vardiya sayacı, Günün Panosu, Operasyon
-- Özeti, Toplam KM, Performans, AZG, Seferler, Dikkat/Aksiyon, roster, ehliyet
-- uyarısı. Kural oradaki gerekçeyle doğruydu: "yönetici personeldir, şoför
-- değildir" — ve büyük kurulumda hâlâ doğrudur.
--
-- KÜÇÜK kurulumda bu varsayım tutmuyor: patron aynı zamanda direksiyona geçen
-- ilk (bazen tek) şoför olabiliyor. O kurulumda yönetici hesabından açılan
-- GERÇEK vardiyalar hiçbir yüzeyde görünmüyor — sistem "bugün kimse çalışmadı"
-- diyor. Sorun kapsamın kendisi değil, İSTİSNASININ olmaması.
--
-- ── NEDEN YENİ KOLON, NEDEN TÜRETİLMİŞ DEĞİL ───────────────────────────────
-- İstisna AÇIK ve KAYIT BAZINDA olmalı. Mevcut bir alandan türetmek (örn.
-- "atanmış aracı varsa şoför say") GİZLİ davranış yaratır: o alan bambaşka bir
-- sebeple değiştiğinde metrikler sessizce kayar ve kimse bağlantıyı kuramaz.
-- Bu bir ROL değildir — is_admin'in yerine geçmez, yanında durur; tek bir
-- MUAFİYET işaretidir.
--
-- ── VARSAYILAN false — GERİYE DÖNÜK ETKİ YOK ───────────────────────────────
-- Kolon eklendiğinde hiçbir kurulumun davranışı değişmez: mevcut yöneticiler
-- elenmeye devam eder, hiçbir sayı oynamaz. Değişim ancak kutu işaretlenince
-- ve YALNIZ o kayıt için başlar.
--
-- ── ETKİSİ OLAN TEK KÜME: is_admin = true ──────────────────────────────────
-- is_admin=false olan kayıtta bayrak hiçbir şeyi değiştirmez (onlar zaten
-- şofördür). Bayrağı is_admin'e bağlayan bir CHECK bilerek KOYULMADI: yönetici
-- yetkisi geri alındığında (is_admin=false) kısıt UPDATE'i kırardı.
--
-- Gizlilik: bu dosyada isim/plaka YOK. İşaret canlıda yönetici çalışan
-- formundaki kutudan verilir.

alter table public.workers
  add column if not exists counts_as_driver boolean not null default false;

comment on column public.workers.counts_as_driver is
  'Yönetici (is_admin=true) kaydı için ŞOFÖR METRİKLERİNE DAHİL OLMA muafiyeti (migration 041). true → lib/driver-scope.ts bu kaydı elemez: vardiyaları haritada, Günün Panosu''nda, raporlarda ve § 26 AZG belgesinde görünür. false (varsayılan) → bugünkü davranış: yönetici personeldir, şoför değildir.';

notify pgrst, 'reload schema';
