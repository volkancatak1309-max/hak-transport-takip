-- 061 — RÖLANTİ EPİZOD İMLEÇLERİ TEK SORGUYA (#84 Adım 2)
--
-- ═══ SORUN ═══
-- `saveIdleEpisodes` her araç için İKİ okuma yapıyor (lib/telemetry.ts):
--     getOpenEpisode(vehicleId)     → açık epizod (varsa)
--     latestClosedEndMs(vehicleId)  → son KAPALI epizodun bitiş anı
-- 29 araçta 58 gidiş-dönüş.
--
-- CANLIDA ÖLÇÜLDÜ (#84 sayacı, HAK61):
--     Adım 0 tabanı        : 169 sorgu/tur — idle_episodes 59
--     Adım 1 (migration 060): 141 sorgu/tur — idle_episodes HÂLÂ 59
-- Yani `idle_episodes` artık turun en büyük kalemi.
--
-- ═══ NEDEN SQL ═══
-- 060 ile aynı sebep: PostgREST "araç başına en yeni satır" kuramaz (GROUP BY
-- yok, DISTINCT ON yok). Bellekte gruplamak sessiz kırpmaya açık olurdu.
-- İki LATERAL, araç başına (vehicle_id, ended_at) indeksine birer seek yapar.
--
-- ═══ SÖZLEŞME ═══
-- Girdi : araç id listesi
-- Çıktı : HER araç için TEK satır (LEFT JOIN — açık epizodu ya da kapalı
--         epizodu olmayan araç da döner, ilgili alanları null).
--         open_id            : açık epizodun id'si, yoksa null
--         open_started_at    : açık epizodun başlangıcı
--         open_last_seen_at  : açık epizodun son doğrulanmış anı
--         latest_closed_end  : son KAPALI epizodun ended_at'i, yoksa null
--
-- `getOpenEpisode` açıklar arasında `started_at desc limit 1` alıyor; tekil
-- indeks zaten araç başına en fazla bir açık epizoda izin veriyor ama buradaki
-- sıralama o savunmacı davranışı BİREBİR taklit eder — davranış farkı kalmasın.
--
-- ═══ 23505 YARIŞ KORUMASI BU FONKSİYONA DEVREDİLMEZ ═══
-- `saveIdleEpisodes` içinde insert 23505 (tekil ihlal) alırsa açık epizodu
-- YENİDEN okuyor. O okuma CANLI kalmak ZORUNDA: yarışı kaybettiğimiz an
-- karşı tarafın az önce yazdığı satırı öğrenmek istiyoruz, tur başında
-- çekilmiş bayat bir değeri değil. Bu yüzden kod tarafında o çağrı
-- `getOpenEpisode(vehicleId)` olarak AYNEN kalır; bu fonksiyon yalnız tur
-- BAŞINDAKİ ilk okumayı toplulaştırır.
--
-- ═══ GERİYE UYUM ═══
-- Çalıştırılmasa da uygulama çalışır: toplu okuma null dönerse
-- `saveIdleEpisodes` araç-araç eski yola düşer ve davranış birebir aynı kalır
-- (060'ta canlıda kanıtlanan desen). Deploy sırası serbest.

create or replace function public.idle_episode_cursors_batch(
  p_vehicle_ids uuid[]
)
returns table (
  vehicle_id        uuid,
  open_id           uuid,
  open_started_at   timestamptz,
  open_last_seen_at timestamptz,
  latest_closed_end timestamptz
)
language sql
stable
as $$
  select
    v.id as vehicle_id,
    a.id            as open_id,
    a.started_at    as open_started_at,
    a.last_seen_at  as open_last_seen_at,
    k.ended_at      as latest_closed_end
  from unnest(p_vehicle_ids) as v(id)
  left join lateral (
    select ie.id, ie.started_at, ie.last_seen_at
    from public.idle_episodes ie
    where ie.vehicle_id = v.id
      and ie.ended_at is null
    order by ie.started_at desc
    limit 1
  ) as a on true
  left join lateral (
    select ie.ended_at
    from public.idle_episodes ie
    where ie.vehicle_id = v.id
      and ie.ended_at is not null
    order by ie.ended_at desc
    limit 1
  ) as k on true
$$;

comment on function public.idle_episode_cursors_batch(uuid[]) is
  'Senkron turunun rolanti imlecleri: arac basina acik epizod + son kapali bitis ani, TEK sorguda (#84 Adim 2). 23505 yaris korumasindaki yeniden okuma bunu KULLANMAZ, canli kalir.';
