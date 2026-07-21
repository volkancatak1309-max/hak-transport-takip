/**
 * Central feature flags.
 *
 * These toggle the *visibility* of optional modules — navigation links and
 * route entry points. The underlying code, server actions, DB tables and
 * migrations are left intact, so re-enabling a module is a one-line change
 * (flip the flag back to `true`) with no data loss.
 *
 * Kapalı bayrak = menüde link YOK + rota giriş noktası yönlendirir. Sayfa
 * dosyaları, sunucu eylemleri, tablolar ve migration'lar OLDUĞU GİBİ DURUR;
 * geri açmak tek satır (`false` → `true`) ve veri kaybı yok.
 */

/**
 * Yakıt ve Masraf modülleri KAPALI (Volkan, 21.07.2026): HAK61 bunları
 * kullanmıyor. Kapanan menü öğeleri: yönetici "Yakıt" (/admin/yakit) +
 * "Masraflar" (/admin/masraflar) ve şoför panelindeki ikizleri (/panel/yakit,
 * /panel/masraflar). Komut paleti navItems'tan türediği için kendiliğinden
 * temizlenir.
 *
 * Bakım (MAINTENANCE) da kapatıldı (Volkan, 21.07.2026): sayfasını /admin/yakit
 * ile paylaştığı için yakıt kapanınca zaten menüsüz kalmıştı; 0 kayıtla
 * kullanılmıyordu. Üçü de kapalı olduğundan /admin/yakit artık tamamen
 * yönlendiriyor.
 */
export const FUEL_ENABLED = false;
export const EXPENSE_ENABLED = false;
export const MAINTENANCE_ENABLED = false;
