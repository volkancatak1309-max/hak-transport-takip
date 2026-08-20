-- 068 — ZİYARET KAPANIŞ SEBEBİNE 'zone_closed' EKLE (#136)
-- =====================================================================
-- ⚠️ 064 (zone_visits) uygulanmış olmalı.
--
-- ═══ NEDEN GEREKLİ ═══
-- 20.08.2026 canlı testinde görüldü: demo'da müşteri bölgesi pasifleştirilince
-- o bölgenin AÇIK ziyaretleri askıda kaldı. Sebep yapısal — hem ölçüm hem gap
-- bekçisi `active = true` müşteri bölgeleri kapısının ARDINDA çalışıyor; bölge
-- kapanınca o satırları kapatacak hiçbir yol kalmıyor ve fatura eki süresiz
-- "devam ediyor" satırı taşıyor.
--
-- Kod artık bölge pasifleştirildiğinde/arşivlendiğinde açık ziyaretleri
-- `ended_at = last_seen_at` ile kapatıyor. Ama bu kapanış, ötekilerden AYRI bir
-- şey söylüyor ve ayrı işaretlenmeli:
--
--   'exit'        → araç çıktı. Süre TAM.
--   'gap_timeout' → cihaz sustu. Süre EKSİK olabilir — araç hâlâ içeride
--                   olabilirdi, bilmiyoruz.
--   'zone_closed' → ÖLÇÜMÜ BİZ DURDURDUK. Süre EKSİK olabilir — araç hâlâ
--                   içerideydi, ama artık ölçmüyoruz.
--
-- Son ikisi "bu süre eksik olabilir" der; SEBEPLERİ farklıdır ve raporda ayrı
-- rozet taşırlar. Üçünü tek etikete koymak, ölçümü kendi kararımızla
-- kestiğimizi müşteriden gizlerdi.
--
-- ═══ 068 KOŞULMAZSA NE OLUR ═══
-- Kod düşer ama DURMAZ: CHECK reddedince (23514) satır **sebepsiz** kapanır.
-- Ziyaret yine askıda kalmaz, yalnız raporda "Ölçüm durdu" rozeti çıkmaz.
-- Yani bu migration doğruluk için değil, ŞEFFAFLIK için gerekli.
--
-- ⚠️ ÜÇ VERİTABANI VAR (bkz. Bekleyen-Isler #128): hak-transport-takip ·
-- galzura-demo · sendigo. "Koşuldu" üç ayrı kutucuktur.
-- =====================================================================

begin;

-- Kısıt adı 064'te açıkça verilmişti; yine de adı VARSAYMAK yerine
-- `end_reason` üzerindeki CHECK bulunup düşürülüyor (tekrar çalıştırılabilir).
do $$
declare k text;
begin
  select con.conname into k
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
   where ns.nspname = 'public'
     and rel.relname = 'zone_visits'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%end_reason%'
   limit 1;
  if k is not null then
    execute format('alter table public.zone_visits drop constraint %I', k);
  end if;
end $$;

alter table public.zone_visits
  add constraint zone_visits_end_reason_check
  check (end_reason in ('exit','gap_timeout','shift_end','zone_closed'));

commit;

notify pgrst, 'reload schema';
