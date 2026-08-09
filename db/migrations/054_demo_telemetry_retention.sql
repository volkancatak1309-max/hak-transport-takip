-- 054 — DEMO TELEMETRİ TEMİZLİĞİ (yalnız galzura-demo veritabanında)
--
-- ═══ NEDEN ═══
--
-- galzura-demo günde ~50 bin device_telemetry satırı alıyor ve 300 bini geçti.
-- Demo kurulumunun ham telemetriyi süresiz saklaması için hiçbir sebep yok:
-- gösterilen ekranlar son birkaç günü kullanıyor, geri kalanı yalnız disk ve
-- fatura. HAK61/Sendigo GERÇEK müşteri — orada saklama süresi hukuki bir konu
-- (§ 132 BAO) ve bu fonksiyon oralarda ASLA çalıştırılmamalıdır.
--
-- ═══ NE SİLİNİR, NE SİLİNMEZ ═══
--
-- SİLİNİR : public.device_telemetry — HAM cihaz akışı. Yeniden üretilebilir,
--           türetilmiş hiçbir kaydın yabancı anahtarı buraya bakmaz.
-- SİLİNMEZ: time_entries (vardiya), vehicle_events (alarm), idle_episodes
--           (rölanti), shift_packages / driver_reports (sefer) ve diğer her şey.
--           Bunlar ham akıştan TÜRETİLMİŞ ama BAĞIMSIZ kayıtlardır; telemetri
--           silinince olduğu gibi kalırlar. Fonksiyon tek tabloya dokunur ve
--           tablo adı gövdede sabittir — parametreyle değiştirilemez.
--
-- ═══ NEDEN FONKSİYON, NEDEN TOPLU DEĞİL ═══
--
-- Tek `delete ... where recorded_at < x` 300 bin satırda statement timeout
-- (8 sn) yer ve HİÇBİR ŞEY silinmez — üstelik her denemede aynı işi baştan
-- yapar. Bu fonksiyon `p_limit` satırlık PARÇA siler ve sildiği sayıyı döner;
-- çağıran (cron rotası) tur tur ilerler, her tur kendi başına tamamlanmış bir
-- iştir. Yarıda kesilse bile veri tutarlı kalır.
--
-- ctid ile silme: birincil anahtar üzerinden IN listesi kurmaya gerek yok,
-- planlayıcı doğrudan satırı bulur. `order by recorded_at` EN ESKİDEN başlar.
--
-- ═══ GÜVENLİK ═══
--
-- p_days'in ALT SINIRI 7: çağıran hata yapıp 0 gönderse bile bugünün verisi
-- silinemez. Üst sınır yok (daha eskiyi tutmak zararsız).
-- Fonksiyon service_role ile çağrılır; rota ayrıca CRON_SECRET ve TENANT
-- kilidi uygular (app/api/cron/demo-retention/route.ts). Üç kapı da bağımsız.
--
-- Bu migration YALNIZ galzura-demo veritabanında çalıştırılır. HAK61 ve
-- Sendigo'da fonksiyon HİÇ VAR OLMAZ — rota oralarda 404 alır ve zaten tenant
-- kilidinden geçemez. İki katmanlı savunma bilinçlidir.

create or replace function public.purge_old_telemetry(
  p_days  int default 14,
  p_limit int default 20000
)
returns bigint
language plpgsql
volatile
as $$
declare
  v_cutoff timestamptz;
  v_deleted bigint;
begin
  -- Taban 7 gün: yanlış parametre bugünün verisini silemesin.
  v_cutoff := now() - make_interval(days => greatest(coalesce(p_days, 14), 7));

  with victims as (
    select ctid
    from public.device_telemetry
    where recorded_at < v_cutoff
    order by recorded_at
    limit greatest(coalesce(p_limit, 20000), 1)
  )
  delete from public.device_telemetry dt
  using victims v
  where dt.ctid = v.ctid;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

notify pgrst, 'reload schema';
