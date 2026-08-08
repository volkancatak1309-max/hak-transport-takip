-- HAK61 — Migration 048 (ERİŞİM KAPILARI MUAFİYETİ)
-- =====================================================================
-- Tek kolon: workers.gate_exempt
--
-- ── NEDEN KOLON, NEDEN TELEFON NUMARASI DEĞİL ────────────────────────
-- Muafiyeti bir telefon numarasına gömmek (kodda ya da env'de) üç şeyi
-- birden bozardı: numara değişince muafiyet sessizce kaybolur, kimin
-- neden muaf olduğu hiçbir yerde görünmez, ve muafiyeti kaldırmak için
-- kod değişikliği + deploy gerekir. Kolon, patron ekranından açılıp
-- kapanabilen ve audit_log'a düşen bir VERİ kararıdır.
--
-- Aynı gerekçe 029 (managed_fleet) ve 045 (is_owner) için de geçerliydi:
-- bu depoda rol ve muafiyet HER ZAMAN tek nullable/boolean kolon + kod
-- tarafında bir kapı olarak yaşar. Yeni rol TABLOSU yok.
--
-- ── NEYDEN MUAF, NEYDEN DEĞİL ────────────────────────────────────────
-- MUAF   : cihaz onayı (046 kapı 1) · ülke onayı (kapı 2) · saat kilidi (kapı 3)
-- MUAF DEĞİL: ÖLÜ ADAM ANAHTARI (kapı 4).
--
-- Bu ayrım anahtarın anlamıdır: "sistemi kapat" dendiğinde patron DIŞINDA
-- herkesin düşmesi gerekiyor. Muafiyet bunu delseydi anahtar, kapattığını
-- sandığın ama iki kişinin içeride kaldığı bir düğmeye dönerdi — yani acil
-- durum aracı olmaktan çıkardı.
--
-- ⚠️ MUAFİYET GÖRÜNÜRLÜK VERMEZ. gate_exempt=true olan biri hâlâ:
--    • /admin/guvenlik'i AÇAMAZ (requireOwner, is_owner ister)
--    • patronu personel listelerinde GÖREMEZ (045 görünmezliği ayrı eksen)
--    İki kavram bilerek ayrı: biri "kapıdan geç", diğeri "kademe".
--
-- Tekrar çalıştırılabilir (idempotent). Supabase SQL Editor'da çalıştırın.
-- ⚠️ 045 + 046 gerekir.
-- =====================================================================

begin;

alter table public.workers
  add column if not exists gate_exempt boolean not null default false;

comment on column public.workers.gate_exempt is
  'Erişim kapılarından muaf (048): cihaz onayı, ülke onayı ve saat kilidi '
  'uygulanmaz. ÖLÜ ADAM ANAHTARI bundan etkilenmez — orada tek istisna '
  'is_owner. Görünürlük/yetki VERMEZ.';

-- Muaf sayısı tipik olarak 1-2; kısmi indeks tam da bu dağılım için.
create index if not exists idx_workers_gate_exempt
  on public.workers(id)
  where gate_exempt;

commit;

-- =====================================================================
--  ÇALIŞTIRDIKTAN SONRA — muafiyeti siz atarsınız
--
--    update public.workers set gate_exempt = true where phone = '+436608130379';
--
--  Doğrulama:
--    select name, phone, is_admin, is_owner, gate_exempt
--      from public.workers where gate_exempt or is_owner;
--
--  Panelden de yapılabilir: /admin/guvenlik → "Erişim kuralları" sekmesi,
--  kişi satırındaki "Kapılardan muaf" düğmesi. Oradan yapılan değişiklik
--  audit_log'a eski/yeni değeriyle düşer; SQL'le yapılan düşmez.
--
--  ⚠️ Bu migration TEK BAŞINA hiçbir davranış değiştirmez: kolon varsayılanı
--     false ve kapıları açan şey ACCESS_GATES_ENABLED env'idir.
-- =====================================================================
