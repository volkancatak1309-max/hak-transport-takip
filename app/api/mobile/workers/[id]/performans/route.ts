import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getOwnerScope } from "@/lib/owner-scope";
import { getDriverScope } from "@/lib/driver-scope";
import { buildPerformanceReport } from "@/lib/reports";
import { SAFETY_SCORE_CALIBRATED } from "@/lib/tenant";
import {
  DONEMLER,
  donemCoz,
  donemGovdesi,
  performansSatiri,
  siraHaritasi,
} from "../../../_performans/donem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/workers/[id]/performans?donem=gun|hafta|ay&tarih=YYYY-MM-DD
 *
 * Tek şoförün performans satırı + ihlal kırılımı. `/driver-scores`in aynı
 * çekirdeğinden (app/api/mobile/_performans/donem.ts) beslenir; dönem dili,
 * sıra hesabı ve satır biçimi ORTAK. Aynı şoför iki ekranda farklı sayı
 * gösteremez.
 *
 * ── ⚠️ İHLAL KIRILIMI ALARM UCUNDAN TÜRETİLMEZ ────────────────────────────
 * `satir.ihlal` doğrudan `PerformanceRow`un alanlarıdır (harshBraking /
 * harshAcceleration / overspeeding / events). `/api/mobile/alarms`ten
 * SAYILMAZ ve sayılmamalıdır: alarm satırındaki şoför adı olayın yaşandığı
 * andaki sürücü değil, ARACIN BUGÜNKÜ atanmış şoförüdür — türetilmiş bir
 * ayna. Geçen ayın ihlalini bu ay o aracı devralan kişiye yazmak yanlış
 * insanı suçlar. Bu uç böyle bir yol açmıyor; açılırsa sayı "çalışır" görünür
 * ama kişi yanlıştır ve hata hiçbir yerde kırmızıya dönmez.
 *
 * ── ÜÇ AYRI "SATIR YOK" DURUMU, ÜÇ AYRI CEVAP ─────────────────────────────
 * `durum` alanı hangisi olduğunu söyler; hepsini 404'e ya da boş satıra
 * indirmek yöneticiye "sistem bozuk" dedirtirdi:
 *   • `var`         — satır bulundu.
 *   • `veri_yok`    — kişi ŞOFÖR ve KAYIT VAR, ama bu dönemde ne vardiyası ne
 *                     olayı var. buildPerformanceReport böyle satırları
 *                     bilerek atar (0'larla dolu satır "çalışmadı" ile "veri
 *                     yok"u karıştırır). 200 döner: kişi duruyor, dönem boş.
 *   • `sofor_degil` — kişi yönetici ya da test hesabı (lib/driver-scope.ts).
 *                     Şoför metriklerinde HİÇ yer almaz; "veri yok" demek
 *                     yarın veri geleceğini ima ederdi, gelmeyecek.
 *
 * ── KAPI ve PATRON ────────────────────────────────────────────────────────
 * requireMobileAdmin — kardeşi `/workers/[id]` ile aynı katman. Patron dosyası
 * is_owner olmayana KAPALI (045): 404 döner, 403 DEĞİL — 403 kaydın var
 * olduğunu doğrulardı. Kardeş uçtaki kuralın aynısı.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const url = new URL(req.url);
  const cozum = donemCoz(url);
  if (!cozum.ok) {
    return mobileError(400, cozum.kod, {
      ...(cozum.kod === "invalid_donem"
        ? { alan: "donem", gecerli: DONEMLER }
        : { alan: "tarih", bicim: "YYYY-MM-DD" }),
    });
  }
  const { cozum: d } = cozum;

  // Kişi GERÇEKTEN var mı — yoksa 404. Rapordan satır çıkmaması ile kaydın
  // olmaması AYRI şeyler ve karıştırılırsa yönetici silinmiş bir kişiyi
  // "bu hafta çalışmamış" sanır.
  const { data: w } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_admin, counts_as_driver")
    .eq("id", id)
    .maybeSingle();
  if (!w) return mobileError(404, "not_found");

  const ownerScope = await getOwnerScope(guard.actor.worker.id);
  if (!ownerScope.isVisible(id)) return mobileError(404, "not_found");

  const driverScope = await getDriverScope();
  const soforMu = driverScope.isDriver(id);

  // Şoför değilse raporu HİÇ kurmuyoruz: iki ağır rapor koşup satır
  // bulunamadığını görmek, cevabı değiştirmeden onlarca sorgu harcamaktır.
  if (!soforMu) {
    return Response.json({
      ok: true,
      personel: {
        id: w.id as string,
        adSoyad: w.name as string,
        soforSayilir: w.counts_as_driver === true,
      },
      donem: donemGovdesi(d),
      oncekiDonem: null,
      durum: "sofor_degil",
      satir: null,
      filo: null,
      skor: { kalibre: SAFETY_SCORE_CALIBRATED },
    });
  }

  const rapor = await buildPerformanceReport(d.range);
  // Ardışık, paralel değil — gerekçe /driver-scores başlığında (mapBounded tavanı).
  const oncekiRapor = d.onceki ? await buildPerformanceReport(d.onceki) : null;

  const satirlar = rapor.rows;
  const idx = satirlar.findIndex((r) => r.workerId === id);
  const oncekiSiralar = oncekiRapor ? siraHaritasi(oncekiRapor.rows) : null;

  const satir =
    idx === -1
      ? null
      : performansSatiri(satirlar[idx], idx + 1, oncekiSiralar?.get(id) ?? null);

  return Response.json({
    ok: true,
    personel: {
      id: w.id as string,
      adSoyad: w.name as string,
      soforSayilir: w.counts_as_driver === true,
    },
    donem: donemGovdesi(d),
    oncekiDonem: d.onceki
      ? {
          baslangic: d.onceki.start.toISOString(),
          bitis: d.onceki.end.toISOString(),
          satirSayisi: oncekiRapor?.rows.length ?? 0,
        }
      : null,
    durum: satir ? "var" : "veri_yok",
    satir,
    /**
     * SIRANIN PAYDASI. "4." tek başına bir şey söylemez; kaç kişi arasında
     * 4. olduğu ve filo ortalaması olmadan okunamaz.
     */
    filo: {
      soforSayisi: satirlar.length,
      ortalamaSkor: rapor.avgScore,
      skorlanan: rapor.scoredCount,
      yetersizVeri: satirlar.filter((r) => r.safetyScore === null).length,
    },
    skor: { kalibre: SAFETY_SCORE_CALIBRATED },
  });
}
