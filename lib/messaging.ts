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

// ── GRUPLAR (migration 073) ─────────────────────────────────────────────────
//
// `conversations.kind` iki tür taşıyor: `direct` (şoför başına tek konuşma,
// 071 kuralı) ve `group` (üyeleri `conversation_members`'ta olan ortak oda).
//
// ── ADRESLEME: `[id]` HEM KONUŞMA HEM ŞOFÖR KİMLİĞİ ─────────────────────────
// Grubun şoförü yok, dolayısıyla 071'in "şoför kimliğiyle adresle" kuralı tek
// başına yetmiyor. Çözüm TEK SORGU: `id = X or worker_id = X`. İki ayrı tablo,
// rastgele UUID'ler — pratikte belirsizlik yok. URL değişmedi, hiçbir mevcut
// çağrı bozulmadı. Reddedilenler: `/s/<id>` `/g/<id>` önekleri (URL kırar),
// ayrı grup okuma ucu (aynı geçmiş mantığı iki yerde yaşardı).

export type HedefKonusma =
  | {
      tur: "birebir";
      /** Konuşma satırı ilk mesaja kadar YOK — o yüzden null olabilir. */
      konusmaId: string | null;
      soforId: string;
      baslik: string;
      arsivlendiMi: false;
      /** Birebir konuşmada okuma penceresi yok. */
      pencereSonu: null;
    }
  | {
      tur: "grup";
      konusmaId: string;
      soforId: null;
      baslik: string;
      arsivlendiMi: boolean;
      /**
       * Gruptan ÇIKARILMIŞ üyenin okuma penceresinin sonu (`left_at`).
       * Aktif üyede null. Bu tarihten SONRAKİ mesajları görmez — WhatsApp da
       * göstermiyor ve doğrusu bu: kişi orada değilken söylenene tanık olmadı.
       */
      pencereSonu: string | null;
    };

export type HedefSonuc =
  | { ok: true; hedef: HedefKonusma }
  | { ok: false; status: number; code: string };

/** Bir grup üyeliği satırı; yoksa null. Çıkarılmış üyede `leftAt` dolu. */
export async function uyelikGetir(
  konusmaId: string,
  workerId: string
): Promise<{ leftAt: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from("conversation_members")
    .select("left_at")
    .eq("conversation_id", konusmaId)
    .eq("worker_id", workerId)
    .maybeSingle();
  if (error || !data) return null;
  return { leftAt: (data.left_at as string | null) ?? null };
}

/**
 * `[id]` → hangi konuşma. TEK SORGU (bkz. yukarıdaki not).
 *
 * `okuyanId` verilirse grup için okuma penceresi de çözülür (çıkarılmış üye).
 * Hiçbir konuşma bulunamazsa `[id]` bir ŞOFÖR kimliği kabul edilir ve henüz
 * konuşması olmayan şoför için `konusmaId: null` döner — 071'in davranışı.
 */
export async function hedefCoz(
  id: string,
  okuyanId?: string
): Promise<HedefSonuc> {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("id, kind, worker_id, title, archived_at")
    .or(`id.eq.${id},worker_id.eq.${id}`)
    .maybeSingle();

  // Geçici DB hatası SESSİZCE "yok" sayılmaz — fail-closed.
  // PGRST116 = "sonuç yok/tek satır bekleniyordu": burada normal bir durum.
  if (error && error.code !== "PGRST116") {
    return { ok: false, status: 503, code: "db_error" };
  }

  if (data) {
    if (data.kind === "group") {
      let pencereSonu: string | null = null;
      if (okuyanId) {
        const u = await uyelikGetir(data.id as string, okuyanId);
        pencereSonu = u?.leftAt ?? null;
      }
      return {
        ok: true,
        hedef: {
          tur: "grup",
          konusmaId: data.id as string,
          soforId: null,
          baslik: (data.title as string) ?? "—",
          arsivlendiMi: data.archived_at !== null,
          pencereSonu,
        },
      };
    }
    // direct — `id` ile de `worker_id` ile de AYNI konuşmaya varılır.
    const sofor = await hedefSoforMu(data.worker_id as string);
    if (!sofor.ok) return sofor;
    return {
      ok: true,
      hedef: {
        tur: "birebir",
        konusmaId: data.id as string,
        soforId: data.worker_id as string,
        baslik: sofor.ad,
        arsivlendiMi: false,
        pencereSonu: null,
      },
    };
  }

  // Konuşma yok → `[id]` bir şoför kimliği olmalı.
  const sofor = await hedefSoforMu(id);
  if (!sofor.ok) return sofor;
  return {
    ok: true,
    hedef: {
      tur: "birebir",
      konusmaId: null,
      soforId: id,
      baslik: sofor.ad,
      arsivlendiMi: false,
      pencereSonu: null,
    },
  };
}

