import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

const API = "https://api.telegram.org";

function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

export function isTelegramConfigured(): boolean {
  return !!botToken();
}

/**
 * Send a Telegram message (HTML by default). Returns true on success.
 *
 * - Silently no-ops (returns false) if the bot token isn't configured, so the
 *   app keeps working without Telegram set up.
 * - If the chat is gone (403 = bot blocked, 400 = chat not found), the worker's
 *   link is cleared so we stop trying to reach a dead chat.
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: "HTML" | "MarkdownV2" | null = "HTML"
): Promise<boolean> {
  const token = botToken();
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        // `null` → omit parse_mode (plain text), so free-form addresses with
        // & or < don't break HTML parsing.
        ...(parseMode ? { parse_mode: parseMode } : {}),
        disable_web_page_preview: true,
      }),
    });
    if (res.ok) return true;

    const data = (await res.json().catch(() => null)) as { error_code?: number } | null;
    if (data?.error_code === 403 || data?.error_code === 400) {
      await supabaseAdmin
        .from("workers")
        .update({
          telegram_chat_id: null,
          telegram_username: null,
          telegram_linked_at: null,
        })
        .eq("telegram_chat_id", chatId);
    }
    return false;
  } catch {
    return false;
  }
}

export type WebhookInfo = {
  ok: boolean;
  url?: string;
  pendingUpdateCount?: number;
  lastErrorMessage?: string;
  lastErrorDate?: number;
};

export async function getWebhookInfo(): Promise<WebhookInfo> {
  const token = botToken();
  if (!token) return { ok: false };
  try {
    const res = await fetch(`${API}/bot${token}/getWebhookInfo`, { cache: "no-store" });
    const data = await res.json();
    if (!data?.ok) return { ok: false };
    return {
      ok: true,
      url: data.result?.url || "",
      pendingUpdateCount: data.result?.pending_update_count ?? 0,
      lastErrorMessage: data.result?.last_error_message,
      lastErrorDate: data.result?.last_error_date,
    };
  } catch {
    return { ok: false };
  }
}
