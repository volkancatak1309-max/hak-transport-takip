import { NextResponse } from "next/server";
import { recordLocation } from "@/app/actions/location";

// sendBeacon posts a JSON string as text/plain; session cookie is sent automatically.
export async function POST(req: Request) {
  try {
    const text = await req.text();
    const data = JSON.parse(text) as { lat?: number; lng?: number; accuracy?: number | null };
    if (typeof data.lat !== "number" || typeof data.lng !== "number") {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    await recordLocation({ lat: data.lat, lng: data.lng, accuracy: data.accuracy ?? null });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
