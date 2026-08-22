import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { hedefCoz, uyelikGetir, type MesajAktoru } from "@/lib/messaging";

/**
 * GRUP YÖNETİMİ (migration 073) — kur / ad değiştir / üye ekle-çıkar / arşivle.
 *
 * Okuma tarafı lib/messaging.ts'te (hedefCoz, erisimCozKonusma, konusmaListesi,
 * konusmaGecmisi). Burası YALNIZ yazma tarafı; ikisi ayrı dosyada çünkü okuma
 * her istekte, yazma nadiren çalışıyor ve karıştırmak messaging.ts'i şişirirdi.
 *
 * ── YETKİ ÖZETİ ─────────────────────────────────────────────────────────────
 *   kurma      → patron VEYA filo şefi (şef: YALNIZ kendi kapsamındakilerle)
 *   yönetme    → patron VEYA grubun AKTİF ÜYESİ olan filo şefi
 *   şoför      → HİÇBİRİ (üye olsa bile). Grupta yazabilir, yönetemez.
 *
 * Şefin grup kurabilmesi bilinçli: zaten o şoförlerin her birine birebir
 * yazabiliyor, yani grup ona YENİ ERİŞİM vermiyor — yalnız o kişilerin
 * birbirini görmesini sağlıyor, ki bu da tam olarak şefin yönettiği birim.
 */

export type GrupSonuc<T> = { ok: true; data: T } | { ok: false; status: number; code: string };

const BASLIK_MAX = 120;

export function baslikCoz(ham: unknown): { ok: true; baslik: string } | { ok: false; code: string } {
  if (typeof ham !== "string") return { ok: false, code: "title_required" };
  const b = ham.trim().replace(/\s+/g, " ");
  if (b.length === 0) return { ok: false, code: "title_empty" };
  if (b.length > BASLIK_MAX) return { ok: false, code: "title_too_long" };
  return { ok: true, baslik: b };
}

/**
 * Verilen kimliklerin gruba eklenebilir olduğunu doğrular.
 *
 * ⚠️ ŞEF KAPSAM DENETİMİ BURADA — hem kurarken hem sonradan eklerken aynı
 * fonksiyondan geçiyor. İki ayrı yere yazsaydık biri unutulur ve şef kapsam
 * dışı birini "sonradan ekleme" yolundan içeri alabilirdi.
 */
async function uyeleriDogrula(
  actor: MesajAktoru,
  uyeIdler: string[]
): Promise<GrupSonuc<{ idler: string[] }>> {
  const benzersiz = [...new Set(uyeIdler.filter((x) => typeof x === "string" && x.length > 0))];
  if (benzersiz.length === 0) return { ok: false, status: 400, code: "members_required" };

  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("id, is_active")
    .in("id", benzersiz);
  if (error) return { ok: false, status: 503, code: "db_error" };

  const bulunan = (data ?? []) as { id: string; is_active: boolean }[];
  if (bulunan.length !== benzersiz.length) {
    return { ok: false, status: 404, code: "worker_not_found" };
  }
  if (bulunan.some((w) => w.is_active !== true)) {
    // Ayrılmış personeli gruba eklemek anlamsız: mesajı hiç görmeyecek.
    return { ok: false, status: 409, code: "worker_inactive" };
  }
  // ── TEST HESABI GRUBA EKLENEBİLİR — bilinçli ────────────────────────────
  // İlk yazımda `is_test` reddediliyordu ve YANLIŞTI: bu depodaki test-verisi
  // kuralı "OTOMATİK/TOPLU toplamalara sızmasın" demek (liste, metrik, rapor,
  // duyuru dağıtımı). Grup üyeliği toplama değil, bir insanın TEK TEK yaptığı
  // AÇIK SEÇİM. Reddetmek, özelliğin canlıda hiç denenememesi demekti —
  // nitekim 4b ölçümünde 13 test birden bu yüzden düştü.
  //
  // Duyuru dağıtımı ve yönetici listeleri `is_test`i elemeye DEVAM EDİYOR;
  // ayrım orada: otomatik dahil etme eler, açık seçim elemez.

  if (!actor.worker.is_admin) {
    if (!actor.isChief) return { ok: false, status: 403, code: "admin_required" };
    const disarda = benzersiz.filter((id) => id !== actor.worker.id && !actor.fleetScope.isFleetWorker(id));
    if (disarda.length > 0) return { ok: false, status: 403, code: "scope" };
  }
  return { ok: true, data: { idler: benzersiz } };
}

