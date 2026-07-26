"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { changePinAction, type ChangePinState } from "../actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: ChangePinState = {};

export function ChangePinForm() {
  const t = useTranslations("changePin");
  const [state, formAction, pending] = useActionState(changePinAction, initial);

  const errMsg =
    state.error === "weak"
      ? t("errWeak")
      : state.error === "mismatch"
      ? t("errMismatch")
      : state.error === "same"
      ? t("errSame")
      : state.error === "db"
      ? t("errDb")
      : state.error === "validation"
      ? t("errValidation")
      : null;

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label
          htmlFor="pin"
          className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground"
        >{t("newPin")}</Label>
        <Input
          id="pin"
          name="pin"
          type="password"
          autoComplete="new-password"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          placeholder="••••••"
          className="btn-outline-ring h-12 rounded-[12px] border-0 bg-transparent text-base tracking-widest"
        />
      </div>
      <div className="space-y-2">
        <Label
          htmlFor="pin_confirm"
          className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground"
        >{t("confirmPin")}</Label>
        <Input
          id="pin_confirm"
          name="pin_confirm"
          type="password"
          autoComplete="new-password"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          placeholder="••••••"
          className="btn-outline-ring h-12 rounded-[12px] border-0 bg-transparent text-base tracking-widest"
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      {errMsg && (
        <p className="rounded-[12px] bg-status-critical-soft px-3.5 py-2.5 text-sm text-status-critical-text">
          {errMsg}
        </p>
      )}
      <Button type="submit" disabled={pending} className="btn-primary h-12 w-full rounded-full text-base font-semibold">
        {pending && <Loader2 className="size-4 animate-spin" />}
        {pending ? t("pending") : t("submit")}
      </Button>
    </form>
  );
}
