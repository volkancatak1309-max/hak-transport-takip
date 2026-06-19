import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time secret comparison. Hashing both sides first makes the compare
 * independent of input length (so it leaks neither the secret nor its length
 * via timing) and keeps the buffers equal-length for timingSafeEqual. Use for
 * webhook/cron shared secrets instead of `===`.
 */
export function safeEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (a == null || b == null) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
