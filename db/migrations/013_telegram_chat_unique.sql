-- HAK61 — Migration 013
-- Bir Telegram chat = TEK worker.
--
-- Duzeltilen hata: telegram_chat_id'de yalnizca NON-UNIQUE index vardi; ayni chat
-- birden fazla worker'a baglanabiliyordu (test verisi tam da boyleydi). Webhook,
-- chat_id'den worker'i .maybeSingle() ile ariyordu; bu coklu kayitta HATA dondurur
-- -> worker=null -> watchdog "Evet/Hayir" butonlari sessizce hicbir sey yapmiyordu.
--
-- Supabase SQL Editor'da calistir. Tekrar calistirilabilir (idempotent).

-- 1) DEDUP: birden fazla worker'a bagli her telegram_chat_id icin BIR kayit tut,
--    digerlerinin baglantisini kaldir (null). Tutma onceligi:
--      (a) su an ACIK vardiyasi (ended_at IS NULL) olan worker,
--      (b) yoksa en son baglanan (telegram_linked_at DESC),
--      (c) esitlikte id ile sabit siralama.
with ranked as (
  select
    w.id,
    row_number() over (
      partition by w.telegram_chat_id
      order by
        (exists (
          select 1 from public.time_entries t
          where t.worker_id = w.id and t.ended_at is null
        )) desc,
        w.telegram_linked_at desc nulls last,
        w.id
    ) as rn
  from public.workers w
  where w.telegram_chat_id is not null
)
update public.workers w
set telegram_chat_id   = null,
    telegram_username  = null,
    telegram_linked_at = null,
    telegram_locale    = null
from ranked r
where w.id = r.id
  and r.rn > 1;

-- 2) NON-UNIQUE index'i kismi UNIQUE index ile degistir. NULL'lar sinirsiz
--    (Telegram baglamayan worker'lar), NULL olmayan chat id'ler benzersiz olmali.
drop index if exists public.idx_workers_telegram_chat;

create unique index if not exists idx_workers_telegram_chat_unique
  on public.workers (telegram_chat_id)
  where telegram_chat_id is not null;
