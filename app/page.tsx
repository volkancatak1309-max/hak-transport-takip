import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { getSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function LoginShell() {
  const t = useTranslations("login");
  return (
    <Card className="w-full max-w-md border-border/60 shadow-lg page-enter">
      <CardHeader className="text-center space-y-3">
        <div className="flex justify-center">
          <Image
            src="/logo.png"
            alt="HAK Transport"
            width={180}
            height={50}
            priority
            className="h-10 w-auto dark:brightness-110"
          />
        </div>
        <div>
          <CardTitle className="text-xl">{t("title")}</CardTitle>
          <CardDescription className="mt-1">{t("subtitle")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  );
}

export default async function LoginPage() {
  const session = await getSession();
  if (session.worker_id) {
    redirect(session.is_admin ? "/admin" : "/panel");
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <LoginShell />
    </main>
  );
}
