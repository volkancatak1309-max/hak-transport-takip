-- HAK61 / Galzura Fleet — Migration 087 (VARDİYA DÜZELTME İZİ — SEBEP ZORUNLU)
-- =====================================================================
-- `shift_edit_log` VAR ve çalışıyor. Bu migration onu DENETİM kaydı hâline
-- getiriyor: sebep, düzeltme grubu, kaynak. Additive + idempotent; mevcut
-- satırlar korunur, hiçbir kolon değiştirilmez. Supabase SQL Editor'da
-- çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 1 — BUGÜN NE VAR (HAK61 canlı, 25.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
-- `shift_edit_log`: **13 satır**, hepsi `started_at` alanına ait.
-- Kolonlar: id · time_entry_id · changed_at · changed_by · field ·
--           old_value · new_value
--
-- Yani "kim, ne zaman, hangi alan, eski→yeni" TAM. Eksik olan tek şey
-- **NEDEN**. Avusturya iş müfettişliği bu raporu okuyor ve "bu çalışma saati
-- neden değişti" sorusunun cevabı bugün kayıtta yok.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 2 — İZ BIRAKMAYAN MUTASYON (en büyük denetim boşluğu)
-- ═══════════════════════════════════════════════════════════════════════
--
-- `adminCloseShiftAction` bir vardiyanın `ended_at` ve `end_km` alanlarını
-- YAZIYOR ama `shift_edit_log`a HİÇBİR ŞEY yazmıyordu. Yani yöneticinin
-- kapattığı bir vardiya, AZG raporunu besleyen `ended_at` alanını değiştirdiği
-- hâlde denetim izinde görünmüyordu. `editEntryAction` iz bırakıyor, kapatma
-- bırakmıyordu — aynı tabloya iki farklı standart.
--
-- 087 sonrası kapatma da iz bırakır ve SEBEP ister.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 3 — SORUNUN BÜYÜKLÜĞÜ (HAK61 canlı)
-- ═══════════════════════════════════════════════════════════════════════
--
--   · 9 vardiya AÇIK; 7'si 24.08'den beri (37–39 saat).
--   · 18–26.08 arasında **20 saatten uzun KAPANMIŞ** 14 vardiya var:
--     en uzunu 52,64 saat (Mehmet Durdu, 19→21.08).
--   · Bir şoför notu: "vardiyayi kapatmayi unutmusum" (Resul Demir, 21.08).
--   · Tipik desen: Muhammed Copur 24.08 07:34 → 25.08 04:30 (20,94 sa),
--     hemen ardından 25.08 04:30'da YENİ vardiya açmış. Yani vardiyayı
--     ertesi sabah, yeni vardiyayı açarken kapatmış.
--
-- ⚠️ Bildirilen "Can Özsavaş" HAK61 kadrosunda YOK (32 aktif personel
-- tarandı; en yakın adlar Sinan Özcan ve Sercan Kalkanli). O vaka başka bir
-- kiracıda olmalı — Sendigo/galzura-demo service-role anahtarları bu makinede
-- yok, oralarda ölçüm yapılamadı. Sorunun SINIFI HAK61'de fazlasıyla
-- doğrulandı; bu migration üç kiracıda da aynı işi görür.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 4 — TÜRETİLMİŞ SAYILAR ÖNBELLEKLİ Mİ
-- ═══════════════════════════════════════════════════════════════════════
--
-- HAYIR. Aranan önbellek tablolarının hiçbiri yok: `surucu_skorlari`,
-- `sofor_skor_ozet`, `vardiya_ozet`, `gunluk_ozet` → TABLO YOK.
--
-- Çalışma saati, km, skor, maliyet, AZG ve mevzuat kalan süresi HEPSİ istek
-- anında `time_entries`ten hesaplanıyor. Yani düzeltme kendiliğinden yayılır
-- ve bu migration'ın yeniden hesaplama için bir şey yapmasına GEREK YOK.
--
-- ⚠️ TEK İSTİSNA VE BİLİNÇLİ: `mevzuat_uyarilari` (086) bir DEFTERDİR.
-- Gönderilmiş bir bildirim, dayandığı vardiya sonradan düzeltilse de
-- silinmez — gönderilmemiş gibi görünmesi denetim izini bozardı. Defter
-- "o an ne biliniyordu"yu saklar, "şimdi ne doğru"yu değil.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar.
-- =====================================================================

begin;

/**
 * SEBEP — DENETİMİN CEVAP BEKLEDİĞİ ALAN.
 *
 * ⚠️ NULL'LANABİLİR OLMAK ZORUNDA: canlıda sebep alanı olmadan yazılmış
 * 13 satır var. `not null` yapmak migration'ı düşürürdü; geriye dönük sebep
 * uydurmak ise denetim kaydına yalan yazmak olurdu.
 *
 * ZORUNLULUK KODDA: yeni düzeltme ve kapatma yolları sebep olmadan
 * ÇALIŞMAZ (sunucu eylemi reddeder). Yani "sebebi olmayan satır" bundan
 * sonra üretilemez, ama geçmiş satırlar dürüstçe `null` kalır ve ekran
 * bunları "sebep kaydedilmemiş (087 öncesi)" diye gösterir.
 */
alter table public.shift_edit_log
  add column if not exists reason text
    check (reason is null or length(btrim(reason)) between 3 and 500);

/**
 * DÜZELTME GRUBU — bir düzeltme, N alan satırı.
 *
 * Bugün her alan ayrı satır ve aynı düzeltmeye ait oldukları yalnız
 * `changed_at`in milisaniyesine bakılarak anlaşılabiliyor. Sebep alan
 * başına değil DÜZELTME başına bir şeydir; grup olmadan aynı cümle N kez
 * kopyalanırdı ve iki ayrı düzeltme aynı saniyeye düşerse birbirine karışırdı.
 */
alter table public.shift_edit_log
  add column if not exists edit_group uuid;

/**
 * KAYNAK — bu satırı hangi yol yazdı.
 *
 * 'duzeltme' yöneticinin vardiya düzenleme formu
 * 'kapatma'  yöneticinin kapanmamış vardiyayı kapatması
 * 'km'       yalnız km düzeltme yolu (adminUpdateKmAction)
 *
 * Denetimde "bu bitiş saatini kim, hangi işlemle yazdı" sorusunun cevabı.
 * CHECK dar tutuldu: yeni bir yol eklenirse bilinçli olarak buraya da
 * eklenmeli, sessizce sızmamalı.
 */
alter table public.shift_edit_log
  add column if not exists kaynak text
    check (kaynak is null or kaynak in ('duzeltme', 'kapatma', 'km'));

comment on column public.shift_edit_log.reason is
  'Düzeltmenin SEBEBİ (087). Yeni yollarda zorunlu; 087 öncesi satırlarda null — geriye dönük sebep uydurulmadı.';
comment on column public.shift_edit_log.edit_group is
  'Tek bir düzeltmenin alan satırlarını birbirine bağlar (087). Sebep alan başına değil düzeltme başınadır.';

-- Bir vardiyanın geçmişi: en sık sorgu (satır detayı + AZG rozeti).
create index if not exists idx_shift_edit_entry
  on public.shift_edit_log (time_entry_id, changed_at desc);

-- Grup içi okuma — "bu düzeltmede başka ne değişti".
create index if not exists idx_shift_edit_group
  on public.shift_edit_log (edit_group)
  where edit_group is not null;

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorguları):
--
--   select column_name, is_nullable from information_schema.columns
--    where table_schema='public' and table_name='shift_edit_log'
--    order by ordinal_position;
--   → 10 satır: id, time_entry_id, changed_at, changed_by, field,
--     old_value, new_value, reason, edit_group, kaynak
--
--   select count(*) from public.shift_edit_log;              → 13 (değişmedi)
--   select count(*) from public.shift_edit_log
--    where reason is not null;                               → 0 (henüz)
--
-- MEVCUT VERİYE ETKİSİ: sıfır. Üç null'lanabilir kolon eklendi, hiçbir satır
-- güncellenmedi, hiçbir motor davranışı değişmedi.
-- =====================================================================
