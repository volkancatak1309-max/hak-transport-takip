import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { brandCityLine } from "@/lib/brand";
import { DRIVER_PANEL_ENABLED } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function LoginShell() {
  const t = useTranslations("login");
  return (
    <div className="w-full max-w-[400px] page-enter">
      <div className="mb-8 flex flex-col items-center text-center">
        <BrandLogo height={68} className="mb-7" />
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{t("title")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* AUTHKIT'İN İMZA ANI — DNA'nın adını aldığı ekran bu. Sayfadaki TEK
          buzlu katman: altında ışık yıkaması var, cam derinliği oradan geliyor.
          Şoför paneli hafifletilmiş varyantta (blur yok); giriş ekranı tek
          statik karttır, en eski telefonda bile bir katman blur ucuzdur. */}
      <div className="glass-panel rounded-[20px] p-6 sm:p-8">
        <LoginForm />
      </div>

      <p className="mt-6 text-center text-xs text-text-tertiary">
        {brandCityLine()}
      </p>
    </div>
  );
}

export default async function LoginPage() {
  const session = await getSession();
  if (session.worker_id) {
    // Şoför paneli kapalı müşteride şoför rotası yok; oturumu olan herkes
    // yönetici yüzeyine gider (giriş zaten yalnız yöneticiye açık — auth.ts).
    redirect(session.is_admin || !DRIVER_PANEL_ENABLED ? "/admin" : "/panel");
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      {/* IŞIK YIKAMASI — iki katman: üstten bordo (filo kimliği), alttan mercan
          (birincil aksan). Camın "içinden bakılan" hissi tek renkli düz bir
          zeminde doğmaz; ışığın bir YÖNÜ olmalı (DESIGN.md §1). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          background:
            "radial-gradient(60rem 30rem at 50% -10%, var(--accent-claret-soft), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.28]"
        style={{
          background:
            "radial-gradient(40rem 24rem at 85% 110%, var(--accent-coral-soft), transparent 70%)",
        }}
      />
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <div className="relative z-10 w-full max-w-[400px]">
        <LoginShell />
      </div>
    </main>
  );
}
