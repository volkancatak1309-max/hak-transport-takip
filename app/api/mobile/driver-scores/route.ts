import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { parsePage, pageInfo } from "@/lib/mobile-list";
import { buildPerformanceReport } from "@/lib/reports";
import { SAFETY_SCORE_CALIBRATED } from "@/lib/tenant";
import {
  DONEMLER,
  donemCoz,
  donemGovdesi,
  performansSatiri,
  siraHaritasi,
} from "../_performans/donem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/driver-scores?donem=gun|hafta|ay&tarih=YYYY-MM-DD
 *
 * Sürücü performans raporunun mobil karşılığı — panelin
 * /admin/raporlar/performans sayfasıyla AYNI sayı, aynı sıra.
 *
 * ── TEK KAYNAK: buildPerformanceReport ────────────────────────────────────
 * Satırlar `lib/reports.ts`ten OLDUĞU GİBİ gelir. Burada hiçbir metrik yeniden
 * hesaplanmaz: ne km, ne çalışma süresi, ne güvenlik skoru, ne ihlal sayısı.
 * Sebep dosyanın kendi başlığında yazılı — skor Analiz sayfasının
 * computeSafetyScores çıktısının aynısıdır ve iki yüzey aynı şoför için farklı
 * karar veremez. Mobil ikinci bir hesap açsaydı üçüncü bir sayı doğardı.
 *
 * Bu aynı zamanda ELEMELERİ de miras alır: test hesabı (028), yönetici
 * (lib/driver-scope.ts) ve yönetici hesabından açılmış demo vardiyalar rapora
 * girmez. Ucun kendi filtresi YOK ve olmamalı.
 *
 * ── KAPI: requireMobileAdmin ──────────────────────────────────────────────
 * Panelde /admin/raporlar requireAdmin() ile korunuyor; filo şefi ve şoför
 * oraya giremiyor. Burada da 403 `admin_required` alırlar. Şefin kendi
 * filosunun performansını görmesi AYRI bir karardır (farklı kapı, farklı
 * kapsam) ve bu turun kapsamında değil.
 *
 * ── PATRON KAPSAMI NEDEN YOK ──────────────────────────────────────────────
 * Bilerek. Bu bir KİMLİK yüzeyi değil, RAPOR yüzeyidir ve patron
 * (`is_admin=true, counts_as_driver=false`) lib/driver-scope.ts tarafından
 * rapordan ZATEN düşürülür. Aynı gerekçe scripts/check-owner-scope.mjs
 * başlığında ölçümle yazılı; muafiyet açılırsa (patron direksiyona geçerse)
 * buraya filtre EKLENMEMELİ — sürdüğü km'yi rapordan düşürmek raporu yanlış
 * yapar.
 *
 * ── SIRALAMA DEĞİŞİMİ: İKİ RAPOR, ARDIŞIK ─────────────────────────────────
 * Önceki dönemin sırası aynı yanıtta döner, yani rapor İKİ KEZ kurulur.
 * PARALEL ÇALIŞTIRILMIYOR: loadBase araç başına iki sorguyu mapBounded(6) ile
 * yürütüyor (lib/db-fanout.ts) ve iki raporu birlikte koşturmak o tavanı 12'ye
 * çıkarırdı. Ölçülmüş ders (lib/db-fanout.ts): statement timeout İFADEYE
 * uygulanır, eşzamanlılığı artırmak payı düşürür. Gecikme iki katına çıkıyor,
 * doğruluk ve zaman aşımı emniyeti kazanıyor.
 *
 * ── SKOR KALİBRASYONU YANITTA ─────────────────────────────────────────────
 * `skor.kalibre` = SAFETY_SCORE_CALIBRATED (lib/tenant.ts). Panel bu bayrak
 * kapalıyken skor kolonunu HİÇ göstermiyor (ve PDF'e de basmıyor): kalibre
 * edilmemiş bir sayı bir insan hakkında mutlak iddia taşır. Mobil de aynı
 * kararı verebilsin diye bayrak gövdede döner. Sayıyı burada gizlemiyoruz —
 * gizleseydik istemci "neden boş" diye soramazdı; bayrağı veriyoruz ki ekran
 * panelle aynı kararı BİLEREK versin.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const cozum = donemCoz(url);
  if (!cozum.ok) {
    // Geçerli küme yanıtta: istemci hangi değerin kabul edildiğini dokümana
    // bakmadan görsün (arıza uçlarıyla aynı sözleşme).
    return mobileError(400, cozum.kod, {
      ...(cozum.kod === "invalid_donem"
        ? { alan: "donem", gecerli: DONEMLER }
        : { alan: "tarih", bicim: "YYYY-MM-DD" }),
    });
  }
  const { cozum: d } = cozum;

  const rapor = await buildPerformanceReport(d.range);
  // Ardışık — yukarıdaki eşzamanlılık notu.
  const oncekiRapor = d.onceki ? await buildPerformanceReport(d.onceki) : null;

  const siralar = siraHaritasi(rapor.rows);
  const oncekiSiralar = oncekiRapor ? siraHaritasi(oncekiRapor.rows) : null;

  const tumSatirlar = rapor.rows.map((r) =>
    performansSatiri(
      r,
      siralar.get(r.workerId) ?? 0,
      oncekiSiralar?.get(r.workerId) ?? null
    )
  );

  // Sayfalama sıralamayı BOZMAZ: sıra tam liste üzerinden hesaplandı, dilim
  // ondan sonra alınıyor. `sira` alanı her zaman filo genelindeki sıradır.
  const page = parsePage(url);
  const satirlar = tumSatirlar.slice(page.offset, page.offset + page.limit);

  const yetersiz = rapor.rows.filter((r) => r.safetyScore === null).length;

  return Response.json({
    ok: true,
    donem: donemGovdesi(d),
    oncekiDonem: d.onceki
      ? {
          baslangic: d.onceki.start.toISOString(),
          bitis: d.onceki.end.toISOString(),
          /**
           * Önceki dönemde rapora giren şoför sayısı. Sıra kıyası ancak bu
           * sayı bilindiğinde okunur: kadro 12'den 30'a çıktıysa "3. sıradan
           * 8. sıraya düştü" bir kötüleşme değil, payda değişimidir.
           */
          satirSayisi: oncekiRapor?.rows.length ?? 0,
        }
      : null,
    skor: {
      /** false → panel skor kolonunu göstermiyor; istemci de göstermemeli. */
      kalibre: SAFETY_SCORE_CALIBRATED,
      ortalama: rapor.avgScore,
      skorlanan: rapor.scoredCount,
      /** safetyScore null olan şoför sayısı — "yetersiz veri". */
      yetersizVeri: yetersiz,
      soforSayisi: rapor.rows.length,
    },
    toplam: {
      vardiya: rapor.totalShifts,
      calismaMs: rapor.totalWorkedMs,
      km: rapor.totalKm,
    },
    satirlar,
    sayfa: pageInfo(page, tumSatirlar.length),
  });
}
