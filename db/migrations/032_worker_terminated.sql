-- 032_worker_terminated.sql — İŞTEN ÇIKIŞ (Modül 2)
--
-- workers.terminated_at: personelin SON ÇALIŞMA GÜNÜ. null = çalışıyor.
-- İşten çıkış akışı bu kolonu YAZARKEN is_active=false de yazar; böylece tüm
-- CANLI yüzeyler (Günün Panosu, harita, analiz, seçiciler, auto-shift) mevcut
-- is_active kontrolleriyle personeli kendiliğinden düşürür. terminated_at ise
-- "ne zaman ayrıldı + Eski Personeller arşivi" içindir.
--
-- GEÇMİŞ RAPORLAR: silme YOK — yalnız arşiv. Çalışma süresi/bordro kayıtları
-- Avusturya'da § 132 BAO gereği kaydın ait olduğu takvim yılından itibaren
-- 7 yıl saklanır; ayrılan personelin adı eski AZG/vardiya/yakıt raporlarında
-- görünmeye DEVAM eder (isim evreni sorgularından is_active filtresi kaldırıldı).
--
-- Gizlilik: bu dosyaya gerçek isim yazma (yalnız DDL). Ekrem/Bayram gibi mevcut
-- kayıtların terminated_at'i AYRI bir tek-seferlik UPDATE ile set edilir (repoda
-- değil), çünkü WHERE koşulu gerçek kişi verisi taşır.

alter table public.workers
  add column if not exists terminated_at date;

notify pgrst, 'reload schema';
