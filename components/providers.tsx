"use client";

import { useEffect } from "react";
import { ThemeProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* SW registration optional — app works without it */
      });
    }
  }, []);

  // TEMA (DESIGN.md §1, 25.07.2026): AÇIK varsayılan, koyu tam desteklenir.
  // forcedTheme KALDIRILDI — daha önce koyu tema zorlanıyordu ve ThemeToggle
  // çalışsa da etkisizdi. enableSystem kapalı kalıyor: varsayılanı işletim
  // sisteminin değil, tasarım kilidinin belirlemesi bilinçli (şoförler gece
  // modundaki telefonla panele girince arayüz dili değişmesin).
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange={false}
    >
      {children}
    </ThemeProvider>
  );
}
