import Image from "next/image";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/**
 * Müşteri wordmark/amblemi — saydam PNG, doğrudan yüzeyin üstünde durur
 * (kutu/çip/hale yok). Açık ve koyu temada aynı okunur.
 *
 * ORAN MARKAYA GÖRE DEĞİŞİR: HAK61 geniş bir wordmark (915×300 ≈ 3.05),
 * Sendigo kare bir amblem (1320×1290 ≈ 1.02). Sabit oran ikinci markayı
 * ezerdi; oran lib/brand.ts'ten gelir. Boyutu yalnız `height` sürer.
 */
export function BrandLogo({
  className,
  height = 36,
}: {
  className?: string;
  height?: number;
}) {
  const width = Math.round(height * BRAND.logoRatio);
  return (
    <Image
      src={BRAND.assets.logo}
      alt={BRAND.legalName}
      width={width}
      height={height}
      priority
      className={cn("w-auto", className)}
      style={{ height, width: "auto" }}
    />
  );
}
