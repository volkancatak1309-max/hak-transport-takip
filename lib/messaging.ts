import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { READ_RECEIPTS_ENABLED } from "@/lib/tenant";

/**
 * Erişim kararını veren aktör — YAPISAL tip, sınıf değil.
 *
 * Mobilin `MobileActor`'ü bunu birebir karşılar; panelin oturumu da aynı şekli
 * kurar (app/actions/messages.ts). Böylece "kim kime yazabilir" kuralı TEK
 * yerde yaşıyor. Mobile'a bağlı bir tip istesek panel onu import edemez ve
 * kural ikinci kez yazılırdı — ilk değişiklikte iki yüzey ayrışırdı.
 */
export type MesajAktoru = {
  worker: { id: string; is_admin: boolean; counts_as_driver: boolean };
  isChief: boolean;
  fleetScope: { isFleetWorker: (id: string | null | undefined) => boolean };
};

/**
 * MESAJLAŞMA ÇEKİRDEĞİ (migration 071) — yönetici ↔ şoför.
 *
 * ── KONUŞMA "ŞOFÖR KİMLİĞİYLE" ADRESLENİR ───────────────────────────────────
 * Uçlardaki `[id]` konuşmanın kendi kimliği DEĞİL, konuşmanın sahibi ŞOFÖRÜN
 * kimliğidir. Sebebi pratik: konuşma satırı ilk mesaja kadar YOKTUR, ama şoför
 * hep vardır. Konuşma kimliğiyle adreslesek "henüz konuşması olmayan şoföre
 * nasıl yazarım" sorusu çözümsüz kalır ya da listeleme ucunu toplu yazma
 * yapmaya zorlardı (GET'in satır yaratması). Şoför kimliği, konuşma doğmadan
 * önce de var olan tek kararlı adres.
 *
 * `conversations.worker_id` UNIQUE olduğu için eşleme birebir ve ikircik yok.
 *
 * ── ŞOFÖRLER BİRBİRİYLE MESAJLAŞAMAZ ────────────────────────────────────────
 * Kural şemada (worker_id UNIQUE + sahibi daima şoför). Buradaki kapı onun
 * ikinci hattı: şoför yalnız KENDİ kimliğine erişebilir, başka bir şoförün
 * kimliğini yazarsa 403 alır — o kimliğin konuşması var olsa bile.
 */

/** `[id]` çözümünün sonucu. */
export type ErisimSonucu =
  | { ok: true; targetWorkerId: string; role: "driver" | "admin" }
  | { ok: false; status: number; code: string };

/**
 * Aktörün hedef şoförün konuşmasına erişip erişemeyeceği.
 *
 *   şoför       → YALNIZ kendi kimliği
 *   filo şefi   → kapsamındaki şoförler (lib/fleet-scope.ts; migration 072'den
 *                 sonra aracı olmayanlar da kapsamda)
 *   patron      → herkes
 *
 * `role` dönen değer, yazılacak mesajın `sender_role`üdür ve KAPIDAN türer,
 * istemciden değil: "yönetici mi şoför mü" sorusunun cevabını gövde söyleyemez.
 *
 * ── YÖNETİCİ MUAFİYETİ (migration 041) ─────────────────────────────────────
 * Direksiyona geçen yönetici (`counts_as_driver`) KENDİ konuşmasına şoför
 * olarak yazar; başkasınınkine yönetici olarak. Kardeş kapıların aynı cümlesi.
 */
export async function erisimCoz(
  actor: MesajAktoru,
  hedefWorkerId: string
): Promise<ErisimSonucu> {
  const { worker, isChief, fleetScope } = actor;

  // Kendi konuşması — her rol için geçerli tek istisna.
  if (hedefWorkerId === worker.id) {
    // Direksiyona geçmeyen yöneticinin KENDİ konuşması yoktur: konuşmanın
    // sahibi daima bir şofördür. Ona bir konuşma açmak, şemanın "sahibi
    // şoför" varsayımını sessizce delerdi.
    if (worker.is_admin && !worker.counts_as_driver) {
      return { ok: false, status: 403, code: "not_a_driver" };
    }
    return { ok: true, targetWorkerId: hedefWorkerId, role: "driver" };
  }

  // Buradan sonrası "başkasının konuşması" — yalnız yönetim tarafı.
  if (worker.is_admin) {
    return { ok: true, targetWorkerId: hedefWorkerId, role: "admin" };
  }
  if (isChief) {
    if (!fleetScope.isFleetWorker(hedefWorkerId)) {
      return { ok: false, status: 403, code: "scope" };
    }
    return { ok: true, targetWorkerId: hedefWorkerId, role: "admin" };
  }
  // Şoför başkasının konuşmasını isterse: VAR OLMAYAN değil, YASAK.
  // 404 döndürmek "böyle biri yok" bilgisini sızdırır; 403 sızdırmaz.
  return { ok: false, status: 403, code: "forbidden" };
}

