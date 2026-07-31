-- HAK61 — Migration 040
-- VARDİYA DÜZENLEME İZİ (shift_edit_log).
--
-- NEDEN ŞİMDİ: tablo 22.07.2026'da tasarlandı ve `lib/shift-edit-log.ts`
-- yazıldı, ama SQL hiçbir migration'a girmedi — canlıda elle çalıştırılacaktı
-- ve çalıştırılmadı. Kod "tablo yoksa sessiz geç" desenli olduğu için hata
-- vermedi; iz sessizce hiç tutulmadı. İkinci müşteri kurulumunda aynı boşluk
-- tekrar edecekti (31.07.2026 taraması).
--
-- NE İŞE YARAR: AZG raporu YALNIZ üç alandan beslenir — started_at, ended_at,
-- break_minutes — ve üçü de yöneticinin serbestçe değiştirebildiği alanlardır.
-- Bu tablo olmadan bir denetimde "bu çalışma saati neden değişti?" sorusu
-- cevapsız kalır. Düzenleme YASAKLANMIYOR (gerçek hatalar düzeltilebilmeli);
-- yapılan şey düzeltmeyi görünür ve geri izlenebilir kılmak.
--
-- HAK61 ETKİSİ: tamamen EKLEMELİ. Bu migration çalıştırılmadan da uygulama
-- bugünkü gibi çalışır (kod tabloyu yoklar, yoksa boş döner). Çalıştırıldıktan
-- SONRA düzenlemeler kaydedilmeye başlar — bugüne kadar yapılmış düzenlemeler
-- geriye dönük ÜRETİLEMEZ (eski değer hiçbir yerde saklanmamıştı).
--
-- Idempotent: tablo/indeks IF NOT EXISTS.

create table if not exists public.shift_edit_log (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,
  changed_at timestamptz not null default now(),
  -- Düzenleyen yönetici. Personel kaydı silinirse iz KALIR (set null):
  -- § 132 BAO 7 yıl saklama, izin kendisi kayıttan bağımsızdır.
  changed_by uuid references public.workers(id) on delete set null,
  -- lib/shift-edit-log.ts TRACKED listesindeki alan adı. Serbest metin:
  -- izlenen alan kümesi kodda değişebilir, eski satırlar okunabilir kalmalı.
  field text not null,
  old_value text,
  new_value text
);

comment on table public.shift_edit_log is
  'Vardiya alanlarının elle düzeltilme izi (AZG denetim dayanağı). Yazan: lib/shift-edit-log.ts logShiftEdit().';

-- Bir vardiyanın geçmişi (listShiftEdits) — en sık sorgu, changed_at sırasıyla.
create index if not exists idx_shift_edit_log_entry
  on public.shift_edit_log (time_entry_id, changed_at desc);

-- PostgREST şema önbelleğini tazele (tablo /rest altında görünsün).
notify pgrst, 'reload schema';
