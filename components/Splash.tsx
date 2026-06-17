"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Brief launch splash with the HAK61 emblem — measured/centered, never fullscreen
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
    const leave = setTimeout(() => setLeaving(true), 1100);
    const done = setTimeout(() => setShow(false), 1450);
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
        "fixed inset-0 z-[200] flex items-center justify-center bg-background transition-opacity duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]",
        leaving ? "pointer-events-none opacity-0" : "opacity-100"
      )}
    >
      <div className="splash-emblem">
        <Image
          src="/splash.webp"
          alt="HAK61 GmbH"
          width={400}
          height={313}
          priority
          className="h-auto w-[80vw] max-w-[460px]"
        />
      </div>
    </div>
  );
}
