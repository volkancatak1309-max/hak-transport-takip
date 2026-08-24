"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * İMZA YÜZEYİ — parmakla çizim, SIFIR PAKET.
 *
 * ═══ NEDEN KÜTÜPHANE YOK ═══
 *
 * Hazır imza bileşenleri (react-signature-canvas ve türevleri) tarayıcıda
 * gereksiz, mobil uygulamada ise NATIVE bağımlılık demek (WebView / SVG /
 * Skia). Burada gereken şey iki API: `<canvas>` ve Pointer Events. İkisi de
 * her telefon tarayıcısında var ve parmak, kalem, fare üçünü de aynı olayla
 * veriyor — `touchstart`/`mousedown` ayrımı yapmaya gerek yok.
 *
 * ═══ ÇIKTI: VEKTÖR, SABİT KOORDİNAT UZAYINDA ═══
 *
 * Çizim ekranda kaç piksel olursa olsun, dışarı verilen yol daima
 * 600×200'lük bir kutuya ÖLÇEKLENİR. Sebebi: imza yıllar sonra bambaşka bir
 * ekranda (yönetici paneli, PDF) çizilecek. Cihazın piksel ölçüsünü kaydetmek,
 * kanıtı o cihaza bağlamak olurdu; sabit kutu her yerde aynı imzayı verir.
 *
 * Nokta seyreltme (2 px eşiği) bilinçli: parmak titremesi saniyede onlarca
 * nokta üretiyor ve hepsini yazmak imzayı büyütmekten başka bir şey yapmıyor.
 */

/** İmzanın dışarı verildiği sabit koordinat kutusu. */
export const IMZA_EN = 600;
export const IMZA_BOY = 200;

/** Bu mesafeden yakın noktalar atılır (kaynak uzayında piksel). */
const SEYRELTME_PX = 2;


/**
 * Çizgileri baştan çizer. Modül düzeyinde ve SAF: hiçbir bileşen durumuna
 * kapanmıyor, bu yüzden hook sırası tartışması doğmuyor (lint kuralı
 * react-hooks/immutability bunu bileşen içinde tanımlıyken yakaladı).
 */
function ciz(
  ctx: CanvasRenderingContext2D,
  cizgiler: { x: number; y: number }[][],
  w: number,
  h: number
) {
  ctx.clearRect(0, 0, w, h);
  for (const cizgi of cizgiler) {
    if (cizgi.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(cizgi[0].x, cizgi[0].y);
    for (let i = 1; i < cizgi.length; i++) ctx.lineTo(cizgi[i].x, cizgi[i].y);
    ctx.stroke();
  }
}

export function ImzaPad({
  onChange,
  disabled,
}: {
  /** SVG yol verisi (`d`) — imza yoksa boş dize. */
  onChange: (d: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("teslimat");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cizgilerRef = useRef<{ x: number; y: number }[][]>([]);
  const cizerRef = useRef(false);
  const [bos, setBos] = useState(true);

  /** Canvas'ı CSS boyutuna göre (retina dahil) ölçekler ve yeniden çizer. */
  const boyutla = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const oran = window.devicePixelRatio || 1;
    const kutu = c.getBoundingClientRect();
    c.width = Math.round(kutu.width * oran);
    c.height = Math.round(kutu.height * oran);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(oran, oran);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Mürekkep rengi tema token'ından: koyu temada beyaz kâğıda siyah çizmek
    // ekranda kaybolurdu.
    ctx.strokeStyle = getComputedStyle(c).color || "#111";
    ciz(ctx, cizgilerRef.current, kutu.width, kutu.height);
  }, []);

  useEffect(() => {
    boyutla();
    window.addEventListener("resize", boyutla);
    return () => window.removeEventListener("resize", boyutla);
  }, [boyutla]);

  function noktaAl(e: React.PointerEvent<HTMLCanvasElement>) {
    const kutu = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - kutu.left, y: e.clientY - kutu.top };
  }

  function bas(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    // Parmak hareketi sayfayı kaydırmasın — imza atarken ekran oynarsa çizgi
    // kopuyor.
    // Yakalama BAŞARISIZ OLABİLİR (bazı tarayıcılar sentetik/kalem olaylarında
    // NotFoundError atar). Çizim buna bağlı değil: yakalama yalnız parmağın
    // alan dışına taşmasını hoş görmek için — düşerse çizgi yine kaydedilir.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* yakalama yoksa da çiziyoruz */
    }
    cizerRef.current = true;
    cizgilerRef.current.push([noktaAl(e)]);
  }

  function hareket(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!cizerRef.current || disabled) return;
    const cizgi = cizgilerRef.current[cizgilerRef.current.length - 1];
    const n = noktaAl(e);
    const son = cizgi[cizgi.length - 1];
    if (Math.hypot(n.x - son.x, n.y - son.y) < SEYRELTME_PX) return;
    cizgi.push(n);
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.beginPath();
    ctx.moveTo(son.x, son.y);
    ctx.lineTo(n.x, n.y);
    ctx.stroke();
  }

  function birak() {
    if (!cizerRef.current) return;
    cizerRef.current = false;
    setBos(cizgilerRef.current.every((c) => c.length < 2));
    onChange(yolUret());
  }

  /** Çizgileri sabit kutuya ölçekleyip SVG `d` üretir. */
  function yolUret(): string {
    const c = canvasRef.current;
    if (!c) return "";
    const kutu = c.getBoundingClientRect();
    if (kutu.width === 0 || kutu.height === 0) return "";
    const sx = IMZA_EN / kutu.width;
    const sy = IMZA_BOY / kutu.height;
    const parcalar: string[] = [];
    for (const cizgi of cizgilerRef.current) {
      if (cizgi.length < 2) continue;
      const noktalar = cizgi.map(
        (p) => `${(p.x * sx).toFixed(1)} ${(p.y * sy).toFixed(1)}`
      );
      parcalar.push(`M${noktalar[0]} L${noktalar.slice(1).join(" L")}`);
    }
    return parcalar.join(" ");
  }

  function temizle() {
    cizgilerRef.current = [];
    setBos(true);
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) {
      const kutu = c.getBoundingClientRect();
      ctx.clearRect(0, 0, kutu.width, kutu.height);
    }
    onChange("");
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface-2">
        <canvas
          ref={canvasRef}
          onPointerDown={bas}
          onPointerMove={hareket}
          onPointerUp={birak}
          onPointerLeave={birak}
          onPointerCancel={birak}
          className="block h-40 w-full touch-none text-foreground"
          aria-label={t("imza_alani")}
        />
        {bos && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {t("imza_ipucu")}
          </span>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={temizle}
        disabled={bos || disabled}
        className="h-8"
      >
        <Eraser className="size-3.5" />
        {t("imza_temizle")}
      </Button>
    </div>
  );
}

/**
 * Kaydedilmiş imzayı çizer — yönetici paneli ve şoför geçmişi ortak kullanır.
 *
 * `viewBox` sabit: yol o uzayda üretildi (ImzaPad başlığı). Genişlik
 * kapsayıcıdan gelir, imza ölçeklenir ve bulanıklaşmaz — vektör olmasının
 * asıl kazancı burada görünüyor.
 */
export function ImzaGoster({ d, className }: { d: string; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${IMZA_EN} ${IMZA_BOY}`}
      className={className}
      role="img"
      aria-hidden={false}
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
