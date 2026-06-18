import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  stillActiveMessage,
  stillActiveLabels,
  longShiftUnreachableMessage,
} from "@/lib/telegram-messages";

// Service-role Supabase + Telegram fetch → must run on Node, never edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A shift open this long (elapsed since started_at) starts getting the
// "still active?" prompt; the prompt is then repeated at most once per hour.
const ASK_AFTER_MS = 10 * 60 * 60 * 1000; // 10 h
const REASK_MS = 60 * 60 * 1000; // 1 h

/**
 * Ghost-shift watchdog. Triggered by an external scheduler (cron-job.org /
 * GitHub Actions) every ~15 min — it must run even when nobody has the panel
 * open, which the GPS-ping-based 9h alert cannot guarantee.
 *
 * For every shift open (ended_at IS NULL) longer than ASK_AFTER_MS, if we
 * haven't asked the driver in the last REASK_MS, send a Telegram message with
 * inline [Yes]/[No] buttons. The button taps are handled by the Telegram
 * webhook (callback_query): "Yes" resets the 1h timer, "No" closes the shift.
 * Drivers who aren't linked to Telegram are surfaced to the admins instead so
 * the shift is never silently stuck.
 *
 * Auth: requires CRON_SECRET, accepted either as `?secret=` (external cron) or
 * `Authorization: Bearer <secret>` (Vercel cron), so the trigger is swappable.
 */
function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const qs = req.nextUrl.searchParams.get("secret");
  if (qs && qs === expected) return true;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${expected}`;
}

async function runWatchdog() {
  const now = Date.now();
  const openCutoff = new Date(now - ASK_AFTER_MS).toISOString();

  // Open shifts that have already crossed the "ask" threshold.
  const { data: shiftRows } = await supabaseAdmin
    .from("time_entries")
    .select("id, worker_id, started_at, plate, still_active_asked_at")
    .is("ended_at", null)
    .lte("started_at", openCutoff);

  const shifts = shiftRows ?? [];
  // Only those we haven't asked about within the last hour.
  const due = shifts.filter((s) => {
    if (!s.still_active_asked_at) return true;
    return now - new Date(s.still_active_asked_at).getTime() >= REASK_MS;
  });

  if (due.length === 0) return { ok: true, open: shifts.length, due: 0, asked: 0, adminAlerts: 0 };

  // Resolve drivers (for chat id / locale / name).
  const workerIds = [...new Set(due.map((s) => s.worker_id).filter(Boolean))];
  const { data: workerRows } = await supabaseAdmin
    .from("workers")
    .select("id, name, telegram_chat_id, telegram_locale")
    .in("id", workerIds);
  const workers = new Map(
    (workerRows ?? []).map((w) => [w.id, w])
  );

  // Admins (fallback for unreachable drivers).
  const { data: adminRows } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_locale")
    .eq("is_admin", true)
    .not("telegram_chat_id", "is", null);
  const admins = adminRows ?? [];

  let asked = 0;
  let adminAlerts = 0;

  for (const s of due) {
    const w = s.worker_id ? workers.get(s.worker_id) : null;
    const openHours = ((now - new Date(s.started_at).getTime()) / 3_600_000)
      .toFixed(1)
      .replace(".", ",");

    if (w?.telegram_chat_id) {
      const loc = (w.telegram_locale as string) ?? null;
      const labels = stillActiveLabels(loc);
      await sendTelegramMessage(
        w.telegram_chat_id as string,
        stillActiveMessage(loc, { hours: openHours }),
        "HTML",
        [
          [
            { text: labels.yes, callback_data: `shift_yes:${s.id}` },
            { text: labels.no, callback_data: `shift_no:${s.id}` },
          ],
        ]
      );
      asked++;
    } else {
      // Driver not on Telegram → tell the admins so it isn't silently stuck.
      const name = (w?.name as string) ?? "—";
      const plate = (s.plate as string) ?? "—";
      for (const a of admins) {
        await sendTelegramMessage(
          a.telegram_chat_id as string,
          longShiftUnreachableMessage((a.telegram_locale as string) ?? null, {
            name,
            plate,
            hours: openHours,
          })
        );
      }
      adminAlerts++;
    }

    // Throttle: record that we asked now so we don't re-ask before REASK_MS.
    await supabaseAdmin
      .from("time_entries")
      .update({ still_active_asked_at: new Date().toISOString() })
      .eq("id", s.id);
  }

  return { ok: true, open: shifts.length, due: due.length, asked, adminAlerts };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await runWatchdog();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 }
    );
  }
}

// Allow POST too (some schedulers default to POST).
export async function POST(req: NextRequest) {
  return GET(req);
}
