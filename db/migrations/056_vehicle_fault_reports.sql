-- 056_vehicle_fault_reports.sql — ELLE ARIZA BİLDİRİMİ (U7)
--
-- ⚠️ BU DOSYA CLAUDE TARAFINDAN ÇALIŞTIRILMADI. Volkan Supabase SQL
-- editöründe kendisi çalıştırır.
--
-- ── NEDEN vehicle_dtc'YE YAZILMIYOR ────────────────────────────────────────
-- `vehicle_dtc` CİHAZIN gerçeğidir: flespi akışı her anlık görüntüde tabloyu
-- uzlaştırıyor (`saveDtc` + `reconcileDtc`). Oraya elle bir satır girilirse bir
-- sonraki senkron turunda "artık listede yok" sayılıp `cleared_at` ile kapanır
-- ya da tamamen kaybolur. Bu tablo İNSANIN beyanıdır — ayrı yaşamak zorunda.
-- İkisi aynı ekranda yan yana gösterilebilir; aynı satırda DEĞİL.
--
-- ── ALANLAR ────────────────────────────────────────────────────────────────
-- reported_by  → bildiren kişi. Depo `created_by` / `updated_by` / `approved_by`
--                adlandırmasını kullanıyor, bu da onun kardeşi.
--                CASCADE YOK (bilerek): bildirim, bildireni silinse bile
--                kayıttır. Zaten bu sistemde personel silinmiyor,
--                `terminated_at` ile ayrılıyor.
-- aciklama     → serbest metin. Uzunluk sınırı UÇTA (2000 karakter), burada
--                CHECK olarak DEĞİL: sınır bir ürün kararıdır ve değiştiğinde
--                migration yazmak gerekmesin.
-- durum        → 'acik' | 'kapali'. Ara durum ('islemde') BİLEREK yok —
--                bugün onu değiştirecek bir yüzey yok, olmayan bir iş akışını
--                şemaya yazmak onu var sanmaya yol açar. Gerektiğinde CHECK
--                genişletmek tek satırlık additive bir iştir.
--
-- Adlandırma notu: `aciklama` ve `durum` TÜRKÇE, tablodaki diğer kolonlar ve
-- deponun geri kalanı İNGİLİZCE. Volkan'ın verdiği isimler bunlar; İngilizce
-- karşılıkları `note` ve `status` olurdu. Karar onun.
--
-- ── GERİYE DÖNÜK ETKİ YOK ──────────────────────────────────────────────────
-- Yeni tablo; mevcut hiçbir sorgu, sayı ya da ekran değişmez.
--
-- Gizlilik: bu dosyada plaka/isim YOK.

create table if not exists public.vehicle_fault_reports (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  reported_by uuid not null references public.workers(id),
  aciklama    text not null,
  durum       text not null default 'acik' check (durum in ('acik', 'kapali')),
  created_at  timestamptz not null default now()
);

-- Araç detayının okuması: tek aracın bildirimleri, yeniden eskiye.
create index if not exists idx_vehicle_fault_reports_vehicle
  on public.vehicle_fault_reports(vehicle_id, created_at desc);

-- RLS KAPALI — şemanın geri kalanıyla tutarlı. Bu tabloya yalnız service-role
-- istemcisi (sunucu tarafı uçlar) yazıyor ve okuyor; tarayıcıya anon anahtarla
-- açılan bir yolu yok.