/** Hedefin gerçekten bir ŞOFÖR olduğunu doğrular (konuşma sahibi şoför olmalı). */
export async function hedefSoforMu(
  workerId: string
): Promise<{ ok: true; ad: string } | { ok: false; status: number; code: string }> {
  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_admin, is_active, counts_as_driver")
    .eq("id", workerId)
    .maybeSingle();
  if (error) return { ok: false, status: 503, code: "db_error" };
  if (!data) return { ok: false, status: 404, code: "worker_not_found" };
  if (data.is_active !== true) return { ok: false, status: 409, code: "worker_inactive" };
  if (data.is_admin === true && data.counts_as_driver !== true) {
    return { ok: false, status: 409, code: "not_a_driver" };
  }
  return { ok: true, ad: (data.name as string) ?? "—" };
}

/**
 * Şoförün konuşmasını getirir; `olustur` ise yoksa açar.
 *
 * OKUMA yolunda ASLA yaratmaz — GET'in satır yazması, "geçmişe baktım" ile
 * "konuşma başlattım"ı aynı şey yapardı ve boş konuşmalar listeyi doldururdu.
 */
export async function konusmaGetir(
  workerId: string,
  olustur: boolean
): Promise<{ ok: true; id: string | null } | { ok: false; code: string }> {
  const mevcut = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("worker_id", workerId)
    .maybeSingle();
  if (mevcut.error) return { ok: false, code: "db_error" };
  if (mevcut.data) return { ok: true, id: mevcut.data.id as string };
  if (!olustur) return { ok: true, id: null };

  const yeni = await supabaseAdmin
    .from("conversations")
    .insert({ worker_id: workerId })
    .select("id")
    .single();
  if (!yeni.error) return { ok: true, id: yeni.data.id as string };

  // YARIŞ: iki mesaj aynı anda gelirse ikisi de "yok" görüp INSERT dener;
  // worker_id UNIQUE olduğu için biri 23505 alır. Bu bir hata değil, beklenen
  // sonuç — kaybeden taraf kazananın satırını okur.
  if (yeni.error.code === "23505") {
    const tekrar = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("worker_id", workerId)
      .maybeSingle();
    if (tekrar.data) return { ok: true, id: tekrar.data.id as string };
  }
  return { ok: false, code: "db_error" };
}

/** Liste/başlık için tek satırlık önizleme. Satır sonları boşluğa iner. */
export function onizleme(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 140);
}

/**
 * OKUNDU MAKBUZU YAZ — bayrak kapalıysa HİÇBİR ŞEY yazmaz.
 *
 * ⚠️ Kapı BURADA, yazma yolunda. Arayüzde gizlemek yetmezdi: veri yine
 * birikirdi ve "okundu bilgisi tutmuyoruz" beyanı yanlış olurdu. Avusturya
 * §96(1)3 ArbVG / Almanya §87 BetrVG — çalışanı izleyen teknik sistem işyeri
 * konseyi onayına bağlı.
 *
 * KENDİ mesajına makbuz yazılmaz: "gönderen okudu" bilgi taşımaz ve karşı
 * tarafın ✓✓'sini kirletirdi.
 *
 * `ignoreDuplicates`: aynı mesajı ikinci kez açmak ilk okuma anını EZMEMELİ —
 * "ne zaman okudu" sorusunun cevabı ilk açılıştır.
 */
export async function makbuzYaz(
  konusmaId: string,
  okuyanWorkerId: string
): Promise<{ yazildi: number; kapali: boolean }> {
  if (!READ_RECEIPTS_ENABLED) return { yazildi: 0, kapali: true };

  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("conversation_id", konusmaId)
    .is("deleted_at", null)
    .neq("sender_worker_id", okuyanWorkerId);
  if (error || !data || data.length === 0) return { yazildi: 0, kapali: false };

  const satirlar = (data as { id: string }[]).map((m) => ({
    message_id: m.id,
    worker_id: okuyanWorkerId,
  }));
  const { error: insErr, count } = await supabaseAdmin
    .from("message_receipts")
    .upsert(satirlar, { onConflict: "message_id,worker_id", ignoreDuplicates: true, count: "exact" });
  if (insErr) return { yazildi: 0, kapali: false };
  return { yazildi: count ?? 0, kapali: false };
}

