import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * HAK61 wordmark. The source art is on a dark background, so we render it inside
 * a consistent dark "brand chip" — looks intentional and reads cleanly on BOTH
 * light and dark themes without halos. Aspect ratio (≈3.05:1) is preserved.
 */
export function BrandLogo({
  className,
  height = 26,
}: {
  className?: string;
  height?: number;
}) {
  const width = Math.round(height * (390 / 128));
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[10px] bg-[#0c0c0e] px-2.5 py-1.5 ring-1 ring-white/10",
        className
      )}
    >
      <Image
        src="/logo.png"
        alt="HAK61 GmbH"
        width={width}
        height={height}
        priority
        style={{ height, width: "auto" }}
      />
    </span>
  );
}
