-- 057_fault_report_closed.sql — ARIZA BİLDİRİMİNDE KAPATMA İZİ
--
-- ⚠️ BU DDL VOLKAN TARAFINDAN 11.08.2026'DA SUPABASE'DE ÇALIŞTIRILDI ve HAK61
-- canlısında UYGULANMIŞ durumdadır (kolonlar ölçüldü: `closed_at` VAR,
-- `closed_by` VAR). Bu dosya deponun ŞEMA KAYDIDIR — yeni bir kurulum
-- migration listesini buradan yürütecek. Claude tarafından çalıştırılmadı.
--
-- ── NEDEN GEREKLİ ──────────────────────────────────────────────────────────
-- 056 bildirimin AÇILIŞINI kaydediyordu (`reported_by`, `created_at`) ama
-- KAPANIŞINI kaydetmiyordu. `durum` alanı tek başına "şu an kapalı" der;
-- "kim, ne zaman kapattı" sorusunun cevabı yoktu. Kapatma bir yönetici
-- kararıdır ve izsiz bırakılırsa geriye dönük hesabı sorulamaz.
--
-- ── NEDEN İKİ KOLON, NEDEN AYRI TABLO DEĞİL ────────────────────────────────
-- Bildirimin YALNIZ İKİ durumu var (056: 'acik' | 'kapali') ve kapanış
-- tekildir — açılıp kapanma döngüsünün geçmişi tutulmuyor. Ayrı bir olay
-- tablosu, olmayan bir ihtiyacı şemaya yazmak olurdu. Yeniden açılan bildirimde
-- ikisi de NULL'a döner: "şu an açık" ile "kapatılmış ama sonra açılmış" aynı
-- şeydir, çünkü açık bir bildirimin kapatma anı YOKTUR.
--
-- ── GERİYE DÖNÜK ETKİ YOK ──────────────────────────────────────────────────
-- İkisi de nullable ve varsayılansız: mevcut satırlar NULL kalır, hiçbir sorgu
-- ve hiçbir sayı değişmez. 056'sı olup 057'si olmayan bir kurulumda uç
-- ÇALIŞMAYA DEVAM EDER — kolon eksikse yalnız durum yazılır ve yanıt
-- `kapatmaIzi: false` ile bunu SÖYLER (lib/fault-reports-db.ts).
--
-- `closed_by`'da CASCADE YOK, 056'daki `reported_by` ile aynı gerekçe: iz,
-- izi bırakan kişi silinse bile kayıttır. Zaten personel silinmiyor,
-- `terminated_at` ile ayrılıyor.
--
-- Gizlilik: bu dosyada plaka/isim YOK.

alter table public.vehicle_fault_reports
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.workers(id);
