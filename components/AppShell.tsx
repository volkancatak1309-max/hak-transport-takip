import { Header, type HeaderUser } from "./Header";
import { Footer } from "./Footer";

export function AppShell({
  user,
  children,
}: {
  user: HeaderUser | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header user={user} />
      <main className="flex-1 page-enter">{children}</main>
      <Footer />
    </div>
  );
}
