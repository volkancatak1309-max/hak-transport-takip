import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { hedefCoz, erisimCozKonusma, onizleme, type MesajAktoru } from "@/lib/messaging";
import { mesajSikayetiBildir } from "@/lib/push";
import { kimlikMi, tabloYok } from "@/lib/mesaj-engel";

/**
 * MESAJ MODERASYONU (migration 111) — BİLDİR · ENGELLE · YÖNETİCİ SİLMESİ.
 *
 * App Store Guideline 1.2 ve Google Play UGC kuralının istediği üç yetenek
 * burada TEK ÇEKİRDEKTE: mobil uçlar (`app/api/mobile/messages/{mesaj,
 * bildirimler,engeller}`) ve panel eylemleri (`app/actions/messages.ts`) AYNI
 * fonksiyonları çağırır. Dördüncü yetenek (süzgeç) `lib/mesaj-suzgec.ts`'te
 * ve `govdeCoz` üzerinden her gönderim yolunda zaten koşuyor.
 *
 * ── YETKİ ÖZETİ ─────────────────────────────────────────────────────────────
 *   bildir       → mesajı OKUYABİLEN herkes (şoför, şef, yönetici), kendi
 *                  mesajı hariç. Okuma kuralı `erisimCozKonusma`dan — ikinci
 *                  bir kopya yok.
 *   engelle      → herkes; hedef bir GRUP ARKADAŞI olmalı (yönetici hariç:
 *                  yönetici zaten her grubu görür). Süzgeç yalnız grupta.
 *   sil / listele / çöz → YALNIZ yönetici (`is_admin`). Şef ve şoför bu
 *                  listeyi görmez — kapı çağıranda VE burada (iki hat).
 *
 * ── TABLO YOKSA (111 o kiracıda henüz koşmadıysa) ──────────────────────────
 * Okuma yolları (engel süzgeci) BOŞ LİSTEYLE devam eder: tablo yoksa engel de
 * yazılamamıştır, yani boş liste DOĞRU cevaptır ve mesajlaşma kırılmaz.
 * Yazma/listeleme yolları 503 `tablo_yok` döner — sessiz başarı ya da sessiz
 * boş liste YOK ("sessiz eksik yasak" kuralı). Geçici bir DB hatası ise tablo
 * yokluğu SAYILMAZ: süzgeç uygulanamıyorsa engellenmiş mesajı göstermektense
 * 503 dönülür (fail-closed).
 */

export const SEBEPLER = ["harassment", "inappropriate", "spam", "other"] as const;
export type Sebep = (typeof SEBEPLER)[number];

export type ModSonuc<T> = { ok: true; data: T } | { ok: false; status: number; code: string };

const NOT_MAX = 500;

/** Bildirim listesinin tavanı — PostgREST'in 1000 satırına DAYANMADAN. */
const LISTE_TAVANI = 500;

// ═══ BİLDİR ═══════════════════════════════════════════════════════════════════

export function sebepCoz(ham: unknown): Sebep | null {
  return typeof ham === "string" && (SEBEPLER as readonly string[]).includes(ham)
    ? (ham as Sebep)
    : null;
}

/** İsteğe bağlı not: yoksa/boşsa null; 500'ü aşarsa hata. Şemayla AYNI sınır. */
export function notCoz(ham: unknown): { ok: true; not: string | null } | { ok: false; code: string } {
  if (ham === undefined || ham === null) return { ok: true, not: null };
  if (typeof ham !== "string") return { ok: false, code: "invalid_note" };
  const n = ham.trim();
  if (n.length === 0) return { ok: true, not: null };
  if (n.length > NOT_MAX) return { ok: false, code: "note_too_long" };
  return { ok: true, not: n };
}

