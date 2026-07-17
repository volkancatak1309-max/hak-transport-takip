-- HAK61 — Migration 025: Personel dosyası alanları (workers)
-- Gökhan'ın topladığı personel formundaki bilgilerin ~%70'i sisteme girmiyordu
-- (yalnız ad/telefon/plaka vardı). 11 kolon ekler: kişisel, istihdam, ehliyet ve
-- acil-durum bilgileri. Tamamen ADDITIVE ve idempotent; hepsi NULLABLE — kâğıt
-- formlar eksik gelebiliyor, boş alan "girilmedi" demektir. Supabase SQL
-- Editor'da çalıştırılır. (Canlıda 18.07.2026'da uygulandı; bu dosya şema
-- geçmişinin repo kaydıdır.)

alter table public.workers
  add column if not exists birth_date date,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists social_security_no text,
  add column if not exists employment_start date,
  add column if not exists employment_type text
    check (employment_type in ('full_time', 'hourly')),
  add column if not exists license_no text,
  add column if not exists license_expiry date,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_relation text,
  add column if not exists emergency_contact_phone text;
