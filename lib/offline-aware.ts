"use client";

import {
  enqueueAction,
  getPendingActions,
  removeAction,
  type QueuedActionType,
} from "./offline-queue";
import { processQueuedShift } from "@/app/actions/offline";

function registerBackgroundSync() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => {
      const sync = (reg as unknown as { sync?: { register: (t: string) => Promise<void> } })
        .sync;
      return sync?.register("hak-flush");
    })
    .catch(() => {
      /* background sync unsupported — online-event flush still covers it */
    });
}

export type TryResult<T> =
  | { queued: true }
  | { queued: false; result: T };

/**
 * Runs a server action when online; on offline / network failure the event is
 * persisted to IndexedDB and replayed later (online event or background sync).
 */
export async function tryServerAction<T>(
  type: QueuedActionType,
  payload: Record<string, unknown>,
  clientTime: string,
  onlineFn: () => Promise<T>
): Promise<TryResult<T>> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    await enqueueAction({ type, payload, clientTime });
    registerBackgroundSync();
    return { queued: true };
  }
  try {
    const result = await onlineFn();
    return { queued: false, result };
  } catch {
    await enqueueAction({ type, payload, clientTime });
    registerBackgroundSync();
    return { queued: true };
  }
}

/** Sends everything pending. Returns how many were successfully flushed. */
export async function flushQueue(): Promise<number> {
  const items = await getPendingActions();
  let sent = 0;
  for (const item of items) {
    try {
      const res = await processQueuedShift({
        type: item.type,
        payload: item.payload,
        clientTime: item.clientTime,
      });
      if (res.ok) {
        if (item.id != null) await removeAction(item.id);
        sent++;
      } else {
        // permanent failure (e.g. validation) — drop it so it doesn't wedge the queue
        if (item.id != null) await removeAction(item.id);
      }
    } catch {
      // transport failed again — stop, retry on next online event
      break;
    }
  }
  return sent;
}