/**
 * Grubu YÖNETME yetkisi: patron ya da grubun AKTİF ÜYESİ olan filo şefi.
 *
 * Şoför üye olsa da yönetemez — grup bir yönetim aracı, üyelik oradaki yerini
 * belirler, yetkisini değil. Ayrılmış (`left_at` dolu) şef de yönetemez.
 */
async function yonetimYetkisi(
  actor: MesajAktoru,
  konusmaId: string
): Promise<GrupSonuc<{ arsivlendiMi: boolean }>> {
  const h = await hedefCoz(konusmaId);
  if (!h.ok) return { ok: false, status: h.status, code: h.code };
  if (h.hedef.tur !== "grup") return { ok: false, status: 404, code: "not_a_group" };

  if (actor.worker.is_admin) {
    return { ok: true, data: { arsivlendiMi: h.hedef.arsivlendiMi } };
  }
  if (!actor.isChief) return { ok: false, status: 403, code: "admin_required" };

  const u = await uyelikGetir(konusmaId, actor.worker.id);
  // Üye değilse grubun VARLIĞINI da doğrulamıyoruz: 403, 404 değil.
  if (!u || u.leftAt !== null) return { ok: false, status: 403, code: "forbidden" };
  return { ok: true, data: { arsivlendiMi: h.hedef.arsivlendiMi } };
}

// ── KUR ─────────────────────────────────────────────────────────────────────

export async function grupKur(
  actor: MesajAktoru,
  baslikHam: unknown,
  uyeIdlerHam: unknown
): Promise<GrupSonuc<{ konusmaId: string; baslik: string; uyeSayisi: number }>> {
  if (!actor.worker.is_admin && !actor.isChief) {
    return { ok: false, status: 403, code: "admin_required" };
  }
  const b = baslikCoz(baslikHam);
  if (!b.ok) return { ok: false, status: 400, code: b.code };
  if (!Array.isArray(uyeIdlerHam)) return { ok: false, status: 400, code: "members_required" };

  const u = await uyeleriDogrula(actor, uyeIdlerHam as string[]);
  if (!u.ok) return u;

  // ⚠️ KURUCU OTOMATİK ÜYE. Erişim üyelik ekseninde (lib/messaging.ts
  // erisimCozKonusma) — kurucu üye olmasaydı kendi kurduğu grubu AÇAMAZDI.
  // Patron zaten her grubu görür ama üye olması listede de görünmesini sağlar.
  const uyeler = [...new Set([...u.data.idler, actor.worker.id])];

  const { data: konusma, error } = await supabaseAdmin
    .from("conversations")
    .insert({ kind: "group", title: b.baslik, created_by: actor.worker.id })
    .select("id")
    .single();
  if (error) return { ok: false, status: 500, code: error.message };

  const konusmaId = konusma.id as string;
  const { error: uErr } = await supabaseAdmin.from("conversation_members").insert(
    uyeler.map((w) => ({ conversation_id: konusmaId, worker_id: w, added_by: actor.worker.id }))
  );
  if (uErr) {
    // Üyesiz grup yetim kalır ve hiç kimse açamaz — geri al.
    await supabaseAdmin.from("conversations").delete().eq("id", konusmaId);
    return { ok: false, status: 500, code: uErr.message };
  }

  return { ok: true, data: { konusmaId, baslik: b.baslik, uyeSayisi: uyeler.length } };
}

