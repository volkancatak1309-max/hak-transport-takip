"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Menu, LogOut, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/app/actions/auth";

type Props = {
  user: { name: string; isAdmin: boolean } | null;
};

export function Header({ user }: Props) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const navItems = user
    ? user.isAdmin
      ? [
          { href: "/admin", label: t("admin") },
          { href: "/admin/workers", label: t("workers") },
        ]
      : [{ href: "/panel", label: t("panel") }]
    : [];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6 min-w-0">
          <Link href={user ? (user.isAdmin ? "/admin" : "/panel") : "/"} className="flex items-center gap-2">
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
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
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
          <LanguageToggle />
          <ThemeToggle />
          {user && (
            <>
              <div className="hidden md:block">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="sm" className="gap-2 max-w-40" />}
                  >
                    <User className="size-4" />
                    <span className="truncate text-sm">{user.name}</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-44">
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{user.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {user.isAdmin ? tc("admin") : tc("worker")}
                        </span>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => logoutAction()}
                      className="gap-2 text-destructive focus:text-destructive"
                    >
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
                onClick={() => setOpen((v) => !v)}
                aria-label="Menu"
              >
                {open ? <X className="size-5" /> : <Menu className="size-5" />}
              </Button>
            </>
          )}
        </div>
      </div>

      {open && user && (
        <div className="md:hidden border-t border-border/60 bg-background">
          <nav className="mx-auto max-w-7xl px-4 py-3 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary"
              >
                {item.label}
              </Link>
            ))}
            <div className="border-t border-border/60 pt-3 mt-3">
              <div className="px-3 py-1.5 text-xs text-muted-foreground">{user.name}</div>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="w-full text-left rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10 flex items-center gap-2"
                >
                  <LogOut className="size-4" /> {tc("logout")}
                </button>
              </form>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
