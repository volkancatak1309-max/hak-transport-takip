import type { NextRequest } from "next/server";
import { requireMobileWorker } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { workedMs } from "@/lib/format";
import { breakTargetMin } from "@/lib/break-rules";
import { PACKAGES_ENABLED } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/shifts/current — ŞOFÖRÜN AÇIK VARDİYASI.
 *
 * Şoför ekranının açılışta çektiği TEK uç: kapatma formunu çizmek için gereken
 * her şey burada. `GET /api/mobile/shifts` (liste) bu işi yapamazdı — orada
 * sayfalama, tarih penceresi ve yönetici/şef kapsamı var; şoför ekranının
 * sorusu ise tek ve dar: "şu an açık vardiyam var mı, varsa hangisi".
 *
 * ── AÇIK VARDİYA YOKSA HATA DEĞİL ───────────────────────────────────────────
 * `vardiya: null` + HTTP 200. Vardiyası olmayan şoför bir arıza durumu değil,
 * günün normal hâli (henüz başlamamış ya da kapatmış). 404 döndürmek istemciyi
 * hata yoluna sokar ve "bugün işim yok" ekranını hata ekranı gibi gösterirdi.
 *
 * ── TÜRETİLMİŞ ALANLAR PANELİN FONKSİYONLARIYLA ─────────────────────────────
 * `calisilanMs` = workedMs() (lib/format.ts) — panelin kullandığı aynı
 * fonksiyon. `molaHedefDk` = breakTargetMin() (lib/azg-rules.ts üzerinden) —
 * 9 saati aşan vardiyada 45 dakikaya çıkan AZG kademesi. İkisi de burada
 * YENİDEN HESAPLANMADI; kopyalansaydı panelde 30, telefonda 45 yazabilirdi.
 *
 * ── SAAT ────────────────────────────────────────────────────────────────────
 * `sunucuAni` dönüyor: istemci geçen süreyi kendi saatiyle değil bu ana göre
 * ilerletmeli. Telefonun saati kayıksa sayaç yanlış başlar (mola sayacında
 * yaşandı, bkz. mola-sayaci notu).
 *
 * ── KAPI ────────────────────────────────────────────────────────────────────
 * `requireMobileWorker` — vardiya TOKEN'DAKİ kişinin. Sorgu `worker_id`'ye
 * anahtarlı; sorgu parametresiyle başkasının vardiyası istenemez.
 * Direksiyona geçmeyen yönetici (`is_admin && !counts_as_driver`) kapatma
 * ucuyla AYNI cümleyle 403 alır: ikisi tek akışın iki ucu, biri açıkken
 * diğerinin kapalı olması tutarsız olurdu.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;
  const { worker } = guard.actor;

  if (worker.is_admin && !worker.counts_as_driver) {
    return mobileError(403, "not_a_driver");
  }

  const { data, error } = await supabaseAdmin
    .from("time_entries")
    // ⚠️ TEK DİZGE — parçalayıp `+` ile birleştirmeyin. PostgREST tipleri
    // select'in LİTERAL metninden türetiyor; birleştirilmiş dizge `string`e
    // düşer ve dönen satır `GenericStringError` olur (tsc, 22.08.2026).
    .select("id, started_at, break_minutes, break_started_at, start_package_count, plate, vehicle_id, auto_started, confirmation_status, notes")
    .eq("worker_id", worker.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // FAIL-CLOSED: okuma başarısızsa "vardiyan yok" DEMEYİZ. Öyle deseydik şoför
  // açık vardiyasını kapatamadan gününü bitirir ve bunu kimse fark etmezdi.
  if (error) return mobileError(503, "db_error");

  const simdi = Date.now();

  if (!data) {
    return Response.json({
      ok: true,
      vardiya: null,
      paketModulu: PACKAGES_ENABLED,
      sunucuAni: new Date(simdi).toISOString(),
    });
  }

  // Araç plakası: vardiya satırındaki `plate` donmuş kopyadır (araç sonradan el
  // değiştirse bile o vardiyanın plakası değişmesin). Boşsa araçtan okunur.
  let plaka = (data.plate as string | null) ?? null;
  if (!plaka && data.vehicle_id) {
    const { data: v } = await supabaseAdmin
      .from("vehicles")
      .select("plate")
      .eq("id", data.vehicle_id as string)
      .maybeSingle();
    plaka = (v?.plate as string | null) ?? null;
  }

  const calisilanMs = workedMs(
    {
      started_at: data.started_at as string,
      ended_at: null,
      break_minutes: (data.break_minutes as number | null) ?? null,
    },
    simdi
  );

  return Response.json({
    ok: true,
    vardiya: {
      id: data.id,
      baslangic: data.started_at,
      calisilanMs,
      otomatikBasladi: data.auto_started === true,
      onayDurumu: data.confirmation_status ?? null,
      not: (data.notes as string | null) ?? null,
      arac: { id: data.vehicle_id ?? null, plaka },
      mola: {
        /** null = molada değil. Dolu ise mola bu anda başladı. */
        basladi: (data.break_started_at as string | null) ?? null,
        birikenDk: (data.break_minutes as number | null) ?? 0,
        /** AZG kademesi — 9 saati aşan vardiyada 45'e çıkar. */
        hedefDk: breakTargetMin(calisilanMs),
      },
      /**
       * Paket modülü kapalı kiracıda null: alan SORULMAZ ve kapatma ucu da
       * onu zorunlu tutmaz. 0 döndürmek "sayıldı, sıfır çıktı" demek olurdu.
       */
      paket: PACKAGES_ENABLED
        ? { alinan: (data.start_package_count as number | null) ?? null }
        : null,
    },
    paketModulu: PACKAGES_ENABLED,
    sunucuAni: new Date(simdi).toISOString(),
  });
}
