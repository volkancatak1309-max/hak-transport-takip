import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * HAK61 wordmark — transparent PNG, sits directly on the surface (no box/chip,
 * no halo). Reads cleanly on both light and dark themes. Aspect (≈3.015:1) is
 * preserved; only `height` drives the size.
 */
export function BrandLogo({
  className,
  height = 36,
}: {
  className?: string;
  height?: number;
}) {
  const width = Math.round(height * (603 / 200));
  return (
    <Image
      src="/logo.png"
      alt="HAK61 GmbH"
      width={width}
      height={height}
      priority
      className={cn("w-auto", className)}
      style={{ height, width: "auto" }}
    />
  );
}
