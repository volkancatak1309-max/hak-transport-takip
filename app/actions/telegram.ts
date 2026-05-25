"use server";

import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWorker } from "@/lib/session";
import { getLocale } from "@/i18n/request";
import { sendTelegramMessage } from "@/lib/telegram";
import { lenkzeitMessage } from "@/lib/telegram-messages";

export type LinkCodeResult =
  | { ok: true; code: string; deepLink: string; qrDataUrl: string }
  | { ok: false; error: string };

function sixDigit(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Create a one-time 6-digit linking code for the current user and return a
 * QR code + deep link pointing at the bot. Replaces any previous unused code
 * for this user so only the latest is valid.
 */
export async function createTelegramLinkCode(): Promise<LinkCodeResult> {
  const session = await requireWorker();
  const locale = await getLocale();

  const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  if (!username) return { ok: false, error: "not_configured" };

  // Keep one active code per user.
  await supabaseAdmin
    .from("telegram_link_codes")
    .delete()
    .eq("worker_id", session.worker_id!);

  let code = "";
  let inserted = false;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    code = sixDigit();
    const { error } = await supabaseAdmin.from("telegram_link_codes").insert({
      code,
      worker_id: session.worker_id!,
      locale,
    });
    if (!error) inserted = true;
  }
  if (!inserted) return { ok: false, error: "code_generation" };

  const deepLink = `https://t.me/${username}?start=${code}`;
  const qrDataUrl = await QRCode.toDataURL(deepLink, { width: 240, margin: 1 });

  return { ok: true, code, deepLink, qrDataUrl };
}

export async function unlinkTelegram(): Promise<{ ok: boolean }> {
  const session = await requireWorker();
  await supabaseAdmin
    .from("workers")
    .update({
      telegram_chat_id: null,
      telegram_username: null,
      telegram_linked_at: null,
    })
    .eq("id", session.worker_id!);

  revalidatePath("/panel");
  revalidatePath("/admin/telegram");
  return { ok: true };
}

/**
 * Lenkzeit 4.5h warning → the driver's own Telegram. Called from the client
 * timer. Sends at most once per shift (guarded by lenkzeit_notified_at).
 */
export async function notifyLenkzeit(timeEntryId: string): Promise<{ ok: boolean }> {
  const session = await requireWorker();

  // Claim the one-shot guard atomically: only the call that flips NULL -> now wins.
  const { data: claimed } = await supabaseAdmin
    .from("time_entries")
    .update({ lenkzeit_notified_at: new Date().toISOString() })
    .eq("id", timeEntryId)
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .is("lenkzeit_notified_at", null)
    .select("id");

  if (!claimed || claimed.length === 0) return { ok: true };

  const { data: me } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_locale")
    .eq("id", session.worker_id!)
    .maybeSingle();

  if (me?.telegram_chat_id) {
    await sendTelegramMessage(
      me.telegram_chat_id as string,
      lenkzeitMessage((me.telegram_locale as string) ?? null)
    );
  }
  return { ok: true };
}

export async function getMyTelegramStatus(): Promise<{
  linked: boolean;
  username: string | null;
}> {
  const session = await requireWorker();
  const { data } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_username")
    .eq("id", session.worker_id!)
    .maybeSingle();

  return {
    linked: !!data?.telegram_chat_id,
    username: (data?.telegram_username as string) ?? null,
  };
}
