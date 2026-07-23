-- 031_worker_leaves.sql — İZİN TAKVİMİ (Modül 1)
--
-- İki tablo: worker_leaves (izinler) + leave_edit_log (değişiklik izi).
--
-- TASARIM KARARLARI
--  • ARALIK modeli (per-gün satır DEĞİL): start_date..end_date kapalı aralık.
--    "Bugün izinli mi?" = start_date <= <gün> AND end_date >= <gün> (Viyana günü).
--  • unique(worker_id, day) YOK — Krankenstand yasal olarak Urlaub'u kesebilir;
--    aynı gün iki farklı izin türü meşru bir durumdur. Örtüşme kontrolü
--    uygulama katmanında (app/actions/leaves.ts), DB kısıtıyla değil.
--  • ONAY AKIŞI: filo şefi status='pending' TALEP açar (takvimde silik), patron
--    (is_admin) onaylayınca status='approved' olur (tam renk) ve Günün Panosu'na
--    yansır. Patron doğrudan girerse default 'approved'.
--  • leave_edit_log.leave_id BİLİNÇLİ olarak FK'SIZ: izin silinince silme izi
--    hayatta kalmalı (shift_edit_log deseninin gizli kusuru buydu).
--
-- Gizlilik: bu dosyaya gerçek isim/plaka/kişi verisi YAZMA (yalnız DDL).
-- Idempotent: create ... if not exists — tekrar çalıştırmak güvenli.

create table if not exists public.worker_leaves (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.workers(id) on delete cascade,
  leave_type  text not null check (leave_type in (
                'jahresurlaub','krankenstand','pflegefreistellung','unbezahlt',
                'hochzeit','sonderurlaub','todesfall','umzug','geburt','karenz'
              )),
  start_date  date not null,
  end_date    date not null,
  status      text not null default 'approved'
              check (status in ('pending','approved','rejected')),
  note        text,
  created_by  uuid references public.workers(id) on delete set null,
  approved_by uuid references public.workers(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint worker_leaves_range_ck check (end_date >= start_date)
);

create index if not exists idx_worker_leaves_worker
  on public.worker_leaves (worker_id, start_date);
create index if not exists idx_worker_leaves_range
  on public.worker_leaves (start_date, end_date);
create index if not exists idx_worker_leaves_status
  on public.worker_leaves (status);

create table if not exists public.leave_edit_log (
  id         uuid primary key default gen_random_uuid(),
  leave_id   uuid not null,                 -- FK YOK: silme izi hayatta kalsın
  changed_at timestamptz not null default now(),
  changed_by uuid references public.workers(id) on delete set null,
  action     text not null default 'update'
             check (action in ('create','update','delete','approve','reject')),
  field      text not null,                 -- create/delete'te '*'
  old_value  text,
  new_value  text
);

create index if not exists idx_leave_edit_log_leave
  on public.leave_edit_log (leave_id, changed_at desc);

-- Servis-rol istemcisi dışında erişim yok (projedeki diğer tablolarla aynı).
alter table public.worker_leaves  disable row level security;
alter table public.leave_edit_log disable row level security;

-- PostgREST şema önbelleğini yenile (yeni tablolar hemen görünür olsun).
notify pgrst, 'reload schema';
