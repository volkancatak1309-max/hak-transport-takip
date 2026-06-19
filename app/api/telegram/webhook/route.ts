import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { safeEqual } from "@/lib/secure-compare";
import { sendTelegramMessage, answerCallbackQuery } from "@/lib/telegram";
import {
  stillActiveConfirmedMessage,
  shiftClosedByWatchdogMessage,
} from "@/lib/telegram-messages";

// Telegram needs the webhook to live on the Node runtime (it uses the service
// role Supabase client). Never edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bot replies. Locale is known only after we resolve a link code; for generic
// replies we answer bilingually (drivers are TR, the business is AT/DE).
const MSG = {
  linkedSuccess: (locale: string) =>
    locale === "de"
      ? "✅ HAK61-Benachrichtigungen aktiviert!"
      : "✅ HAK61 bildirimleriniz aktif!",
  invalidCode:
    "⚠️ Kod geçersiz veya süresi dolmuş. Lütfen panelden yeni bir kod alın.\n" +
    "⚠️ Code ungültig oder abgelaufen. Bitte holen Sie einen neuen Code im Panel.",
  needCode:
    "Lütfen HAK61 panelinden eşleştirme kodunuzu alın.\n" +
    "Bitte holen Sie Ihren Verknüpfungscode aus dem HAK61-Panel.",
  help:
    "<b>HAK61</b>\n\n" +
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
  callback_query?: {
    id?: string;
    data?: string;
    message?: { chat?: { id?: number | string } };
  };
};

/**
 * Handle a tap on the "Is your shift still active?" inline buttons sent by the
 * watchdog. callback_data is `shift_yes:<id>` or `shift_no:<id>`. We only ever
 * act on a shift that belongs to THIS chat's worker and is still open, so one
 * driver can never close another's shift.
 */
async function handleShiftCallback(cb: NonNullable<TgUpdate["callback_query"]>) {
  const cbId = cb.id;
  const data = cb.data ?? "";
  const chatId = cb.message?.chat?.id;
  if (!cbId || !chatId) return;
  const chatIdStr = String(chatId);

  const m = /^shift_(yes|no):(.+)$/.exec(data);
  if (!m) {
    await answerCallbackQuery(cbId);
    return;
  }
  const action = m[1];
  const shiftId = m[2];

  // Resolve the worker behind this chat — and their locale for replies.
  const { data: worker } = await supabaseAdmin
    .from("workers")
    .select("id, telegram_locale")
    .eq("telegram_chat_id", chatIdStr)
    .maybeSingle();
  if (!worker) {
    await answerCallbackQuery(cbId);
    return;
  }
  const loc = (worker.telegram_locale as string) ?? null;

  // The shift must belong to this worker AND still be open.
  const { data: shift } = await supabaseAdmin
    .from("time_entries")
    .select("id, started_at")
    .eq("id", shiftId)
    .eq("worker_id", worker.id)
    .is("ended_at", null)
    .maybeSingle();
  if (!shift) {
    // Already closed elsewhere, or not theirs — acknowledge and stop.
    await answerCallbackQuery(cbId);
    return;
  }

  if (action === "yes") {
    // Keep it open; reset the 1h timer so the next prompt is an hour from now.
    await supabaseAdmin
      .from("time_entries")
      .update({ still_active_asked_at: new Date().toISOString() })
      .eq("id", shift.id);
    await answerCallbackQuery(cbId);
    await sendTelegramMessage(chatIdStr, stillActiveConfirmedMessage(loc));
    return;
  }

  // action === "no" → close the shift now. Prefer the last recorded location
  // time (more truthful than "now"), falling back to now if there is none.
  const { data: lastLoc } = await supabaseAdmin
    .from("driver_locations")
    .select("recorded_at")
    .eq("time_entry_id", shift.id)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const endedAt = lastLoc?.recorded_at ?? new Date().toISOString();

  await supabaseAdmin
    .from("time_entries")
    .update({
      ended_at: endedAt,
      summary_notified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", shift.id)
    .eq("worker_id", worker.id)
    .is("ended_at", null);

  await answerCallbackQuery(cbId);
  await sendTelegramMessage(chatIdStr, shiftClosedByWatchdogMessage(loc));
}

export async function POST(req: NextRequest) {
  // Reject anything that doesn't carry our shared secret. Preferred: Telegram's
  // own X-Telegram-Bot-Api-Secret-Token header (set via setWebhook secret_token,
  // so the secret never appears in the URL/logs). The legacy `?secret=` query is
  // still accepted as a fallback so the existing webhook keeps working until it
  // is re-registered. Comparison is timing-safe.
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const provided =
    req.headers.get("x-telegram-bot-api-secret-token") ??
    req.nextUrl.searchParams.get("secret");
  if (!expected || !safeEqual(provided, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Inline-button taps (watchdog "still active?" prompt) arrive as callback
  // queries, not messages. Handle them first.
  if (update.callback_query) {
    try {
      await handleShiftCallback(update.callback_query);
    } catch {
      // swallow — always 200 so Telegram doesn't retry-storm
    }
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
