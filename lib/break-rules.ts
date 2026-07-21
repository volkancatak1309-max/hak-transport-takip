/**
 * Mola kuralları — şoför panelindeki mola sayacının tek kaynağı.
 *
 * AZG (Arbeitszeitgesetz, Avusturya) § 11 dinlenme molası:
 *   • günlük çalışma süresi 6 saati aşıyorsa  → en az 30 dakika mola
 *   • 9 saati aşıyorsa                        → en az 45 dakika
 *
 * HAK61'de pratik hedef 30 dakikadır: vardiyaların ezici çoğunluğu 6-9 saat
 * bandında (canlı medyan ~7 sa). 9 saat üstü için 45 dakikalık ikinci kademe
 * BİLİNÇLİ olarak eklenmedi — eklenecekse burada, çalışılan süreye bakan bir
 * fonksiyona dönüştürülmeli (`breakTargetMin(workedMs)`), sayaç UI'ı zaten tek
 * bir hedef değeri okuyor.
 *
 * 9 saati aşan vardiyalar ayrıca yönetici tarafında AZG uyarısı üretir
 * (lib/admin-dashboard.ts → over9h), yani o durum gözden kaçmıyor.
 */

/** Molanın hedef süresi (dakika). Sayaç buna ulaşınca mola otomatik biter. */
export const BREAK_TARGET_MIN = 30;

/** Aynı hedef milisaniye cinsinden (sayaç ve zamanlayıcı için). */
export const BREAK_TARGET_MS = BREAK_TARGET_MIN * 60_000;
