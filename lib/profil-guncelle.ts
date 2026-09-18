import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { canonicalPhone, phoneVariants } from "@/lib/phone";
import { auditChange } from "@/lib/audit-change";

/**
 * KENDİ PROFİLİNİ GÜNCELLEME — YALNIZ AD VE TELEFON (19.09.2026).
 *
 * ═══ NEDEN `updateWorkerAction` ÇAĞRILMIYOR ═══════════════════════════════
 *
 * Panelin `updateWorkerAction`ı (app/actions/workers.ts) aynı satıra yazıyor
 * ama BAŞKA BİR İŞ yapıyor ve o farklar burada kabul edilemez:
 *
 *   · kapısı `requireAdmin()` — şoför kendi adını değiştiremezdi;
 *   · 17 alanı BİRDEN yazıyor ve gövdede olmayanı `null`a çekiyor — şoför
 *     adını değiştirdiğinde ehliyet numarası, adresi, acil durum kişisi
 *     SİLİNİRDİ;
 *   · `is_admin` / `counts_as_driver` / araç ataması taşıyor — bu uçtan
 *     asla dokunulmaması gereken alanlar.
 *
 * Bu yüzden ÇAĞRILMIYOR ama KURALLARI aynen kullanılıyor: telefon
 * kanonikleştirme (`canonicalPhone`), benzersizlik denetimi
 * (`phoneVariants` — 0'lı/0'sız/ham üç yazım birden), yalnız DEĞİŞEN alanı
 * yazan diff ve `auditChange` izi. Üçü de aynı fonksiyonlar; ikinci bir
 * telefon kuralı yazılsaydı panelde kabul edilen numara mobilde reddedilirdi.
 *
 * ═══ E.164 — PANELDEN DAHA SIKI, BİLEREK ══════════════════════════════════
 *
 * Panelin `phoneSchema`sı yalnız uzunluk bakıyor (6–20 hane). Bu uç kanonik
 * çıktının E.164 olmasını ŞART koşuyor: `+` ve 7–15 hane. Sebep: numarayı
 * buraya ŞOFÖR giriyor, yöneticinin gözü üzerinden geçmiyor. "0664…" gibi
 * ulusal yazım `canonicalPhone` tarafından zaten `+43664…`e çevriliyor;
 * çevrilemeyen bir girdi (ülkesi belirsiz rakam dizisi) REDDEDİLİR —
 * kaydedip sonra aranamayan bir numara üretmektense.
 */

export type ProfilSonucu =
  | { ok: true; degisen: string[]; ad: string; telefon: string }
  | { ok: false; error: "errName" | "errPhone" | "phone_taken" | "not_found" | "write_failed"; detay?: string };

/** E.164: `+` · ilk hane 1–9 · toplam 8–16 karakter (`+` dahil). */
const E164 = /^\+[1-9]\d{6,14}$/;

export async function kendiProfiliGuncelle(input: {
  workerId: string;
  /** Verilmezse dokunulmaz. */
  ad?: unknown;
  /** Verilmezse dokunulmaz. */
  telefon?: unknown;
}): Promise<ProfilSonucu> {
  const { workerId } = input;

  let ad: string | undefined;
  if (input.ad !== undefined) {
    if (typeof input.ad !== "string") return { ok: false, error: "errName" };
    ad = input.ad.trim();
    // Panelin `updateWorkerSchema`sıyla aynı sınır (2–80).
    if (ad.length < 2 || ad.length > 80) return { ok: false, error: "errName" };
  }

  let telefon: string | undefined;
  if (input.telefon !== undefined) {
    if (typeof input.telefon !== "string") return { ok: false, error: "errPhone" };
    const kanonik = canonicalPhone(input.telefon);
    if (!E164.test(kanonik)) return { ok: false, error: "errPhone" };
    telefon = kanonik;
  }

  // test-visible: kendi kimliğine ANAHTARLI tek satır; liste okuması değil.
  const { data: cur } = await supabaseAdmin
    .from("workers")
    .select("name, phone")
    .eq("id", workerId)
    .maybeSingle();
  if (!cur) return { ok: false, error: "not_found" };
  const mevcut = cur as { name: string; phone: string };

  if (telefon !== undefined) {
    /**
     * BENZERSİZLİK — KENDİSİ HARİÇ, ÜÇ YAZIM BİRDEN.
     *
     * `.limit(1)` + `maybeSingle()` sırası panelin kuralıyla aynı ve gerekçesi
     * orada yazılı: `maybeSingle()` tek başına ÇOKLU satırda HATA döndürür ve
     * denetim sessizce delinir (iki kişide aynı numara varsa "çakışma yok"
     * sanılırdı).
     */
    const { data: dupe } = await supabaseAdmin
      .from("workers")
      .select("id")
      .in("phone", phoneVariants(telefon))
      .neq("id", workerId)
      .limit(1)
      .maybeSingle();
    if (dupe) return { ok: false, error: "phone_taken" };
  }

  // DİFF: yalnız gerçekten değişen alan yazılır. Aynı değeri yazmak hem
  // gereksiz bir UPDATE hem de yanıltıcı bir denetim izi olurdu.
  const update: Record<string, unknown> = {};
  if (ad !== undefined && ad !== mevcut.name) update.name = ad;
  if (telefon !== undefined && telefon !== mevcut.phone) update.phone = telefon;

  if (Object.keys(update).length > 0) {
    const { error } = await supabaseAdmin
      .from("workers")
      .update(update)
      .eq("id", workerId);
    if (error) return { ok: false, error: "write_failed", detay: error.message };
    // İz YAZMADAN SONRA: yazma başarısızsa iz de olmamalı (043 kuralı).
    await auditChange(workerId, "update", "workers", workerId, mevcut, update);
  }

  return {
    ok: true,
    degisen: Object.keys(update),
    ad: (update.name as string) ?? mevcut.name,
    telefon: (update.phone as string) ?? mevcut.phone,
  };
}
