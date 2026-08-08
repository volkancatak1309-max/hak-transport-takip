-- HAK61 — Migration 047 (PDF PARMAK İZİ)
-- =====================================================================
-- Üretilen her PDF'e gömülen benzersiz işaretin KAYIT DEFTERİ.
--
-- ── İŞARET NEDEN OPAK ────────────────────────────────────────────────
-- İşaretin içine "kim, ne zaman, hangi IP" yazmak CAZİPTİ ve YAPILMADI:
-- filigranlı bir PDF elden ele dolaşmak üzere üretiliyor ve o belge
-- kaybolduğunda içindeki kişisel veri de kaybolur. Bunun yerine işaret
-- ANLAMSIZ bir tekil dize; kim/ne zaman/hangi IP bilgisi YALNIZ bu tabloda
-- durur. Belge sızarsa sızan şey bir kimlik değil, bir numaradır — ve o
-- numara patron ekranında sorgulanınca kime ait olduğunu söyler.
--
-- ── NEDEN SUNUCUDA ÜRETİLİYOR ────────────────────────────────────────
-- PDF'ler TARAYICIDA üretiliyor (@react-pdf/renderer). İşaret de istemcide
-- üretilseydi kullanıcı kendi tarayıcısında başka bir değer koyabilir ya da
-- hiç koymayabilirdi. Bu yüzden işaret bir SUNUCU ACTION'ında üretilip
-- BURAYA yazılıyor, sonra istemciye veriliyor. İstemci onu belgeden
-- silebilir — ama silmesi indirmenin KAYDINI silmez: satır burada durur.
--
-- Tekrar çalıştırılabilir (idempotent). Supabase SQL Editor'da çalıştırın.
-- ⚠️ 045 gerekir (audit_log / is_owner ile aynı katmanın parçası).
-- =====================================================================

begin;

create table if not exists public.pdf_fingerprints (
  id           uuid primary key default gen_random_uuid(),
  worker_id    uuid references public.workers(id) on delete set null,
  at           timestamptz not null default now(),
  ip           text,
  -- 'azg' | 'co2' | 'fuel' | 'performance' | 'shift' (lib/pdf-fingerprint.ts)
  report_type  text not null,
  -- Belgeye gömülen dize. Biçim: HAK-XXXX-XXXX-XXXX (Crockford base32).
  fingerprint  text not null
);

-- Sorgulama ekranının ANA ERİŞİMİ: yapıştırılan işaretle tek satır bulunur.
-- Tekil: aynı işaret iki belgeye verilemez (çakışma olursa yazma patlar ve
-- sessizce ikinci bir sahip doğmaz).
create unique index if not exists idx_pdf_fingerprints_value
  on public.pdf_fingerprints(fingerprint);

-- "Bu kişi neler indirdi" listesi.
create index if not exists idx_pdf_fingerprints_worker_time
  on public.pdf_fingerprints(worker_id, at desc);

create index if not exists idx_pdf_fingerprints_time
  on public.pdf_fingerprints(at desc);

-- NOT: RLS KAPALI kalır — şemanın geri kalanıyla tutarlı; yalnız service-role
-- istemcisi okuyup yazıyor (bkz. 045/046).

commit;

-- =====================================================================
--  ÇALIŞTIRDIKTAN SONRA
--    select count(*) from public.pdf_fingerprints;   -- 0
--
--  Bir işareti elle sorgulamak (patron ekranı bunu yapıyor):
--    select w.name, f.at, f.ip, f.report_type
--      from public.pdf_fingerprints f
--      left join public.workers w on w.id = f.worker_id
--     where f.fingerprint = 'HAK-XXXX-XXXX-XXXX';
--
--  ⚠️ Bu migration TEK BAŞINA hiçbir davranış değiştirmez. Parmak izini açan
--     şey SECURITY_LAYER_ENABLED (sunucu) + NEXT_PUBLIC_SECURITY_LAYER_ENABLED
--     (istemci) bayraklarıdır; ikisi de HAK61/Sendigo'da tanımsız.
-- =====================================================================
