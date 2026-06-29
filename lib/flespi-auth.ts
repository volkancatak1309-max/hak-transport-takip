import "server-only";
import type { NextRequest } from "next/server";
import { safeEqual } from "@/lib/secure-compare";

/**
 * Shared auth for the flespi endpoints (REST sync + stream ingest). Accepts the
 * secret as `?secret=` (external cron / flespi stream URL) or
 * `Authorization: Bearer <secret>` (Vercel cron). Comparison is timing-safe.
 * Requires FLESPI_SYNC_SECRET to be set; returns false otherwise.
 */
export function flespiAuthorized(req: NextRequest): boolean {
  const expected = process.env.FLESPI_SYNC_SECRET;
  if (!expected) return false;
  const qs = req.nextUrl.searchParams.get("secret");
  if (safeEqual(qs, expected)) return true;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return safeEqual(auth.slice(7), expected);
  return false;
}
