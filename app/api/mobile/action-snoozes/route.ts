import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import {
  ERTELEME_KAYNAKLARI,
  KALEM_ID_MAX,
  ertelemeGirdisiniAyikla,
} from "@/lib/action-snoozes";
import { erteleKalem } from "@/lib/action-snoozes-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/action-snoozes — bir aksiyon kalemini ERTELE (migration 058).
 *
 * Gövde `{ kaynak: "alarm"|"attention"|"leave", kalemId: string, kadar: ISO }`.
 *
 * ── KAPI: requireMobileAdmin ──────────────────────────────────────────────
 * Aksiyon listesini besleyen `/api/mobile/alarms` ile AYNI katman. Erteleme,
 * listeyi HERKES İÇİN değiştiren bir karardır; onu alabilen, listenin tamamını
 * görebilen kişi olmalı. Filo şefi ve şoför 403 `admin_required` alır.
 *
 * ── NEDEN ARAÇ/KALEM ALTINDA DEĞİL, KENDİ KAYNAĞI ─────────────────────────
 * Ertelenen şey üç ayrı uçtan gelebiliyor (cihaz olayı, türetilmiş dikkat
 * kalemi, izin talebi) ve ikisinin veritabanında satırı bile var değil. Yolu
 * `/alarms/[id]/ertele` yapmak, dikkat kalemlerini dışarıda bırakırdı.
 * Kaynak ERTELEMENİN KENDİSİ; kalem (tür + kimlik) çiftiyle taşınıyor.
 *
 * ── ERTELEME ANAHTARLI ────────────────────────────────────────────────────
 * `snoozed_by` OTURUMDAN gelir, gövdeden değil. Yani "başkası adına erteleme"
 * diye bir istek KURULAMAZ — alanı yok. `vehicle_id`/`worker_id` de gövdeden
 * okunmaz (bkz. lib/action-snoozes-db.ts notu).
 *
 * ── AYNI KALEM İKİNCİ KEZ ERTELENİRSE ─────────────────────────────────────
 * Yeni satır AÇILMAZ, mevcut etkin satır GÜNCELLENİR — kısmi benzersiz indeks
 * (058) ikinci kaydı zaten reddederdi ve kullanıcı "ertelemeyi düzenle" derken
 * hata alırdı. Yanıt `yeni:false` ve **200** döner; ilk ertelemede `yeni:true`
 * ve **201**. İkisini ayırmak, ekranın "ertelendi" ile "erteleme güncellendi"
 * cümlelerini ayırmasını sağlar.
 *
 * ⚠️ EN UZAK AN İÇİN TAVAN YOK: 3000 yılına ertelenen kalem pratikte silinmiş
 * olur. Kapı yönetici kimliği olduğu için yüzey dar, ama bu bir sınır değil bir
 * eksiktir — ürün kararı gerektiği için uydurulmadı.
 *
 * ⚠️ HIZ SINIRI (rate limit) YOK — paket ve arıza uçlarıyla aynı durum.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }

  const ayikla = ertelemeGirdisiniAyikla(body);
  if (!ayikla.ok) {
    return mobileError(400, ayikla.kod, {
      alan: ayikla.alan,
      ...(ayikla.sebep ? { sebep: ayikla.sebep } : {}),
      // Geçerli küme/sınır yanıtta: istemci neyin kabul edildiğini dokümana
      // bakmadan görebilsin.
      ...(ayikla.alan === "kaynak" ? { gecerli: ERTELEME_KAYNAKLARI } : {}),
      ...(ayikla.kod === "too_long"
        ? { enFazla: KALEM_ID_MAX, uzunluk: ayikla.uzunluk }
        : {}),
    });
  }

  const sonuc = await erteleKalem(
    ayikla.kaynak,
    ayikla.kalemId,
    ayikla.kadar,
    guard.actor.worker.id
  );
  if (!sonuc.ok) {
    // "Tablo yok" ≠ "yazma başarısız": ilki migration 058'in çalıştırılmadığı
    // kurulumdur ve yöneticiye BAŞKA iş yaptırır.
    return mobileError(503, "db_error", { sebep: sonuc.sebep });
  }

  return Response.json(
    { ok: true, yeni: sonuc.yeni, erteleme: sonuc.satir },
    { status: sonuc.yeni ? 201 : 200 }
  );
}
