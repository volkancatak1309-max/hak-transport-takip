import type { NextRequest } from "next/server";
import { requireMobileWorker } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/mobile/push/token — cihazın bildirim adresi.
 *
 *   POST   → kaydet/tazele (upsert)
 *   DELETE → sil (çıkışta)
 *
 * ── NEDEN KAPSAM DEĞİL, SADECE KİMLİK ──────────────────────────────────────
 * `requireMobileWorker`, `requireMobileWorkerScoped` DEĞİL: kişi yalnız KENDİ
 * cihazını kaydediyor ve `worker_id` GÖVDEDEN DEĞİL kapıdan geliyor. Filo
 * kapsamının burada söyleyeceği bir şey yok; şoför de yönetici de kendi
 * adresini yazar.
 *
 * ── JETON GÖVDEDEN GELİR, KİMLİK GELMEZ ────────────────────────────────────
 * İstemci `worker_id` gönderemez. Gönderebilseydi, bir kullanıcı başkasının
 * kimliğine kendi cihazını bağlayıp o kişinin bütün mesajlarını okurdu.
 * Bu uçtaki tek kural budur.
 */

/** "ExponentPushToken[...]" — Expo'nun ürettiği biçim. */
const JETON_BICIMI = /^ExponentPushToken\[[^\]\s]+\]$/;

function jetonCoz(ham: unknown): { ok: true; token: string } | { ok: false; code: string } {
  if (typeof ham !== "string") return { ok: false, code: "token_required" };
  const t = ham.trim();
  if (t.length === 0) return { ok: false, code: "token_required" };
  /**
   * Biçim DOĞRULANIYOR çünkü bu değer doğrudan Expo'nun gönderim ucuna
   * gidiyor. Serbest metin kabul etmek, tabloyu çöple doldurup her gönderimde
   * hata almaya yol açardı. Kısıt SQL'de değil burada: biçim Expo'nun ve
   * değişebilir — şemaya çakmak ileride sessizce kayıt düşürürdü (074 notu).
   */
  if (!JETON_BICIMI.test(t)) return { ok: false, code: "token_invalid" };
  return { ok: true, token: t };
}

async function govde(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;

  const inp = await govde(req);
  if (!inp) return mobileError(400, "invalid_json");

  const j = jetonCoz(inp.token);
  if (!j.ok) return mobileError(400, j.code);

  const platform = inp.platform;
  if (platform !== "ios" && platform !== "android") {
    return mobileError(400, "platform_invalid");
  }

  const cihazAdi = typeof inp.cihazAdi === "string" ? inp.cihazAdi.slice(0, 120) : null;

  /**
   * UPSERT — çatışma `token` üzerinde.
   *
   * `worker_id` DE GÜNCELLENİYOR: ortak telefonda ikinci kullanıcı adresi
   * devralır ve önceki kişi o cihazdan düşer (074'ün gerekçesi).
   */
  const { error } = await supabaseAdmin.from("push_tokens").upsert(
    {
      token: j.token,
      worker_id: guard.actor.worker.id,
      platform,
      device_name: cihazAdi,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" }
  );

  if (error) return mobileError(500, "write_failed", { detail: error.message });

  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;

  const inp = await govde(req);
  if (!inp) return mobileError(400, "invalid_json");

  const j = jetonCoz(inp.token);
  if (!j.ok) return mobileError(400, j.code);

  /**
   * `worker_id` KOŞULU ŞART: yoksa herhangi bir oturum, bildiği bir jetonu
   * silerek başka birinin bildirimlerini kapatabilirdi. Jeton tahmin edilebilir
   * değil ama yetki kontrolünü tahmin zorluğuna bırakmak kural değildir.
   *
   * Satır yoksa yine 200: çıkış yolu "zaten silinmiş" diye HATA VERMEMELİ.
   */
  const { error } = await supabaseAdmin
    .from("push_tokens")
    .delete()
    .eq("token", j.token)
    .eq("worker_id", guard.actor.worker.id);

  if (error) return mobileError(500, "write_failed", { detail: error.message });

  return Response.json({ ok: true });
}
