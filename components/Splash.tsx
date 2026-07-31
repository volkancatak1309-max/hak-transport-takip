"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/**
 * Brief launch splash with the tenant emblem — measured/centered, never fullscreen
 * artwork. Shows ONCE per browser session (first app open only), then fades out.
 * Effect-driven (no SSR markup) to avoid any hydration mismatch.
 */
export function Splash() {
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("hak_splash_shown")) return;
      sessionStorage.setItem("hak_splash_shown", "1");
    } catch {
      /* sessionStorage blocked → just show once */
    }
    setShow(true);
    const leave = setTimeout(() => setLeaving(true), 3000);
    const done = setTimeout(() => setShow(false), 3350);
    return () => {
      clearTimeout(leave);
      clearTimeout(done);
    };
  }, []);

  if (!show) return null;

  return (
    <div
      aria-hidden
      className={cn(
        // Koyu temada --background TRANSPARENT (zemin html'de); bg-background
        // kullanılırsa splash amblemi 3sn dashboard verisinin üzerinde yüzer
        // (FAZ 0 kritik: "kaplan filigranı kartların üzerinde"). Opak zemin
        // rengiyle splash bir marka ekranı olur, veri üstü filigran değil.
        "fixed inset-0 z-[200] flex items-center justify-center bg-[#0a0d16] transition-opacity duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]",
        leaving ? "pointer-events-none opacity-0" : "opacity-100"
      )}
    >
      <div className="splash-emblem">
        <Image
          src={BRAND.assets.splash}
          alt={BRAND.legalName}
          width={BRAND.assets.splashWidth}
          height={BRAND.assets.splashHeight}
          priority
          className="h-auto w-[80vw] max-w-[460px]"
        />
      </div>
    </div>
  );
}
