import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { FILO_ADI_MAX, filoAdiniAyikla } from "@/lib/fleets";
import { renameFleet } from "@/lib/fleets-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/mobile/fleets/[id] — filoyu YENİDEN ADLANDIR (migration 059).
 *
 * Gövde `{ ad: string | null }`. Kapı requireMobileAdmin — kardeş uçlarla aynı.
 *
 * ── `[id]` FİLO KODUDUR ───────────────────────────────────────────────────
 * `/api/mobile/fleets/mavi`. Filonun kimliği zaten 30 araç satırında metin
 * olarak duran koddur; yanına ikinci bir uuid koymak, uçların migration
 * öncesi ve sonrası FARKLI kimlik kullanması demek olurdu (migration 059
 * dosyasındaki "neden ayrı uuid id yok" notu). Büyük/küçük harf ESNETİLMEZ:
 * "MAVI" 404 alır — sessizce düzeltmek istemcideki hatayı gizlerdi.
 *
 * ── NEDEN PATCH ───────────────────────────────────────────────────────────
 * Kaydın tek bir alanı değişiyor; kod, sıra ve oluşturma anı DOKUNULMAZ. PUT
 * "kaydın tamamını gönder" demektir ve istemcinin eski sırayı geri yazma
 * riskini doğururdu.
 *
 * ── BOŞ AD = VARSAYILANA DÖN ──────────────────────────────────────────────
 * `ad: ""` ya da `ad: null` adı SİLER; görünen ad yeniden türetilir (eski
 * filolarda i18n/env etiketi, yenilerde "N. Filo"). Alanın HİÇ gönderilmemesi
 * ise 400 `missing_fields` — yeniden adlandırma isteğinin tek yükü odur ve
 * yoksa uç hiçbir şey yapmadan "tamam" derdi.
 *
 * ── AYNI AD İKİNCİ KEZ ────────────────────────────────────────────────────
 * 200 + `degisti:false`, DB'ye dokunulmaz. Ekran gereksiz "adı değişti"
 * bildirimi göstermesin (aksiyon erteleme geri almasıyla aynı sözleşme).
 *
 * ── 059 ÇALIŞTIRILMADAN ───────────────────────────────────────────────────
 * 503 `db_error` + `sebep:"tablo_yok"`. Türetilmiş filonun adını yazacak bir
 * satır yok; "adlandırdım" deyip hiçbir şey yapmamak sessiz hiçlik olurdu.
 *
 * ⚠️ DELETE BU TURDA YOK — bilinçli. Bir filo silindiğinde içindeki araçların
 * ve şeflerin ne olacağı ayrı bir üründür (migration 059'un `on delete
 * restrict` kısıtı bugün silmeyi zaten reddeder).
 *
 * ⚠️ HIZ SINIRI (rate limit) YOK — kardeş uçlarla aynı durum.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }

  const ayikla = filoAdiniAyikla(body, { zorunlu: true });
  if (!ayikla.ok) {
    return mobileError(400, ayikla.kod, {
      alan: ayikla.alan,
      ...(ayikla.sebep ? { sebep: ayikla.sebep } : {}),
      ...(ayikla.kod === "too_long"
        ? { enFazla: FILO_ADI_MAX, uzunluk: ayikla.uzunluk }
        : {}),
    });
  }

  const sonuc = await renameFleet(id, ayikla.ad);
  if (!sonuc.ok) {
    // 404: kaydın varlığını doğrulamayan cevap (/shifts/[id] ile aynı gerekçe).
    if (sonuc.sebep === "yok") return mobileError(404, "not_found");
    return mobileError(503, "db_error", { sebep: sonuc.sebep });
  }

  return Response.json({
    ok: true,
    degisti: sonuc.degisti,
    filo: sonuc.filo,
  });
}