/**
 * Konuşma başına okunmamış sayısı — TEK sorguyla, konuşma sayısından bağımsız.
 *
 * "Bana ait makbuzu OLMAYAN ve BENİM yazmadığım mesajlar". Liste ucu bunu
 * konuşma başına ayrı sorguyla hesaplasaydı 1000 şoförlü filoda 1000 sorgu
 * olurdu; burada iki okuma yapılıp bellekte eşleştiriliyor.
 *
 * Bayrak kapalıyken makbuz TABLOSU BOŞ kalır, yani her mesaj "okunmamış"
 * görünürdü — yanıltıcı. Bu yüzden kapalıyken sayaç ÜRETİLMEZ (null döner) ve
 * uçlar `okunmamis: null` gösterir: "bilinmiyor", "sıfır" değil.
 */
export async function okunmamisSayaclari(
  konusmaIdler: string[],
  okuyanWorkerId: string
): Promise<Map<string, number> | null> {
  if (!READ_RECEIPTS_ENABLED) return null;
  const out = new Map<string, number>();
  if (konusmaIdler.length === 0) return out;

  const { data: msg, error } = await supabaseAdmin
    .from("messages")
    .select("id, conversation_id")
    .in("conversation_id", konusmaIdler)
    .is("deleted_at", null)
    .neq("sender_worker_id", okuyanWorkerId);
  if (error) return null;
  const mesajlar = (msg ?? []) as { id: string; conversation_id: string }[];
  if (mesajlar.length === 0) return out;

  const { data: rec, error: recErr } = await supabaseAdmin
    .from("message_receipts")
    .select("message_id")
    .eq("worker_id", okuyanWorkerId)
    .in("message_id", mesajlar.map((m) => m.id));
  if (recErr) return null;
  const okunan = new Set(((rec ?? []) as { message_id: string }[]).map((r) => r.message_id));

  for (const m of mesajlar) {
    if (okunan.has(m.id)) continue;
    out.set(m.conversation_id, (out.get(m.conversation_id) ?? 0) + 1);
  }
  return out;
}

/** Konuşmanın denormalize son-mesaj alanlarını tazeler (liste sıralaması). */
export async function sonMesajiIsle(
  konusmaId: string,
  body: string,
  role: "driver" | "admin",
  atIso: string
): Promise<void> {
  await supabaseAdmin
    .from("conversations")
    .update({
      last_message_at: atIso,
      last_message_preview: onizleme(body),
      last_sender_role: role,
    })
    .eq("id", konusmaId);
}

/** Gövde doğrulama — şemadaki CHECK ile AYNI sınır (1..4000, kırpılmış). */
export function govdeCoz(ham: unknown): { ok: true; body: string } | { ok: false; code: string } {
  if (typeof ham !== "string") return { ok: false, code: "body_required" };
  const b = ham.trim();
  if (b.length === 0) return { ok: false, code: "body_empty" };
  if (b.length > 4000) return { ok: false, code: "body_too_long" };
  return { ok: true, body: b };
}

// ── PAYLAŞILAN OKUMALAR — panel ve mobil AYNI sorguyu kullanır ──────────────
//
// Aşağıdaki iki fonksiyon önce yalnız /api/mobile/messages* içindeydi. Panel
// ekranı gelince ikinci bir kopya yazmak gerekecekti; o kopya ilk kural
// değişikliğinde geride kalır ve aynı filo iki yüzeyde FARKLI liste görürdü.
// Bu yüzden sorgular buraya taşındı, uçlar ve sayfa buradan okuyor.

export type KonusmaSatiri = {
  soforId: string;
  adSoyad: string;
  telefon: string | null;
  filo: string | null;
  konusmaId: string | null;
  sonMesajAn: string | null;
  sonMesajOnizleme: string | null;
  sonGonderenRol: string | null;
  /** null = okundu bilgisi KAPALI (bilinmiyor), 0 = hepsi okundu. */
  okunmamis: number | null;
};

/**
 * Konuşma listesi — KAYNAK ŞOFÖR LİSTESİDİR, konuşma tablosu değil.
 *
 * Konuşma satırı ilk mesaja kadar yoktur; listeyi konuşmalardan üretseydik
 * yönetici henüz yazışmadığı şoförü hiç göremez ve ona yazamazdı.
 */
