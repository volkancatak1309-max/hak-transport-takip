import "server-only";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase";
import { readRequestContext } from "@/lib/request-context";
import { TENANT } from "@/lib/brand";

/**
 * ÇAĞRI KAYDI — her optimizasyon denemesi için bir satır.
 *
 * ═══ NEDEN `audit_log` (045) VE NEDEN ŞALTERSİZ ═══
 *
 * Görev "mevcut bir denetim/olay tablosu varsa oraya" diyor: `audit_log` var
 * ve 22.09.2026 hizalamasından beri ÜÇ kiracıda da kurulu. `action` serbest
 * metin (045'te CHECK yok) — yeni değer şema değişikliği istemiyor.
 *
 * `audit()` (lib/security-log.ts) güvenlik katmanı KAPALIYKEN hiçbir şey
 * yazmıyor ve bu onun sözleşmesi. Bu kayıt ise bir GÜVENLİK izi değil, bir
 * MALİYET/KULLANIM kaydı: rota modülü açık her kiracıda (katman kapalı olsa da)
 * "kim, ne zaman, kaç durak, hangi sağlayıcı, ne kadar" sorusu cevaplanabilmeli.
 * Modül kapalı kiracıda bu fonksiyon hiç çağrılmaz — HAK61/Sendigo'nun bugünkü
 * davranışı değişmez.
 *
 * ASLA fırlatmaz: kayıt yazılamadı diye kullanıcının işlemi düşmez (deponun
 * yerleşik deseni). Durak ADLARI ve koordinatları yazılmaz — yalnız sayılar.
 */

export type RotaCagriKaydi = {
  workerId: string | null;
  seferId: string;
  durak: number;
  saglayici: string | null;
  yedekKullanildi: boolean;
  /** Liste fiyatı üst sınırı (USD); kendi sunucumuzda 0. */
  maliyetUsd: number;
  rotaIstegi: number;
  sonuc: string;
  sureMs: number;
};

export async function rotaCagrisiKaydet(k: RotaCagriKaydi): Promise<void> {
  try {
    let ip: string | null = null;
    try {
      ip = readRequestContext(await headers()).ip;
    } catch {
      /* istek kapsamı yok (betik) — ip boş kalır */
    }
    const { error } = await supabaseAdmin.from("audit_log").insert({
      worker_id: k.workerId,
      action: "rota_optimizasyonu",
      target: `sefer:${k.seferId}`,
      meta: {
        kiraci: TENANT,
        durak: k.durak,
        saglayici: k.saglayici,
        yedek: k.yedekKullanildi,
        maliyetUsd: k.maliyetUsd,
        rotaIstegi: k.rotaIstegi,
        sonuc: k.sonuc,
        sureMs: k.sureMs,
      },
      ip,
    });
    if (error) console.warn(`[rota] çağrı kaydı yazılamadı: ${error.code ?? ""} ${error.message}`);
  } catch (e) {
    console.warn(`[rota] çağrı kaydı yazılamadı: ${String(e).slice(0, 120)}`);
  }
}
