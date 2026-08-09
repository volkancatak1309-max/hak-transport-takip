"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/**
 * Marka açılış ekranı — ölçülü/ortalanmış amblem, tam ekran görsel değil.
 * Tarayıcı oturumunda BİR KEZ (uygulamanın ilk açılışı), sonra söner.
 *
 * ═══ ÜÇ ADIMLI TİTREME — DÜZELTİLDİ (09.08.2026) ═══
 *
 * demo.galzura.com açılınca ekran ÜÇ KEZ değişiyordu:
 *     giriş formu → splash → giriş formu
 *
 * Sebep: bileşen tamamen effect'e bağlıydı. SSR `null` basıyor, tarayıcı giriş
 * formunu BOYUYOR, sonra hydration bitince useEffect çalışıp splash'ı formun
 * ÜZERİNE açıyor, 3 sn sonra kapatıyordu. Yani splash "açılış" değil, açılmış
 * uygulamanın üstüne düşen bir perdeydi.
 *
 * Çözüm, tema-flash'ının bilinen kalıbı: kararı BOYAMADAN ÖNCE ver. Layout'ta
 * `<head>` içinde SENKRON çalışan küçük bir betik sessionStorage'a bakıp
 * `<html data-splash="1">` koyar; splash katmanı SSR HTML'inde zaten vardır ve
 * CSS onu yalnız o öznitelik varken gösterir (globals.css). Böylece:
 *   • ilk açılış   → ilk boyama SPLASH'tir, tek geçiş: splash → uygulama
 *   • sonraki açılış → öznitelik hiç konmaz, splash HİÇ boyanmaz
 * Her iki yolda da ara boyama yok.
 *
 * Bu bileşenin işi artık yalnız ZAMANLAYICI: sönme sınıfını ekler ve düğümü
 * kaldırır. Görünürlük kararı ona ait değil — o karar HTML'de verilmiştir.
 */
export const SPLASH_SESSION_KEY = "hak_splash_shown";

export function Splash() {
  // Başlangıç: betik `data-splash` koyduysa katman GÖRÜNÜR durumdadır. İlk
  // render bunu okur — sunucuda okunamaz, ama sunucu markup'ı zaten katmanı
  // basıyor ve görünürlüğü CSS belirliyor, yani uyuşmazlık üretmez.
  const [mounted, setMounted] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const active = document.documentElement.dataset.splash === "1";
    if (!active) {
      setMounted(false);
      return;
    }
    const leave = setTimeout(() => {
      setLeaving(true);
      // Öznitelik sönme BAŞLARKEN kalkar: CSS kuralı `display` değil `opacity`
      // üzerinden çalıştığı için katman geçiş boyunca yerinde kalır.
      document.documentElement.removeAttribute("data-splash");
    }, 1800);
    const done = setTimeout(() => setMounted(false), 2150);
    return () => {
      clearTimeout(leave);
      clearTimeout(done);
    };
  }, []);

  if (!mounted) return null;

  return (
    <div
      aria-hidden
      data-splash-layer=""
      className={cn(
        // Koyu temada --background TRANSPARENT (zemin html'de); bg-background
        // kullanılırsa splash amblemi dashboard verisinin üzerinde yüzer
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