export async function konusmaListesi(
  actor: MesajAktoru,
  rol: "admin" | "fleet_chief" | "driver",
  kapsam: string[] | null,
  page: { limit: number; offset: number }
): Promise<{ ok: true; satirlar: KonusmaSatiri[]; total: number } | { ok: false; code: string }> {
  let q = supabaseAdmin
    .from("workers")
    // test-filtered: yonetim yolunda is_test elenir (asagida). Sofor yolu
    // ANAHTARLI okumadir — test hesabi kendi konusmasini gorebilmeli
    // (lib/test-data.ts kurali).
    .select("id, name, phone, fleet", { count: "exact" })
    .eq("is_active", true);

  if (rol === "driver") {
    q = q.eq("id", actor.worker.id);
  } else {
    q = q.not("is_test", "is", true).or("is_admin.eq.false,counts_as_driver.eq.true");
    if (rol === "fleet_chief") q = q.in("id", kapsam ?? []);
  }

  const { data, error, count } = await q
    .order("name", { ascending: true })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) return { ok: false, code: "db_error" };

  const workers = (data ?? []) as {
    id: string; name: string | null; phone: string | null; fleet: string | null;
  }[];
  if (workers.length === 0) return { ok: true, satirlar: [], total: count ?? 0 };

  // Konuşmalar TEK sorguda bindirilir — şoför başına sorgu N+1 olurdu.
  const { data: konusmalar } = await supabaseAdmin
    .from("conversations")
    .select("id, worker_id, last_message_at, last_message_preview, last_sender_role")
    .in("worker_id", workers.map((w) => w.id));
  const kMap = new Map(
    ((konusmalar ?? []) as Record<string, unknown>[]).map((c) => [c.worker_id as string, c])
  );

  const okunmamis = await okunmamisSayaclari(
    [...kMap.values()].map((c) => c.id as string),
    actor.worker.id
  );

  const satirlar: KonusmaSatiri[] = workers.map((w) => {
    const c = kMap.get(w.id);
    const kid = (c?.id as string | undefined) ?? null;
    return {
      soforId: w.id,
      adSoyad: w.name ?? "—",
      telefon: w.phone ?? null,
      filo: w.fleet ?? null,
      konusmaId: kid,
      sonMesajAn: (c?.last_message_at as string | null) ?? null,
      sonMesajOnizleme: (c?.last_message_preview as string | null) ?? null,
      sonGonderenRol: (c?.last_sender_role as string | null) ?? null,
      okunmamis: okunmamis ? (kid ? okunmamis.get(kid) ?? 0 : 0) : null,
    };
  });

  // Son konuşulan üstte; hiç mesajı olmayanlar altta, kendi aralarında ada göre.
  satirlar.sort((a, b) => {
    if (a.sonMesajAn && b.sonMesajAn) return a.sonMesajAn < b.sonMesajAn ? 1 : -1;
    if (a.sonMesajAn) return -1;
    if (b.sonMesajAn) return 1;
    return a.adSoyad.localeCompare(b.adSoyad, "tr");
  });

  return { ok: true, satirlar, total: count ?? satirlar.length };
}

export type MesajSatiri = {
  id: string;
  gonderenId: string | null;
  gonderenRol: string;
  govde: string;
  duyuruMu: boolean;
  an: string;
  /** null = okundu bilgisi kapalı. [] = kimse okumadı. */
  okuyanlar: { workerId: string; an: string }[] | null;
};

/** Bir konuşmanın mesajları + ✓✓ makbuzları. En yeni ÜSTTE. */
export async function konusmaGecmisi(
  konusmaId: string,
  page: { limit: number; offset: number }
): Promise<{ ok: true; mesajlar: MesajSatiri[]; total: number } | { ok: false; code: string }> {
  const { data, error, count } = await supabaseAdmin
    .from("messages")
    .select("id, sender_worker_id, sender_role, body, broadcast_id, created_at", { count: "exact" })
    .eq("conversation_id", konusmaId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) return { ok: false, code: "db_error" };

  const rows = (data ?? []) as {
    id: string; sender_worker_id: string | null; sender_role: string;
    body: string; broadcast_id: string | null; created_at: string;
  }[];

  // Bayrak kapalıyken makbuz sorgusu HİÇ atılmaz ve alan null döner:
  // "bilinmiyor" — "okunmadı" değil.
  const okuyanlar = new Map<string, { workerId: string; an: string }[]>();
  if (READ_RECEIPTS_ENABLED && rows.length > 0) {
    const { data: rec } = await supabaseAdmin
      .from("message_receipts")
      .select("message_id, worker_id, read_at")
      .in("message_id", rows.map((m) => m.id));
    for (const r of (rec ?? []) as { message_id: string; worker_id: string; read_at: string }[]) {
      const l = okuyanlar.get(r.message_id) ?? [];
      l.push({ workerId: r.worker_id, an: r.read_at });
      okuyanlar.set(r.message_id, l);
    }
  }

  return {
    ok: true,
    total: count ?? rows.length,
    mesajlar: rows.map((m) => ({
      id: m.id,
      gonderenId: m.sender_worker_id,
      gonderenRol: m.sender_role,
      govde: m.body,
      duyuruMu: m.broadcast_id !== null,
      an: m.created_at,
      okuyanlar: READ_RECEIPTS_ENABLED ? okuyanlar.get(m.id) ?? [] : null,
    })),
  };
}
