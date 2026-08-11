/**
 * AKSİYON ERTELEME — saf doğrulama katmanı (migration 058).
 *
 * `lib/fault-reports.ts` ile aynı gerekçeyle SAF: `server-only` ve
 * `supabaseAdmin` yok, böylece `scripts/check-aksiyon-erteleme.mjs` uçların
 * GERÇEK ayıklama kurallarını Node'da çalıştırabiliyor. Kurallar route.ts
 * içine gömülseydi yalnız canlı istekle sınanabilirlerdi.
 */

/**
 * Ertelenebilir KAYNAKLAR — tek kaynak (migration 058 CHECK'iyle aynı küme).
 *
 * Mobildeki Aksiyon Merkezi kalem kimliklerini kaynak önekiyle üretiyor
 * (`alarm:` / `dikkat:` / `izin:`), çünkü üç uç kendi kimlik uzayında çalışıyor
 * ve kimlikler canlıda çakışabilir. Sunucu tarafındaki karşılıkları bunlar.
 * Küme burada yaşar; uçlar da muhafız da buradan okur, kimse kendi kopyasını yazmaz.
 */
export const ERTELEME_KAYNAKLARI = ["alarm", "attention", "leave"] as const;
export type ErtelemeKaynak = (typeof ERTELEME_KAYNAKLARI)[number];

/**
 * `kalemId` üst sınırı — karakter.
 *
 * NEDEN ŞEMADA DEĞİL: `item_id` bilerek `text` (üç kaynağın kimlik uzayı farklı;
 * uuid yapmak türetilmiş dikkat kalemlerini dışarıda bırakırdı). Sınırsız text
 * bir gövdeyi silah hâline getirir. 200 karakter, bugünkü en uzun türetilmiş
 * kimliğin ("unassignedMoving:<uuid>" ≈ 55) üç katından fazla.
 */
export const KALEM_ID_MAX = 200;

export type ErtelemeGirdiSonucu =
  | { ok: true; kaynak: ErtelemeKaynak; kalemId: string; kadar: string }
  | {
      ok: false;
      kod: "missing_fields" | "invalid" | "too_long";
      alan: "kaynak" | "kalemId" | "kadar";
      sebep?: "tip" | "deger" | "bos" | "gecmis";
      uzunluk?: number;
    };

/**
 * ISO-8601 TARİH-SAAT şart — çıplak gün (YYYY-MM-DD) KABUL EDİLMEZ.
 *
 * `Date.parse("2026-08-12")` çalışır ve UTC gece yarısı verir; kullanıcının
 * "12 Ağustos'a ertele" niyeti Viyana'da 02:00'dır ve kalem iki saat erken geri
 * dönerdi. Sessizce yanlış an yazmaktansa reddetmek doğru: istemci mutlak anı
 * kendisi kuruyor (`Date.toISOString()`).
 */
const ISO_ANI = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Erteleme isteğinin gövdesini ayıkla.
 *
 * ── ÜÇ RET AYRI ŞEY ────────────────────────────────────────────────────────
 * `missing_fields` alan hiç gönderilmedi · `invalid` gönderildi ama kullanılamaz
 * (yanlış tip, tanınmayan değer, boş, geçmiş bir an) · `too_long` geçerli ama
 * sınırın üstünde. Hepsi `alan` taşır: ekran HANGİ alanın sorunlu olduğunu
 * bilmeden doğru cümleyi kuramaz.
 *
 * `simdi` DIŞARIDAN geçilir (varsayılan `Date.now()`): muhafız betiği "geçmiş
 * an" kuralını sabit bir saatle sınayabilsin, ölçüm koşuma göre kaymasın.
 */
export function ertelemeGirdisiniAyikla(
  body: unknown,
  simdi: number = Date.now()
): ErtelemeGirdiSonucu {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, kod: "missing_fields", alan: "kaynak" };
  }
  const input = body as Record<string, unknown>;

  // ── kaynak ───────────────────────────────────────────────────────────────
  if (!("kaynak" in input)) return { ok: false, kod: "missing_fields", alan: "kaynak" };
  if (typeof input.kaynak !== "string") {
    return { ok: false, kod: "invalid", alan: "kaynak", sebep: "tip" };
  }
  const kaynak = input.kaynak.trim();
  // Büyük/küçük harf ESNETİLMEZ — şema CHECK'i de esnetmiyor, uç ondan gevşek
  // olmamalı, yoksa yazma 23514 ile düşer ve kullanıcı "sunucu arızası" görür.
  if (!(ERTELEME_KAYNAKLARI as readonly string[]).includes(kaynak)) {
    return { ok: false, kod: "invalid", alan: "kaynak", sebep: "deger" };
  }

  // ── kalemId ──────────────────────────────────────────────────────────────
  if (!("kalemId" in input)) return { ok: false, kod: "missing_fields", alan: "kalemId" };
  if (typeof input.kalemId !== "string") {
    return { ok: false, kod: "invalid", alan: "kalemId", sebep: "tip" };
  }
  const kalemId = input.kalemId.trim();
  if (kalemId.length === 0) {
    return { ok: false, kod: "invalid", alan: "kalemId", sebep: "bos" };
  }
  if (kalemId.length > KALEM_ID_MAX) {
    return { ok: false, kod: "too_long", alan: "kalemId", uzunluk: kalemId.length };
  }

  // ── kadar ────────────────────────────────────────────────────────────────
  if (!("kadar" in input)) return { ok: false, kod: "missing_fields", alan: "kadar" };
  if (typeof input.kadar !== "string") {
    return { ok: false, kod: "invalid", alan: "kadar", sebep: "tip" };
  }
  const ham = input.kadar.trim();
  const ms = Date.parse(ham);
  if (!ISO_ANI.test(ham) || !Number.isFinite(ms)) {
    return { ok: false, kod: "invalid", alan: "kadar", sebep: "deger" };
  }
  /**
   * GEÇMİŞ AN REDDEDİLİR. Kabul edilseydi satır yazılır ama liste süzgeci
   * (`snoozed_until > now()`) onu hiç görmezdi: kullanıcı "ertelendi" mesajı
   * alır, kalem listede DURURDU. Sessiz hiçlik.
   */
  if (ms <= simdi) {
    return { ok: false, kod: "invalid", alan: "kadar", sebep: "gecmis" };
  }

  // Normalize: DB'ye ve yanıta tek biçim gider (girdi "+02:00" ile gelse bile).
  return { ok: true, kaynak: kaynak as ErtelemeKaynak, kalemId, kadar: new Date(ms).toISOString() };
}
