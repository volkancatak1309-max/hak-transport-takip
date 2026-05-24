import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSession();
  if (session.worker_id) {
    redirect(session.is_admin ? "/admin" : "/panel");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-md p-6">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">HAK Transport</h1>
          <p className="text-sm text-slate-600 mt-1">Saat & KM Takip Sistemi</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