/**
 * Bir mesajı yönetime BİLDİR.
 *
 * ── OKUYABİLDİĞİN MESAJI BİLDİREBİLİRSİN ───────────────────────────────────
 * Erişim `hedefCoz` + `erisimCozKonusma` — okuma kuralının kendisi. Gruptan
 * çıkarılmış üye ayrıldığı ANA KADARKİ mesajları okur; sonrakini bildiremez
 * (görmediği bir mesaj). Silinmiş mesaj 409: yönetim zaten kaldırmış.
 *
 * ── AYNI MESAJ İKİNCİ KEZ → 200, HATA DEĞİL ────────────────────────────────
 * Kısmi tekil indeks (111) çift açık bildirimi 23505 ile reddediyor; bu
 * kullanıcı için bir hata değil, aynı sonuç ("zaten bildirdin"). Yöneticiye
 * ikinci bir bildirim de GİTMEZ.
 */
export async function bildirimYaz(
  actor: MesajAktoru,
  mesajIdHam: unknown,
  sebepHam: unknown,
  notHam: unknown
): Promise<ModSonuc<{ bildirimId: string | null; zatenBildirildi: boolean }>> {
  if (!kimlikMi(mesajIdHam)) return { ok: false, status: 404, code: "message_not_found" };
  const sebep = sebepCoz(sebepHam);
  if (!sebep) return { ok: false, status: 400, code: "invalid_reason" };
  const not = notCoz(notHam);
  if (!not.ok) return { ok: false, status: 400, code: not.code };

  const { data: m, error: mErr } = await supabaseAdmin
    .from("messages")
    .select("id, conversation_id, sender_worker_id, created_at, deleted_at")
    .eq("id", mesajIdHam)
    .maybeSingle();
  if (mErr) return { ok: false, status: 503, code: "db_error" };
  if (!m) return { ok: false, status: 404, code: "message_not_found" };

  const h = await hedefCoz(m.conversation_id as string, actor.worker.id);
  if (!h.ok) return { ok: false, status: h.status, code: h.code };
  const e = await erisimCozKonusma(actor, h.hedef);
  if (!e.ok) return { ok: false, status: e.status, code: e.code };
  // Çıkarılmış üyenin okuma penceresi dışındaki mesaj — onun için YOK.
  if (h.hedef.tur === "grup" && h.hedef.pencereSonu && (m.created_at as string) > h.hedef.pencereSonu) {
    return { ok: false, status: 404, code: "message_not_found" };
  }

  if (m.sender_worker_id === actor.worker.id) return { ok: false, status: 400, code: "own_message" };
  if (m.deleted_at !== null) return { ok: false, status: 409, code: "message_deleted" };

  const { data: yeni, error, status } = await supabaseAdmin
    .from("mesaj_bildirimleri")
    .insert({
      message_id: m.id as string,
      bildiren_id: actor.worker.id,
      sebep,
      notlar: not.not,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: true, data: { bildirimId: null, zatenBildirildi: true } };
    if (tabloYok(error, status)) return { ok: false, status: 503, code: "tablo_yok" };
    return { ok: false, status: 500, code: "write_failed" };
  }

  // Yöneticilere push — fırlatmaz, 8 sn zaman aşımı taşır (lib/push.ts).
  // `await` bilinçli: sunucusuz yolda yanıttan sonra süren iş kesilebilir.
  await mesajSikayetiBildir({ mesajId: m.id as string, bildirenId: actor.worker.id, sebep });

  return { ok: true, data: { bildirimId: yeni.id as string, zatenBildirildi: false } };
}

// ═══ YÖNETİCİ: BİLDİRİLEN MESAJLAR ═══════════════════════════════════════════

export type BildirimDurumu = "open" | "resolved";

export type BildirimSatiri = {
  id: string;
  bildirenId: string | null;
  bildirenAd: string | null;
  sebep: Sebep;
  notlar: string | null;
  an: string;
  durum: BildirimDurumu;
  cozulduAn: string | null;
  cozenAd: string | null;
};

export type BildirilenMesaj = {
  mesajId: string;
  konusmaId: string;
  konusmaTuru: "birebir" | "grup";
  /** Grupta grubun adı, birebirde konuşmanın sahibi şoförün adı. */
  konusmaBaslik: string;
  gonderen: { id: string; adSoyad: string; aktif: boolean } | null;
  /** null = mesaj yönetici tarafından SİLİNDİ — metin istemciye gitmez. */
  govde: string | null;
  silindiMi: boolean;
  silinmeAn: string | null;
  silenAd: string | null;
  mesajAn: string;
  bildirimler: BildirimSatiri[];
  sonBildirimAn: string;
};