// ── DETAY ───────────────────────────────────────────────────────────────────

export type GrupUyesi = {
  workerId: string;
  adSoyad: string;
  filo: string | null;
  cikarildiMi: boolean;
  katildi: string;
  ayrildi: string | null;
};

/**
 * Grup detayı + üye listesi. OKUMA yetkisi yönetim yetkisinden GENİŞ: her üye
 * (çıkarılmış olan dâhil) grubu ve üyelerini görür — WhatsApp'ta da öyle.
 */
export async function grupDetay(
  actor: MesajAktoru,
  konusmaId: string
): Promise<
  GrupSonuc<{
    konusmaId: string;
    baslik: string;
    arsivlendiMi: boolean;
    yonetebilir: boolean;
    yazabilir: boolean;
    uyeler: GrupUyesi[];
  }>
> {
  const h = await hedefCoz(konusmaId, actor.worker.id);
  if (!h.ok) return { ok: false, status: h.status, code: h.code };
  if (h.hedef.tur !== "grup") return { ok: false, status: 404, code: "not_a_group" };

  const { erisimCozKonusma } = await import("@/lib/messaging");
  const e = await erisimCozKonusma(actor, h.hedef);
  if (!e.ok) return { ok: false, status: e.status, code: e.code };

  const { data: uyeSatirlari, error } = await supabaseAdmin
    .from("conversation_members")
    .select("worker_id, joined_at, left_at")
    .eq("conversation_id", konusmaId);
  if (error) return { ok: false, status: 503, code: "db_error" };

  const satirlar = (uyeSatirlari ?? []) as {
    worker_id: string; joined_at: string; left_at: string | null;
  }[];
  const adlar = new Map<string, { ad: string; filo: string | null }>();
  if (satirlar.length > 0) {
    const { data: w } = await supabaseAdmin
      .from("workers")
      .select("id, name, fleet")
      .in("id", satirlar.map((x) => x.worker_id));
    for (const x of (w ?? []) as { id: string; name: string | null; fleet: string | null }[]) {
      adlar.set(x.id, { ad: x.name ?? "—", filo: x.fleet ?? null });
    }
  }

  const y = await yonetimYetkisi(actor, konusmaId);

  return {
    ok: true,
    data: {
      konusmaId,
      baslik: h.hedef.baslik,
      arsivlendiMi: h.hedef.arsivlendiMi,
      yonetebilir: y.ok,
      yazabilir: e.yazabilir,
      uyeler: satirlar
        .map((s) => ({
          workerId: s.worker_id,
          adSoyad: adlar.get(s.worker_id)?.ad ?? "—",
          filo: adlar.get(s.worker_id)?.filo ?? null,
          cikarildiMi: s.left_at !== null,
          katildi: s.joined_at,
          ayrildi: s.left_at,
        }))
        .sort((a, b) => Number(a.cikarildiMi) - Number(b.cikarildiMi) || a.adSoyad.localeCompare(b.adSoyad, "tr")),
    },
  };
}

// ── AD DEĞİŞTİR ─────────────────────────────────────────────────────────────

export async function grupAdiDegistir(
  actor: MesajAktoru,
  konusmaId: string,
  baslikHam: unknown
): Promise<GrupSonuc<{ baslik: string }>> {
  const y = await yonetimYetkisi(actor, konusmaId);
  if (!y.ok) return y;
  // Arşivlenmiş grup DEĞİŞMEZ — adını değiştirmek de bir yazmadır.
  if (y.data.arsivlendiMi) return { ok: false, status: 409, code: "conversation_archived" };

  const b = baslikCoz(baslikHam);
  if (!b.ok) return { ok: false, status: 400, code: b.code };

  const { error } = await supabaseAdmin
    .from("conversations")
    .update({ title: b.baslik })
    .eq("id", konusmaId);
  if (error) return { ok: false, status: 500, code: error.message };
  return { ok: true, data: { baslik: b.baslik } };
}