export type KonusmaErisimi =
  | {
      ok: true;
      /** Yazılacak mesajın `sender_role`ü — KAPIDAN türer, gövdeden değil. */
      role: "driver" | "admin";
      /** false = salt okunur (çıkarılmış üye ya da arşivlenmiş grup). */
      yazabilir: boolean;
    }
  | { ok: false; status: number; code: string };

/**
 * TEK ERİŞİM KURALI — birebir ve grup.
 *
 *   patron          → her konuşma
 *   şef ve şoför    → grupta ÜYE isem; birebirde `erisimCoz`un kuralı
 *
 * ── NEDEN GRUPTA ÜYELİK EKSENİ, KAPSAM DEĞİL ────────────────────────────────
 * "Her üyesi kapsamımda mı" kuralı hem pahalı hem KIRILGAN olurdu: bir üye
 * filo değiştirdiğinde şef, kurduğu gruba erişimini SESSİZCE kaybederdi.
 * Üyelik açık ve okunabilir bir olgudur; kapsam türetilmiş ve kayan bir şey.
 * (Kurucu, grup açılırken otomatik üye yapılacak — 4b.)
 *
 * ── ARŞİV KİLİDİ ────────────────────────────────────────────────────────────
 * Arşivlenmiş grupta HİÇ KİMSE yazamaz — patron dâhil. Burada `yazabilir:false`
 * dönüyor; çağıran bunu 409'a çevirir. Şemada da tetikleyici var (073,
 * SQLSTATE HK001) — bu kapı onun YERİNE değil, ÖNÜNE konuluyor: kullanıcıya
 * ham DB hatası yerine temiz bir 409 göstermek için.
 */
export async function erisimCozKonusma(
  actor: MesajAktoru,
  hedef: HedefKonusma
): Promise<KonusmaErisimi> {
  const { worker, isChief } = actor;

  if (hedef.tur === "birebir") {
    const r = await erisimCoz(actor, hedef.soforId);
    if (!r.ok) return r;
    return { ok: true, role: r.role, yazabilir: true };
  }

  // ── grup ──
  const rol: "driver" | "admin" = worker.is_admin || isChief ? "admin" : "driver";

  if (worker.is_admin) {
    return { ok: true, role: "admin", yazabilir: !hedef.arsivlendiMi };
  }

  const u = await uyelikGetir(hedef.konusmaId, worker.id);
  if (!u) {
    // Üye değil. Birebirdeki aynı gerekçe: 404 "böyle bir şey yok" bilgisini
    // sızdırır, 403 sızdırmaz.
    return { ok: false, status: 403, code: "forbidden" };
  }
  // Çıkarılmış üye: geçmişi okur, YAZAMAZ.
  if (u.leftAt !== null) return { ok: true, role: rol, yazabilir: false };
  return { ok: true, role: rol, yazabilir: !hedef.arsivlendiMi };
}

// ── PAYLAŞILAN OKUMALAR — panel ve mobil AYNI sorguyu kullanır ──────────────
//
// Bu fonksiyonlar önce yalnız /api/mobile/messages* içindeydi. Panel ekranı
// gelince ikinci bir kopya yazmak gerekecekti; o kopya ilk kural
// değişikliğinde geride kalır ve aynı filo iki yüzeyde FARKLI liste görürdü.

export type KonusmaSatiri = {
  tur: "birebir" | "grup";
  konusmaId: string | null;
  /** Ekranda görünen ad: birebirde şoförün adı, grupta grubun adı. */
  baslik: string;
  /** Yalnız birebirde dolu — arama yönlendirmesi ve profil bağı için. */
  soforId: string | null;
  telefon: string | null;
  filo: string | null;
  /** Yalnız grupta dolu: AKTİF üye sayısı. */
  uyeSayisi: number | null;
  arsivlendiMi: boolean;
  /** Yalnız grupta: bu kişi çıkarılmışsa true (satır salt okunur). */
  cikarildiMi: boolean;
  sonMesajAn: string | null;
  sonMesajOnizleme: string | null;
  sonGonderenRol: string | null;
  /** null = okundu bilgisi KAPALI (bilinmiyor), 0 = hepsi okundu. */
  okunmamis: number | null;
};

/**
 * Konuşma listesi — BİREBİRLER + GRUPLARIM tek listede (WhatsApp deseni).
 *
 * Birebir tarafının kaynağı ŞOFÖR LİSTESİDİR, konuşma tablosu değil: konuşma
 * satırı ilk mesaja kadar yoktur ve listeyi konuşmalardan üretseydik yönetici
 * henüz yazışmadığı şoförü hiç göremez, ona yazamazdı.
 *
 * Grup tarafının kaynağı ÜYELİKTİR; patronda tüm gruplar.
 */
