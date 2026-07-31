/**
 * Modül bayrakları — GERİYE DÖNÜK GİRİŞ NOKTASI.
 *
 * Bayrakların kendisi 31.07.2026'da `lib/tenant.ts`'e taşındı (çok-müşteri
 * kurulum modu katmanı): artık env'den okunuyorlar ve varsayılanları buradaki
 * eski sabitlerin BİREBİR aynısı (yakıt/masraf/bakım kapalı, izin açık —
 * Volkan, 21. ve 23.07.2026). Bu dosya yalnız yeniden dışa aktarır: on ayrı
 * çağrı noktası `@/lib/features`'tan içe aktarıyor ve davranış değişikliği
 * taşımayan bir diff'i o import'lar için büyütmenin bedeli, kazandırdığından
 * fazla olurdu.
 *
 * YENİ KOD `@/lib/tenant`'tan içe aktarsın.
 */

export {
  FUEL_ENABLED,
  EXPENSE_ENABLED,
  MAINTENANCE_ENABLED,
  LEAVES_ENABLED,
} from "@/lib/tenant";