// ── ÜYE EKLE ────────────────────────────────────────────────────────────────

export async function uyeEkle(
  actor: MesajAktoru,
  konusmaId: string,
  uyeIdlerHam: unknown
): Promise<GrupSonuc<{ eklenen: number }>> {
  const y = await yonetimYetkisi(actor, konusmaId);
  if (!y.ok) return y;
  if (y.data.arsivlendiMi) return { ok: false, status: 409, code: "conversation_archived" };
  if (!Array.isArray(uyeIdlerHam)) return { ok: false, status: 400, code: "members_required" };

  const u = await uyeleriDogrula(actor, uyeIdlerHam as string[]);
  if (!u.ok) return u;

  // upsert: daha önce ÇIKARILMIŞ biri yeniden eklenirse `left_at` temizlenir
  // ve YENİ SATIR AÇILMAZ (PK çifti). Aksi hâlde "kaç kez çıkarıldı" gürültüsü
  // üyelik sorgusunu belirsizleştirirdi.
  const { error } = await supabaseAdmin.from("conversation_members").upsert(
    u.data.idler.map((w) => ({
      conversation_id: konusmaId,
      worker_id: w,
      added_by: actor.worker.id,
      left_at: null,
      removed_by: null,
    })),
    { onConflict: "conversation_id,worker_id" }
  );
  if (error) return { ok: false, status: 500, code: error.message };
  return { ok: true, data: { eklenen: u.data.idler.length } };
}

// ── ÜYE ÇIKAR ───────────────────────────────────────────────────────────────

export async function uyeCikar(
  actor: MesajAktoru,
  konusmaId: string,
  workerId: string
): Promise<GrupSonuc<{ ayrildi: string }>> {
  const y = await yonetimYetkisi(actor, konusmaId);
  if (!y.ok) return y;
  if (y.data.arsivlendiMi) return { ok: false, status: 409, code: "conversation_archived" };

  const u = await uyelikGetir(konusmaId, workerId);
  if (!u) return { ok: false, status: 404, code: "not_a_member" };
  if (u.leftAt !== null) return { ok: false, status: 409, code: "already_removed" };

  // SATIR SİLİNMEZ (migration 073): çıkarılan kişi geçmişi bu ana kadar
  // okumaya devam eder. Ona verilen talimat ekranından silinmemeli.
  const ayrildi = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("conversation_members")
    .update({ left_at: ayrildi, removed_by: actor.worker.id })
    .eq("conversation_id", konusmaId)
    .eq("worker_id", workerId);
  if (error) return { ok: false, status: 500, code: error.message };
  return { ok: true, data: { ayrildi } };
}

// ── ARŞİVLE / ARŞİVDEN ÇIKAR ────────────────────────────────────────────────

/**
 * Grup SİLİNMEZ, arşivlenir: herkes için salt okunur olur, geçmiş bozulmaz.
 * `arsivle:false` geri alır — DB tetikleyicisi arşiv kalkınca yazmaya izin
 * verir (073'te ölçüldü).
 */
export async function grupArsivle(
  actor: MesajAktoru,
  konusmaId: string,
  arsivle: boolean
): Promise<GrupSonuc<{ arsivlendiMi: boolean; an: string | null }>> {
  const y = await yonetimYetkisi(actor, konusmaId);
  if (!y.ok) return y;

  const an = arsivle ? new Date().toISOString() : null;
  const { error } = await supabaseAdmin
    .from("conversations")
    .update({ archived_at: an, archived_by: arsivle ? actor.worker.id : null })
    .eq("id", konusmaId);
  if (error) return { ok: false, status: 500, code: error.message };
  return { ok: true, data: { arsivlendiMi: arsivle, an } };
}