export async function konusmaListesi(
  actor: MesajAktoru,
  rol: "admin" | "fleet_chief" | "driver",
  kapsam: string[] | null,
  page: { limit: number; offset: number }
): Promise<
  | { ok: true; satirlar: KonusmaSatiri[]; total: number; grupSayisi: number }
  | { ok: false; code: string }
> {
  // ── 1) BİREBİRLER ─────────────────────────────────────────────────────────
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
    id: string;
    name: string | null;
    phone: string | null;
    fleet: string | null;
  }[];

  const kMap = new Map<string, Record<string, unknown>>();
  if (workers.length > 0) {
    const { data: bk, error: bkErr } = await supabaseAdmin
      .from("conversations")
      .select("id, worker_id, last_message_at, last_message_preview, last_sender_role")
      .eq("kind", "direct")
      .in("worker_id", workers.map((w) => w.id));
    if (bkErr) return { ok: false, code: "db_error" };
    for (const c of (bk ?? []) as Record<string, unknown>[]) {
      kMap.set(c.worker_id as string, c);
    }
  }

  const satirlar: KonusmaSatiri[] = workers.map((w) => {
    const c = kMap.get(w.id);
    return {
      tur: "birebir" as const,
      konusmaId: (c?.id as string | undefined) ?? null,
      baslik: w.name ?? "—",
      soforId: w.id,
      telefon: w.phone ?? null,
      filo: w.fleet ?? null,
      uyeSayisi: null,
      arsivlendiMi: false,
      cikarildiMi: false,
      sonMesajAn: (c?.last_message_at as string | null) ?? null,
      sonMesajOnizleme: (c?.last_message_preview as string | null) ?? null,
      sonGonderenRol: (c?.last_sender_role as string | null) ?? null,
      okunmamis: 0,
    };
  });

  // ── 2) GRUPLAR ────────────────────────────────────────────────────────────
  // Patron TÜM grupları görür; şef ve şoför YALNIZ üyesi olduklarını.
  // Çıkarılmış üye de listede kalır (salt okunur) — WhatsApp davranışı ve
  // "verilen talimat ekrandan silinmemeli" gerekçesi (bkz. migration 073).
  const grupIdler: string[] = [];
  const cikarildi = new Map<string, boolean>();
  if (actor.worker.is_admin) {
    const { data: g, error: gErr } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("kind", "group");
    if (gErr) return { ok: false, code: "db_error" };
    for (const x of (g ?? []) as { id: string }[]) grupIdler.push(x.id);
  } else {
    const { data: u, error: uErr } = await supabaseAdmin
      .from("conversation_members")
      .select("conversation_id, left_at")
      .eq("worker_id", actor.worker.id);
    if (uErr) return { ok: false, code: "db_error" };
    for (const r of (u ?? []) as { conversation_id: string; left_at: string | null }[]) {
      grupIdler.push(r.conversation_id);
      cikarildi.set(r.conversation_id, r.left_at !== null);
    }
  }

  if (grupIdler.length > 0) {
    const { data: gk, error: gkErr } = await supabaseAdmin
      .from("conversations")
      .select("id, title, archived_at, last_message_at, last_message_preview, last_sender_role")
      .in("id", grupIdler);
    if (gkErr) return { ok: false, code: "db_error" };

    // Aktif üye sayıları — TEK sorgu; grup başına sorgu N+1 olurdu.
    const { data: uyeler } = await supabaseAdmin
      .from("conversation_members")
      .select("conversation_id")
      .in("conversation_id", grupIdler)
      .is("left_at", null);
    const sayac = new Map<string, number>();
    for (const r of (uyeler ?? []) as { conversation_id: string }[]) {
      sayac.set(r.conversation_id, (sayac.get(r.conversation_id) ?? 0) + 1);
    }

    for (const g of (gk ?? []) as Record<string, unknown>[]) {
      const gid = g.id as string;
      satirlar.push({
        tur: "grup" as const,
        konusmaId: gid,
        baslik: (g.title as string) ?? "—",
        soforId: null,
        telefon: null,
        filo: null,
        uyeSayisi: sayac.get(gid) ?? 0,
        arsivlendiMi: g.archived_at !== null,
        cikarildiMi: cikarildi.get(gid) === true,
        sonMesajAn: (g.last_message_at as string | null) ?? null,
        sonMesajOnizleme: (g.last_message_preview as string | null) ?? null,
        sonGonderenRol: (g.last_sender_role as string | null) ?? null,
        okunmamis: 0,
      });
    }
  }

  // ── 3) OKUNMAMIŞ SAYAÇLARI — birebir + grup, tek geçiş ────────────────────
  const okunmamis = await okunmamisSayaclari(
    satirlar.map((s) => s.konusmaId).filter(Boolean) as string[],
    actor.worker.id
  );
  for (const s of satirlar) {
    s.okunmamis = okunmamis ? (s.konusmaId ? okunmamis.get(s.konusmaId) ?? 0 : 0) : null;
  }

  // Son konuşulan üstte; hiç mesajı olmayanlar altta, kendi aralarında ada göre.
  satirlar.sort((a, b) => {
    if (a.sonMesajAn && b.sonMesajAn) return a.sonMesajAn < b.sonMesajAn ? 1 : -1;
    if (a.sonMesajAn) return -1;
    if (b.sonMesajAn) return 1;
    return a.baslik.localeCompare(b.baslik, "tr");
  });

  // ⚠️ `total` YALNIZ birebir sayfalamasının toplamıdır — gruplar sayfalanmıyor
  // (bir kişinin grup sayısı iki haneyi geçmez). İkisini tek sayıda toplamak
  // istemciye yanlış bir "kaç sayfa var" bilgisi verirdi; grup sayısı bu
  // yüzden AYRI dönüyor.
  return {
    ok: true,
    satirlar,
    total: count ?? satirlar.length,
    grupSayisi: grupIdler.length,
  };
}

