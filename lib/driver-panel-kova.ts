import "server-only";

/**
 * VARDİYA FOTOĞRAFLARININ KOVASI — tek kaynak.
 *
 * Değer `app/actions/driver-panel.ts` içinde `PHOTO_BUCKET` olarak yaşıyordu ve
 * dışa aktarılmamıştı. `deleteEntryAction` (app/actions/shift.ts) vardiya
 * silinirken bu kovadan dosya silmek zorunda; adı ikinci kez yazmak, bir gün
 * kova adı değişince YANLIŞ KOVADAN silmeye (ya da hiç silmemeye) yol açardı.
 *
 * Ayrı dosyada çünkü iki tarafı da `"use server"` modülü: bir server-action
 * dosyasından sabit dışa aktarmak Next'in derleyicisinde yasak (yalnız async
 * fonksiyon export edilebilir).
 */
export const SHIFT_PHOTO_KOVA = "shift-photos";