function yoneticiMi(actor: Pick<MesajAktoru, "worker">): boolean {
  return actor.worker.is_admin === true;
}

/**
 * Açık bildirimi olan MESAJ sayısı (satır değil: aynı mesajı üç kişi
 * bildirdiyse yönetici için tek iş). Tablo yoksa ya da okunamazsa null —
 * "bilinmiyor", sıfır değil.
 */
export async function acikBildirimSayisi(): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("mesaj_bildirimleri")
    .select("message_id")
    .eq("durum", "open")
    .limit(LISTE_TAVANI);
  if (error) return null;
  return new Set(((data ?? []) as { message_id: string }[]).map((r) => r.message_id)).size;
}

/**
 * Bildirilen mesajlar — MESAJ başına toplanmış, son bildirim en üstte.
 *
 * Silinmiş mesajın METNİ dönmez (`govde: null`): yönetici onu zaten kaldırdı
 * ve "silinen mesajın metni istemciye gitmez" kuralı moderasyon ekranında da
 * geçerli. Kim sildi, ne zaman sildi döner — iz.
 */
export async function bildirimListesi(
  actor: Pick<MesajAktoru, "worker">,
  durum: BildirimDurumu
): Promise<ModSonuc<{ kayitlar: BildirilenMesaj[]; acikSayisi: number | null; kirpildi: boolean }>> {
  if (!yoneticiMi(actor)) return { ok: false, status: 403, code: "admin_required" };

  const { data: satirlar, error } = await supabaseAdmin
    .from("mesaj_bildirimleri")
    .select("id, message_id, bildiren_id, sebep, notlar, durum, created_at, cozuldu_at, cozen_id")
    .eq("durum", durum)
    .order("created_at", { ascending: false })
    .limit(LISTE_TAVANI);
  if (error) {
    return { ok: false, status: 503, code: tabloYok(error) ? "tablo_yok" : "db_error" };
  }
  const rows = (satirlar ?? []) as {
    id: string;
    message_id: string;
    bildiren_id: string | null;
    sebep: Sebep;
    notlar: string | null;
    durum: BildirimDurumu;
    created_at: string;
    cozuldu_at: string | null;
    cozen_id: string | null;
  }[];

  const acikSayisi = durum === "open"
    ? new Set(rows.map((r) => r.message_id)).size
    : await acikBildirimSayisi();

  if (rows.length === 0) {
    return { ok: true, data: { kayitlar: [], acikSayisi, kirpildi: false } };
  }

  const mesajIdler = [...new Set(rows.map((r) => r.message_id))];
  const { data: mesajlar, error: mErr } = await supabaseAdmin
    .from("messages")
    .select("id, conversation_id, sender_worker_id, body, created_at, deleted_at, deleted_by")
    .in("id", mesajIdler);
  if (mErr) return { ok: false, status: 503, code: "db_error" };
  const mMap = new Map(
    ((mesajlar ?? []) as {
      id: string;
      conversation_id: string;
      sender_worker_id: string | null;
      body: string;
      created_at: string;
      deleted_at: string | null;
      deleted_by: string | null;
    }[]).map((m) => [m.id, m])
  );

  const konusmaIdler = [...new Set([...mMap.values()].map((m) => m.conversation_id))];
  const { data: konusmalar } = await supabaseAdmin
    .from("conversations")
    .select("id, kind, title, worker_id")
    .in("id", konusmaIdler);
  const kMap = new Map(
    ((konusmalar ?? []) as { id: string; kind: string; title: string | null; worker_id: string | null }[]).map(
      (k) => [k.id, k]
    )
  );

  // Ad sözlüğü — TEK sorgu: bildirenler, gönderenler, çözenler, silenler ve
  // birebir konuşmaların sahipleri.
  const kisiIdler = new Set<string>();
  for (const r of rows) {
    if (r.bildiren_id) kisiIdler.add(r.bildiren_id);
    if (r.cozen_id) kisiIdler.add(r.cozen_id);
  }
  for (const m of mMap.values()) {
    if (m.sender_worker_id) kisiIdler.add(m.sender_worker_id);
    if (m.deleted_by) kisiIdler.add(m.deleted_by);
  }
  for (const k of kMap.values()) if (k.worker_id) kisiIdler.add(k.worker_id);

  const kisiler = new Map<string, { ad: string; aktif: boolean }>();
  if (kisiIdler.size > 0) {
    const { data: w } = await supabaseAdmin
      .from("workers")
      .select("id, name, is_active")
      .in("id", [...kisiIdler]);
    for (const x of (w ?? []) as { id: string; name: string | null; is_active: boolean }[]) {
      kisiler.set(x.id, { ad: x.name ?? "—", aktif: x.is_active === true });
    }
  }
  const ad = (id: string | null) => (id ? kisiler.get(id)?.ad ?? null : null);

  const gruplar = new Map<string, BildirilenMesaj>();
  for (const r of rows) {
    const m = mMap.get(r.message_id);
    if (!m) continue; // sert silinmiş mesaj — cascade bildirimi de götürür; yarış penceresi
    let g = gruplar.get(r.message_id);
    if (!g) {
      const k = kMap.get(m.conversation_id);
      const grup = k?.kind === "group";
      const silindi = m.deleted_at !== null;
      g = {
        mesajId: m.id,
        konusmaId: m.conversation_id,
        konusmaTuru: grup ? "grup" : "birebir",
        konusmaBaslik: grup ? (k?.title ?? "—") : (ad(k?.worker_id ?? null) ?? "—"),
        gonderen: m.sender_worker_id
          ? {
              id: m.sender_worker_id,
              adSoyad: ad(m.sender_worker_id) ?? "—",
              aktif: kisiler.get(m.sender_worker_id)?.aktif === true,
            }
          : null,
        govde: silindi ? null : m.body,
        silindiMi: silindi,
        silinmeAn: m.deleted_at,
        silenAd: ad(m.deleted_by),
        mesajAn: m.created_at,
        bildirimler: [],
        sonBildirimAn: r.created_at,
      };
      gruplar.set(r.message_id, g);
    }
    g.bildirimler.push({
      id: r.id,
      bildirenId: r.bildiren_id,
      bildirenAd: ad(r.bildiren_id),
      sebep: r.sebep,
      notlar: r.notlar,
      an: r.created_at,
      durum: r.durum,
      cozulduAn: r.cozuldu_at,
      cozenAd: ad(r.cozen_id),
    });
    if (r.created_at > g.sonBildirimAn) g.sonBildirimAn = r.created_at;
  }

  const kayitlar = [...gruplar.values()].sort((a, b) => (a.sonBildirimAn < b.sonBildirimAn ? 1 : -1));
  return {
    ok: true,
    data: { kayitlar, acikSayisi, kirpildi: rows.length >= LISTE_TAVANI },
  };
}