export type MesajSatiri = {
  id: string;
  gonderenId: string | null;
  gonderenRol: string;
  /** Grupta ZORUNLU: "bu mesajı hangi şoför yazdı" görünmeli. */
  gonderenAd: string | null;
  govde: string;
  duyuruMu: boolean;
  an: string;
  /** null = okundu bilgisi kapalı. [] = kimse okumadı. */
  okuyanlar: { workerId: string; an: string }[] | null;
};

/**
 * Bir konuşmanın mesajları + ✓✓ makbuzları. En yeni ÜSTTE.
 *
 * `pencereSonu` doluysa (gruptan çıkarılmış üye) o andan SONRAKİ mesajlar
 * DÖNMEZ. Süzgeç burada, çağıranın hatırlamasına bırakılmıyor: unutulduğu
 * yerde çıkarılan üye grubu okumaya devam ederdi.
 */
export async function konusmaGecmisi(
  konusmaId: string,
  page: { limit: number; offset: number },
  pencereSonu?: string | null
): Promise<{ ok: true; mesajlar: MesajSatiri[]; total: number } | { ok: false; code: string }> {
  let q = supabaseAdmin
    .from("messages")
    .select("id, sender_worker_id, sender_role, body, broadcast_id, created_at", { count: "exact" })
    .eq("conversation_id", konusmaId)
    .is("deleted_at", null);
  if (pencereSonu) q = q.lte("created_at", pencereSonu);

  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) return { ok: false, code: "db_error" };

  const rows = (data ?? []) as {
    id: string;
    sender_worker_id: string | null;
    sender_role: string;
    body: string;
    broadcast_id: string | null;
    created_at: string;
  }[];

  // Gönderen adları — TEK sorgu. Grupta kimin yazdığı GÖRÜNMELİ; birebirde de
  // zararsız (iki yönetici aynı şoförle yazışırsa hangisi olduğu belli olur).
  const adlar = new Map<string, string>();
  const gonderenIdler = [
    ...new Set(rows.map((m) => m.sender_worker_id).filter(Boolean) as string[]),
  ];
  if (gonderenIdler.length > 0) {
    const { data: w } = await supabaseAdmin
      .from("workers")
      .select("id, name")
      .in("id", gonderenIdler);
    for (const x of (w ?? []) as { id: string; name: string | null }[]) {
      adlar.set(x.id, x.name ?? "—");
    }
  }

  // Bayrak kapalıyken makbuz sorgusu HİÇ atılmaz ve alan null döner:
  // "bilinmiyor" — "okunmadı" değil.
  const okuyanlar = new Map<string, { workerId: string; an: string }[]>();
  if (READ_RECEIPTS_ENABLED && rows.length > 0) {
    const { data: rec } = await supabaseAdmin
      .from("message_receipts")
      .select("message_id, worker_id, read_at")
      .in("message_id", rows.map((m) => m.id));
    for (const r of (rec ?? []) as {
      message_id: string;
      worker_id: string;
      read_at: string;
    }[]) {
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
      gonderenAd: m.sender_worker_id ? adlar.get(m.sender_worker_id) ?? null : null,
      govde: m.body,
      duyuruMu: m.broadcast_id !== null,
      an: m.created_at,
      okuyanlar: READ_RECEIPTS_ENABLED ? okuyanlar.get(m.id) ?? [] : null,
    })),
  };
}
