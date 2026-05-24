import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { redirect } from "next/navigation";
import type { SessionData } from "./types";

const password = process.env.SESSION_PASSWORD;
if (!password || password.length < 32) {
  throw new Error("SESSION_PASSWORD .env.local içinde tanımlı ve en az 32 karakter olmalı.");
}

export const sessionOptions: SessionOptions = {
  password,
  cookieName: "hak_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export async function requireWorker() {
  const session = await getSession();
  if (!session.worker_id) redirect("/");
  return session;
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session.worker_id) redirect("/");
  if (!session.is_admin) redirect("/panel");
  return session;
}
