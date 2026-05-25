"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import {
  Menu,
  LogOut,
  X,
  ChevronDown,
  Sun,
  Moon,
  Globe,
  User as UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import { OfflineBadge } from "./OfflineBadge";
import { UserAvatar } from "./UserAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/app/actions/auth";
import { setLocaleAction } from "@/app/actions/preferences";

export type HeaderUser = {
  id: string;
  name: string;
  phone: string;
  isAdmin: boolean;
};

type Props = { user: HeaderUser | null };

export function Header({ user }: Props) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const locale = useLocale();
  const [localePending, startLocaleTransition] = useTransition();
  const logoutFormRef = useRef<HTMLFormElement>(null);

  const isDark = resolvedTheme === "dark";

  function flipTheme() {
    setTheme(isDark ? "light" : "dark");
  }
  function flipLocale() {
    const next = locale === "tr" ? "de" : "tr";
    startLocaleTransition(async () => {
      await setLocaleAction(next);
    });
  }
  function submitLogout() {
    logoutFormRef.current?.requestSubmit();
  }

  const navItems = user
    ? user.isAdmin
      ? [
          { href: "/admin", label: t("admin") },
          { href: "/admin/seferler", label: t("assignments") },
          { href: "/admin/harita", label: t("map") },
          { href: "/admin/workers", label: t("workers") },
          { href: "/admin/telegram", label: t("telegram") },
        ]
      : [{ href: "/panel", label: t("panel") }]
    : [];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6 min-w-0">
          <Link
            href={user ? (user.isAdmin ? "/admin" : "/panel") : "/"}
            className="flex items-center gap-2"
          >
            <Image
              src="/logo.png"
              alt="HAK Transport"
              width={120}
              height={34}
              priority
              className="h-7 w-auto dark:brightness-110"
            />
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium",
                    active
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1">
          <OfflineBadge />
          <LanguageToggle />
          <ThemeToggle />
          {user && (
            <>
              <div className="hidden md:block">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2 h-10 px-1.5 max-w-56"
                      />
                    }
                  >
                    <UserAvatar name={user.name} size="sm" />
                    <span className="truncate text-sm font-medium hidden lg:inline">
                      {user.name}
                    </span>
                    <ChevronDown className="size-4 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    {/* User info — plain block, NOT Menu.GroupLabel (avoids Base UI #31) */}
                    <div className="flex items-center gap-3 px-2 py-2">
                      <UserAvatar name={user.name} size="md" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium leading-tight truncate">
                          {user.name}
                        </span>
                        <span className="text-xs text-muted-foreground nums leading-tight truncate">
                          {user.phone}
                        </span>
                      </div>
                    </div>

                    {/* Theme + language as inline buttons (not Menu.Items → menu stays open) */}
                    <div className="flex items-center gap-2 px-2 pb-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1 justify-start gap-2"
                        onClick={flipTheme}
                        aria-label={tc("theme")}
                      >
                        {isDark ? (
                          <Sun className="size-4" />
                        ) : (
                          <Moon className="size-4" />
                        )}
                        <span className="text-xs">
                          {isDark ? tc("themeDark") : tc("themeLight")}
                        </span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1 justify-start gap-2"
                        onClick={flipLocale}
                        disabled={localePending}
                        aria-label={tc("language")}
                      >
                        <Globe className="size-4" />
                        <span className="text-xs nums">{locale.toUpperCase()}</span>
                      </Button>
                    </div>

                    <DropdownMenuSeparator />

                    {user.isAdmin && (
                      <DropdownMenuItem
                        onClick={() => router.push(`/admin/workers/${user.id}`)}
                      >
                        <UserIcon className="size-4" />
                        Profil
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuItem variant="destructive" onClick={submitLogout}>
                      <LogOut className="size-4" />
                      {tc("logout")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="md:hidden"
                onClick={() => setMobileOpen((v) => !v)}
                aria-label="Menu"
              >
                {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
              </Button>
            </>
          )}
        </div>
      </div>

      {mobileOpen && user && (
        <div className="md:hidden border-t border-border/60 bg-background">
          <nav className="mx-auto max-w-7xl px-4 py-3 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary"
              >
                {item.label}
              </Link>
            ))}
            {user.isAdmin && (
              <Link
                href={`/admin/workers/${user.id}`}
                onClick={() => setMobileOpen(false)}
                className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary"
              >
                Profil
              </Link>
            )}
            <div className="border-t border-border/60 pt-3 mt-3 flex items-center gap-3 px-3">
              <UserAvatar name={user.name} size="sm" />
              <div className="flex flex-col">
                <span className="text-sm font-medium leading-tight">
                  {user.name}
                </span>
                <span className="text-xs text-muted-foreground nums leading-tight">
                  {user.phone}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={submitLogout}
              className="w-full text-left rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10 flex items-center gap-2"
            >
              <LogOut className="size-4" /> {tc("logout")}
            </button>
          </nav>
        </div>
      )}

      {/* Programmatic logout target — survives BaseUI Menu portal handling */}
      <form ref={logoutFormRef} action={logoutAction} className="hidden" />
    </header>
  );
}
