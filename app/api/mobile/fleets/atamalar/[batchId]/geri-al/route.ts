import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { uuidMu } from "@/lib/fleets";
import { undoFleetMove } from "@/lib/fleets-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/fleets/atamalar/[batchId]/geri-al — bir taşımayı geri al (099).
 *
 * Kapı requireMobileAdmin — kardeş filo uçlarıyla aynı katman. Filo şefi
 * giremez: geri alma da bir taşımadır ve şef karşı filodan araç çekemez.
 *
 * ── NEDEN `/fleets/[id]/…` ALTINDA DEĞİL ──────────────────────────────────
 * Geri alma bir FİLONUN işi değil, bir DOKUNUŞUN işidir. Yol `/fleets/mavi/…`
 * olsaydı istemcinin hedef filoyu hatırlaması gerekirdi — oysa geri almanın
 * anlamı tam da "hedefi unut, eski hâline dön". Kaldı ki bir batch birden çok
 * KAYNAK filodan araç taşımış olabilir; tek bir filoya bağlamak yanlış olurdu.
 *
 * ⚠️ `atamalar` STATİK parçası `[id]` ile aynı seviyede duruyor. Next.js'te
 * statik parça kazanır, yani kodu tam olarak "atamalar" olan bir filo bu yolu
 * gölgelerdi. Kodlar sunucu üretiyor ve kümesi kapalı (bordo · mavi · filo3-5,
 * lib/fleets.ts filoKoduUret), dolayısıyla çakışma MÜMKÜN DEĞİL.
 *
 * ── DURUM KODLARI ─────────────────────────────────────────────────────────
 *   404 not_found  — böyle bir batch yok (şekli bozuk kimlik de buraya düşer)
 *   409 conflict   — batch var ama TÜMÜ zaten geri alınmış
 *   200            — geri alma DENENDİ; sonuç satır satır yanıtta
 *   503 db_error   — `sebep:"iz_yok"` ise migration 099 çalıştırılmamış
 *
 * ⚠️ "HEPSİ ATLANDI" 409 DEĞİL 200. Batch'te geri alınmamış satır varsa istek
 * anlamlıydı ve çalıştı; yalnız dünya değişmişti. 409 "bu istek anlamsız"
 * demektir. İkisini aynı koda toplamak, istemciye "tekrar dene" ile "araçlar
 * elden gitti"yi ayırt ettirmezdi — yanıt `geriAlindi` boş, `atlandi` dolu der.
 *
 * ⚠️ HIZ SINIRI (rate limit) YOK — kardeş filo uçlarıyla aynı durum.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { batchId } = await params;

  // Şekli bozuk kimlik 404: "böyle bir taşıma yok" doğru cevap. 400 deseydik
  // var olmayan bir kimlikle bozuk bir kimlik farklı cevaplar alırdı ve
  // istemci ikisini ayırt etmek zorunda kalırdı — ayrımın bir karşılığı yok.
  if (!uuidMu(batchId)) return mobileError(404, "not_found");

  const sonuc = await undoFleetMove(batchId.trim(), guard.actor.worker.id);
  if (!sonuc.ok) {
    if (sonuc.sebep === "yok") return mobileError(404, "not_found");
    if (sonuc.sebep === "zaten_geri_alindi") {
      return mobileError(409, "conflict", { sebep: "zaten_geri_alindi" });
    }
    // "Fonksiyon yok" ≠ "yazma başarısız": ilki 099'un çalıştırılmadığı
    // kurulumdur ve yöneticiye BAŞKA iş yaptırır (059'un tablo_yok'u gibi).
    return mobileError(503, "db_error", { sebep: sonuc.sebep });
  }

  return Response.json({
    ok: true,
    batchId,
    geriAlindi: sonuc.geriAlindi,
    // Sessiz eksik YASAK: geri alınamayan araç "geri alındı" sayılmaz, ayrı
    // listede ve ŞU ANDAKİ filosuyla döner — yönetici neyin elden gittiğini
    // görsün.
    atlandi: sonuc.atlandi,
  });
}