/**
 * Bir mesajın AÇIK bildirimlerini çözüldü işaretle (hepsini birden — yönetici
 * için iş mesaj başına). Zaten çözülmüşse 200 + `cozulen: 0`.
 */
export async function bildirimCoz(
  actor: Pick<MesajAktoru, "worker">,
  mesajIdHam: unknown
): Promise<ModSonuc<{ cozulen: number }>> {
  if (!yoneticiMi(actor)) return { ok: false, status: 403, code: "admin_required" };
  if (!kimlikMi(mesajIdHam)) return { ok: false, status: 404, code: "not_found" };

  const { data, error, status } = await supabaseAdmin
    .from("mesaj_bildirimleri")
    .update({ durum: "resolved", cozuldu_at: new Date().toISOString(), cozen_id: actor.worker.id })
    .eq("message_id", mesajIdHam)
    .eq("durum", "open")
    .select("id");
  if (error) return { ok: false, status: 503, code: tabloYok(error, status) ? "tablo_yok" : "db_error" };
  const cozulen = (data ?? []).length;
  if (cozulen > 0) return { ok: true, data: { cozulen } };

  // Hiç açık yoktu: ya zaten çözülmüş (200) ya da bu mesaj hiç bildirilmemiş (404).
  const { count } = await supabaseAdmin
    .from("mesaj_bildirimleri")
    .select("id", { count: "exact", head: true })
    .eq("message_id", mesajIdHam);
  if ((count ?? 0) === 0) return { ok: false, status: 404, code: "not_found" };
  return { ok: true, data: { cozulen: 0 } };
}

