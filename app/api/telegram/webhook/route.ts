import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";

// Telegram needs the webhook to live on the Node runtime (it uses the service
// role Supabase client). Never edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bot replies. Locale is known only after we resolve a link code; for generic
// replies we answer bilingually (drivers are TR, the business is AT/DE).
const MSG = {
  linkedSuccess: (locale: string) =>
    locale === "de"
      ? "✅ HAK Transport-Benachrichtigungen aktiviert!"
      : "✅ HAK Transport bildirimleriniz aktif!",
  invalidCode:
    "⚠️ Kod geçersiz veya süresi dolmuş. Lütfen panelden yeni bir kod alın.\n" +
    "⚠️ Code ungültig oder abgelaufen. Bitte holen Sie einen neuen Code im Panel.",
  needCode:
    "Lütfen HAK Transport panelinden eşleştirme kodunuzu alın.\n" +
    "Bitte holen Sie Ihren Verknüpfungscode aus dem HAK Transport-Panel.",
  help:
    "<b>HAK Transport</b>\n\n" +
    "Bu bot vardiya ve Lenkzeit bildirimleri gönderir.\n" +
    "Bağlamak için panelden kodunuzu alıp <code>/start &lt;kod&gt;</code> yazın.\n\n" +
    "Dieser Bot sendet Schicht- und Lenkzeit-Benachrichtigungen.\n" +
    "Zum Verknüpfen Code im Panel holen und <code>/start &lt;Code&gt;</code> senden.",
};

type TgUpdate = {
  message?: {
    chat?: { id?: number | string };
    from?: { username?: string };
    text?: string;
  };
};

export async function POST(req: NextRequest) {
  // Reject anything that doesn't carry our shared secret in the URL.
  const secret = req.nextUrl.searchParams.get("secret");
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  const text = (msg?.text ?? "").trim();
  if (!chatId || !text) return NextResponse.json({ ok: true });

  const chatIdStr = String(chatId);
  const username = msg?.from?.username ?? null;

  try {
    if (text.startsWith("/start")) {
      const code = text.split(/\s+/)[1]?.trim();

      if (!code) {
        await sendTelegramMessage(chatIdStr, MSG.needCode);
        return NextResponse.json({ ok: true });
      }

      const { data: link } = await supabaseAdmin
        .from("telegram_link_codes")
        .select("code, worker_id, locale, expires_at, used_at")
        .eq("code", code)
        .maybeSingle();

      const valid =
        link &&
        !link.used_at &&
        new Date(link.expires_at).getTime() > Date.now();

      if (!valid) {
        await sendTelegramMessage(chatIdStr, MSG.invalidCode);
        return NextResponse.json({ ok: true });
      }

      const locale = link.locale === "de" ? "de" : "tr";

      await supabaseAdmin
        .from("workers")
        .update({
          telegram_chat_id: chatIdStr,
          telegram_username: username,
          telegram_linked_at: new Date().toISOString(),
          telegram_locale: locale,
        })
        .eq("id", link.worker_id);

      await supabaseAdmin
        .from("telegram_link_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("code", code);

      await sendTelegramMessage(chatIdStr, MSG.linkedSuccess(locale));
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith("/help")) {
      await sendTelegramMessage(chatIdStr, MSG.help);
      return NextResponse.json({ ok: true });
    }

    // Anything else: nudge with help.
    await sendTelegramMessage(chatIdStr, MSG.help);
    return NextResponse.json({ ok: true });
  } catch {
    // Always 200 so Telegram doesn't retry-storm us on a transient error.
    return NextResponse.json({ ok: true });
  }
}
