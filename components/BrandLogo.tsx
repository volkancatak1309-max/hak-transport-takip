import Image from "next/image";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/**
 * Müşteri wordmark/amblemi — saydam PNG, doğrudan yüzeyin üstünde durur
 * (kutu/çip/hale yok). Açık ve koyu temada aynı okunur.
 *
 * ORAN MARKAYA GÖRE DEĞİŞİR: HAK61 geniş bir wordmark (915×300 ≈ 3.05),
 * Sendigo kare bir amblem (1320×1290 ≈ 1.02). Oran lib/brand.ts'ten gelir.
 */

/**
 * `height` prop'unun yazıldığı referans oran — HAK61'in wordmark'ı.
 *
 * Çağrı yerlerindeki sayılar (38 · 52 · 68) GENİŞ bir wordmark düşünülerek
 * seçilmişti: 38 yükseklik × 3.05 oran = 116 px genişlik, marka adı rahat
 * okunur. Aynı 38, kare bir amblemde 39 px genişlik demek — Sendigo kabul
 * testinde ölçüldü: kenar çubuğunda logo 39×38 px çıkıyordu ve içindeki
 * "SENDIGO" yazısı tamamen okunmuyordu.
 */
const REFERENCE_RATIO = 915 / 300;

/**
 * Dar/kare logolar için yükseklik çarpanının ÜST SINIRI.
 *
 * Alan eşitliği tek başına 1.73 çarpan isterdi (√(3.05/1.02)); 38 px'lik
 * kenar çubuğu yuvasında bu 66 px'e çıkar ve satırı taşırır. 1.55 iki ucu da
 * tutar: Sendigo 59×60 px'e çıkar (okunur), yuva 60 px'i kaldırır.
 */
const MAX_SCALE = 1.55;

/**
 * Dar logo için yükseklik çarpanı — GENİŞ logoda tam olarak 1.
 *
 * HAK61 için `sqrt(3.05 / 3.05) = 1` → yükseklik ve genişlik BİREBİR eskisi
 * gibi kalır (38 → 116×38). Bu YAPISAL bir garantidir, ayar değil: HAK61'in
 * oranı referans oranın ta kendisidir ve `>= REFERENCE_RATIO` dalı erken döner.
 * Muhafız (`check-tenant-defaults.mjs`) referansın kaymadığını `company.logoRatio`
 * satırıyla denetler — bu dosyanın kendisi JSX içerdiği için oraya yüklenemez.
 */
function heightScale(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  if (ratio >= REFERENCE_RATIO) return 1; // geniş wordmark → dokunma
  return Math.min(MAX_SCALE, Math.sqrt(REFERENCE_RATIO / ratio));
}

/** Verilen yuva yüksekliği için logonun GERÇEK çizim ölçüsü. */
export function brandLogoBox(height: number): { width: number; height: number } {
  const h = Math.round(height * heightScale(BRAND.logoRatio));
  return { width: Math.round(h * BRAND.logoRatio), height: h };
}

export function BrandLogo({
  className,
  height = 36,
}: {
  className?: string;
  height?: number;
}) {
  const box = brandLogoBox(height);
  const width = box.width;
  height = box.height;
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