// ═══ YÖNETİCİ: MESAJ SİLME ═══════════════════════════════════════════════════

/**
 * Konuşmanın denormalize "son mesaj" alanlarını, SİLİNMEMİŞ en yeni mesajdan
 * yeniden kurar. Silinen mesaj sonuncuysa liste önizlemesi onun METNİNİ
 * taşımaya devam ederdi — "metin istemciye gitmez" kuralının arka kapısı.
 */
async function onizlemeTazele(konusmaId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("messages")
    .select("body, sender_role, created_at")
    .eq("conversation_id", konusmaId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  await supabaseAdmin
    .from("conversations")
    .update({
      last_message_at: (data?.created_at as string | undefined) ?? null,
      last_message_preview: data ? onizleme(data.body as string) : null,
      last_sender_role: (data?.sender_role as string | undefined) ?? null,
    })
    .eq("id", konusmaId);
}

/**
 * YÖNETİCİ SİLMESİ — yumuşak (071 `deleted_at` / `deleted_by`).
 *
 * Satır ve METNİ veritabanında KALIR (moderasyon kaydı, ihtilafta delil);
 * okuma yolu (`konusmaGecmisi`) metni istemciye göndermez ve herkes "Mesaj
 * yönetici tarafından kaldırıldı" görür. Arşivlenmiş grupta da silinebilir:
 * arşiv YAZMAYI kilitler (073 tetikleyicisi yalnız INSERT), moderasyonu değil.
 *
 * Arayüzde geri alma YOK. Gerekirse SQL ile `deleted_at = null` (iz
 * `audit_log`ta, `message_delete`).
 */
export async function mesajSil(
  actor: Pick<MesajAktoru, "worker">,
  mesajIdHam: unknown
): Promise<ModSonuc<{ konusmaId: string; zatenSilinmisti: boolean }>> {
  if (!yoneticiMi(actor)) return { ok: false, status: 403, code: "admin_required" };
  if (!kimlikMi(mesajIdHam)) return { ok: false, status: 404, code: "message_not_found" };

  const { data: m, error } = await supabaseAdmin
    .from("messages")
    .select("id, conversation_id, deleted_at")
    .eq("id", mesajIdHam)
    .maybeSingle();
  if (error) return { ok: false, status: 503, code: "db_error" };
  if (!m) return { ok: false, status: 404, code: "message_not_found" };
  const konusmaId = m.conversation_id as string;
  if (m.deleted_at !== null) return { ok: true, data: { konusmaId, zatenSilinmisti: true } };

  const { data: guncel, error: uErr } = await supabaseAdmin
    .from("messages")
    .update({ deleted_at: new Date().toISOString(), deleted_by: actor.worker.id })
    .eq("id", mesajIdHam)
    .is("deleted_at", null)
    .select("id");
  if (uErr) return { ok: false, status: 500, code: "write_failed" };
  // Yarış: iki yönetici aynı anda sildiyse ikincisi 0 satır günceller — aynı sonuç.
  const zatenSilinmisti = (guncel ?? []).length === 0;

  await onizlemeTazele(konusmaId);
  return { ok: true, data: { konusmaId, zatenSilinmisti } };
}

// ═══ ENGELLE / ENGELİ KALDIR ═════════════════════════════════════════════════

export type EngelSatiri = { workerId: string; adSoyad: string; an: string };

/**
 * İki kişi ortak bir grupta mı (biri çıkarılmış olsa da — engel, ayrıldığı
 * ana kadarki geçmişi de süzer). Erişimi olmayan birinin adını engel
 * listesinden öğrenmenin kapısını kapatıyor.
 */
async function ortakGrupVar(a: string, b: string): Promise<boolean | null> {
  const { data: benim, error } = await supabaseAdmin
    .from("conversation_members")
    .select("conversation_id")
    .eq("worker_id", a);
  if (error) return null;
  const idler = ((benim ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id);
  if (idler.length === 0) return false;
  const { data: ortak, error: oErr } = await supabaseAdmin
    .from("conversation_members")
    .select("conversation_id")
    .eq("worker_id", b)
    .in("conversation_id", idler)
    .limit(1);
  if (oErr) return null;
  return (ortak ?? []).length > 0;
}

export async function engelle(
  actor: MesajAktoru,
  hedefHam: unknown
): Promise<ModSonuc<{ workerId: string; adSoyad: string; zatenEngelli: boolean }>> {
  if (!kimlikMi(hedefHam)) return { ok: false, status: 400, code: "worker_required" };
  if (hedefHam === actor.worker.id) return { ok: false, status: 400, code: "self_block" };

  const { data: w, error } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .eq("id", hedefHam)
    .maybeSingle();
  if (error) return { ok: false, status: 503, code: "db_error" };
  if (!w) return { ok: false, status: 404, code: "worker_not_found" };

  if (!actor.worker.is_admin) {
    const ortak = await ortakGrupVar(actor.worker.id, hedefHam);
    if (ortak === null) return { ok: false, status: 503, code: "db_error" };
    // 404 değil 403: "böyle biri var mı" bilgisi sızmasın (erisimCoz gerekçesi).
    if (!ortak) return { ok: false, status: 403, code: "forbidden" };
  }

  const { data: yazilan, error: yErr, status: yDurum } = await supabaseAdmin
    .from("mesaj_engeller")
    .upsert(
      { engelleyen_id: actor.worker.id, engellenen_id: hedefHam },
      { onConflict: "engelleyen_id,engellenen_id", ignoreDuplicates: true }
    )
    .select("engellenen_id");
  if (yErr) {
    const yok = tabloYok(yErr, yDurum);
    return { ok: false, status: yok ? 503 : 500, code: yok ? "tablo_yok" : "write_failed" };
  }
  return {
    ok: true,
    data: {
      workerId: hedefHam,
      adSoyad: (w.name as string | null) ?? "—",
      // ignoreDuplicates: çakışan satır DÖNMEZ — boş dönüş "zaten engelliydi".
      zatenEngelli: (yazilan ?? []).length === 0,
    },
  };
}

export async function engelKaldir(
  actor: Pick<MesajAktoru, "worker">,
  hedefHam: unknown
): Promise<ModSonuc<{ kaldirildi: boolean }>> {
  if (!kimlikMi(hedefHam)) return { ok: false, status: 400, code: "worker_required" };
  const { data, error, status } = await supabaseAdmin
    .from("mesaj_engeller")
    .delete()
    .eq("engelleyen_id", actor.worker.id)
    .eq("engellenen_id", hedefHam)
    .select("engellenen_id");
  if (error) {
    const yok = tabloYok(error, status);
    return { ok: false, status: yok ? 503 : 500, code: yok ? "tablo_yok" : "write_failed" };
  }
  return { ok: true, data: { kaldirildi: (data ?? []).length > 0 } };
}

/** Kendi engel listem — en yeni üstte. Tablo yoksa 503 (sessiz boş liste yok). */
export async function engelleriGetir(
  actor: Pick<MesajAktoru, "worker">
): Promise<ModSonuc<{ engeller: EngelSatiri[] }>> {
  const { data, error } = await supabaseAdmin
    .from("mesaj_engeller")
    .select("engellenen_id, created_at")
    .eq("engelleyen_id", actor.worker.id)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, status: 503, code: tabloYok(error) ? "tablo_yok" : "db_error" };
  const rows = (data ?? []) as { engellenen_id: string; created_at: string }[];
  if (rows.length === 0) return { ok: true, data: { engeller: [] } };

  const { data: w } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .in("id", rows.map((r) => r.engellenen_id));
  const adlar = new Map(((w ?? []) as { id: string; name: string | null }[]).map((x) => [x.id, x.name ?? "—"]));
  return {
    ok: true,
    data: {
      engeller: rows.map((r) => ({
        workerId: r.engellenen_id,
        adSoyad: adlar.get(r.engellenen_id) ?? "—",
        an: r.created_at,
      })),
    },
  };
}
