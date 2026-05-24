"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions/auth";

const initial: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initial);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="phone" className="label">
          Telefon Numarası
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          required
          placeholder="+43 699 1234567"
          className="input input-lg"
        />
      </div>
      <div>
        <label htmlFor="pin" className="label">
          PIN (4 hane)
        </label>
        <input
          id="pin"
          name="pin"
          type="password"
          autoComplete="current-password"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          required
          placeholder="••••"
          className="input input-lg tracking-widest"
        />
      </div>
      {state.error && (
        <p className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary btn-lg w-full">
        {pending ? "Giriş yapılıyor…" : "Giriş Yap"}
      </button>
    </form>
  );
}
