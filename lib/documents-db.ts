import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu } from "@/lib/fault-reports";

/**
 * ŞOFÖR BELGE TAKİBİ — veri katmanı (migration 078).
 *
 * ═══ İKİ EKSEN, BİRBİRİNE KARIŞMAZ ═══
 *
 * EHLİYET burada DEĞİL. `workers.license_no` / `license_expiry` kendi
 * ekseninde kalıyor ve kendi dikkat kalemini kendi kuralıyla üretiyor
 * (lib/admin-dashboard.ts: dolmuş ehliyetin ALT SINIRI YOKTUR). Bu modül ona
 * hiç dokunmuyor; taşımak 15+ çağrı yerini kırardı (bkz. 078 başlığı).
 *
 * ═══ TÜR LİSTESİ ÜRÜNE GÖMÜLÜ DEĞİL ═══
 *
 * Kiracı kendi belgelerini tanımlıyor: TR'de SRC + psikoteknik, DACH'ta
 * Aufenthaltstitel, AB'de CPC, yüke göre ADR. Kodda hiçbir yerde sabit tür
 * listesi YOKTUR ve olmamalıdır — bir enum, her yeni ülke için dağıtım
 * gerektirirdi.
 *
 * ═══ 078 YOKSA ═══
 *
 * Tüm okumalar `tabloYok` bayrağıyla boş döner; pano ve ekranlar çalışmaya
 * devam eder, yalnız belge kalemleri çıkmaz. Aynı kademeli düşüş deseni
 * action_snoozes (058), arıza bildirimi (056/057) ve maliyet oranlarında
 * (076/077) zaten var.
 */

export type DocumentType = {
  id: string;
  code: string;
  label: string;
  warnDays: number;
  requiresNumber: boolean;
  active: boolean;
  sortOrder: number;
};

export type WorkerDocument = {
  id: string;
  workerId: string;
  typeId: string;
  expiresAt: string;
  documentNo: string | null;
  note: string | null;
};

/** Panonun ihtiyacı: belge + türü + sahibi, tek okumada. */
export type ExpiringDocument = {
  id: string;
  workerId: string;
  workerName: string;
  typeCode: string;
  typeLabel: string;
  warnDays: number;
  expiresAt: string;
  /** Dolmasına kaç gün — negatif = doldu. */
  days: number;
};

const TYPE_COLS = "id, code, label, warn_days, requires_number, active, sort_order";
const DOC_COLS = "id, worker_id, type_id, expires_at, document_no, note";

function tipCevir(r: Record<string, unknown>): DocumentType {
  return {
    id: String(r.id),
    code: String(r.code),
    label: String(r.label),
    warnDays: Number(r.warn_days),
    requiresNumber: Boolean(r.requires_number),
    active: Boolean(r.active),
    sortOrder: Number(r.sort_order),
  };
}

export async function listDocumentTypes(
  yalnizAktif = false
): Promise<{ types: DocumentType[]; tabloYok: boolean }> {
  // test-visible: belge türü SÖZLÜĞÜ — kişiye ait veri değil, kiracının
  // tanımladığı etiket kümesi. Test kaydı kavramı bu tabloda YOK (is_test
  // kolonu da yok); eleyecek bir şey olmadığı için filtre de yok.
  let q = supabaseAdmin.from("document_types").select(TYPE_COLS);
  if (yalnizAktif) q = q.eq("active", true);
  const { data, error } = await q.order("sort_order").order("label");
  if (error) return { types: [], tabloYok: tabloYokMu(error) };
  return {
    types: ((data ?? []) as Record<string, unknown>[]).map(tipCevir),
    tabloYok: false,
  };
}

/** Tek şoförün belgeleri — türüyle birlikte. */
export async function listWorkerDocuments(
  workerId: string
): Promise<{ docs: (WorkerDocument & { type: DocumentType | null })[]; tabloYok: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("worker_documents")
    .select(DOC_COLS)
    .eq("worker_id", workerId)
    .order("expires_at");
  if (error) return { docs: [], tabloYok: tabloYokMu(error) };

  const { types } = await listDocumentTypes();
  const byId = new Map(types.map((t) => [t.id, t]));
  return {
    docs: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      workerId: String(r.worker_id),
      typeId: String(r.type_id),
      expiresAt: String(r.expires_at),
      documentNo: r.document_no ? String(r.document_no) : null,
      note: r.note ? String(r.note) : null,
      type: byId.get(String(r.type_id)) ?? null,
    })),
    tabloYok: false,
  };
}

/**
 * SÜRESİ YAKLAŞAN / DOLMUŞ BELGELER — panonun tek okuması.
 *
 * ═══ EŞİK TÜR BAŞINA, SORGUDA DEĞİL KODDA ═══
 *
 * Her türün kendi `warn_days`'i olduğu için "şu tarihten önce" diye tek bir
 * SQL eşiği yazılamaz. En geniş eşikle çekip kodda tür bazında eliyoruz —
 * tablo kişi başına en fazla birkaç satır olduğu için maliyet yok.
 *
 * ═══ DOLMUŞ BELGE LİSTEDEN DÜŞMEZ ═══
 *
 * Alt sınır YOK. Ehliyet kuralının aynısı ve aynı gerekçeyle: dolmuş belge
 * düzeltilene kadar bir sorundur, eskidiği için sorun olmaktan çıkmaz.
 * (Araç muayenesinde tersi geçerli — orada bakımsız kayıt panoyu sonsuza dek
 * kırmızı tutmasın diye alt sınır var. Kişi belgesi o sınıfa girmiyor.)
 *
 * ⚠️ PASİF TÜR uyarı üretmez: kiracı bir belgeyi artık takip etmiyorsa
 * geçmiş kayıtları durur ama pano ondan kalem doğurmaz.
 */
export async function listExpiringDocuments(
  workerIds: string[] | null,
  now: Date = new Date()
): Promise<{ items: ExpiringDocument[]; tabloYok: boolean }> {
  const { types, tabloYok: tipYok } = await listDocumentTypes(true);
  if (tipYok) return { items: [], tabloYok: true };
  if (types.length === 0) return { items: [], tabloYok: false };

  const byId = new Map(types.map((t) => [t.id, t]));
  const enGenis = Math.max(...types.map((t) => t.warnDays));
  const tavan = new Date(now.getTime() + enGenis * 86_400_000)
    .toISOString()
    .slice(0, 10);

  let q = supabaseAdmin
    .from("worker_documents")
    .select(DOC_COLS)
    .lte("expires_at", tavan)
    .order("expires_at");
  // Kapsam ÇAĞIRANDAN gelir: pano şoför+filo kapsamını zaten çözmüş durumda
  // ve burada ikinci bir gerçek kurmak iki listeyi ayrıştırırdı.
  if (workerIds !== null) {
    if (workerIds.length === 0) return { items: [], tabloYok: false };
    q = q.in("worker_id", workerIds);
  }
  const { data, error } = await q;
  if (error) return { items: [], tabloYok: tabloYokMu(error) };

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return { items: [], tabloYok: false };

  const ids = [...new Set(rows.map((r) => String(r.worker_id)))];
  // ANAHTARLI okuma (.in("id")): kapsam çağıranda uygulandı, burada yalnız ad
  // sözlüğü kuruluyor.
  const { data: wData } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .in("id", ids);
  const adById = new Map(
    ((wData ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name])
  );

  const bugun = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const items: ExpiringDocument[] = [];
  for (const r of rows) {
    const type = byId.get(String(r.type_id));
    if (!type) continue; // pasif ya da silinmiş tür → kalem yok
    const expires = String(r.expires_at);
    const t = Date.parse(expires + "T00:00:00Z");
    if (!Number.isFinite(t)) continue; // bozuk tarih → uyarı UYDURMA
    const days = Math.round((t - bugun) / 86_400_000);
    // Tür kendi eşiğini uygular. Üst sınır var, ALT SINIR YOK.
    if (days > type.warnDays) continue;
    items.push({
      id: String(r.id),
      workerId: String(r.worker_id),
      workerName: adById.get(String(r.worker_id)) ?? "—",
      typeCode: type.code,
      typeLabel: type.label,
      warnDays: type.warnDays,
      expiresAt: expires,
      days,
    });
  }
  // Önce en acil: dolmuşlar (negatif) en üstte.
  items.sort((a, b) => a.days - b.days);
  return { items, tabloYok: false };
}

// ── YAZMA ────────────────────────────────────────────────────────────────

export type DocWriteResult =
  | { ok: true; id?: string }
  | { ok: false; sebep: "tablo_yok" | "cakisma" | "hata"; mesaj?: string };

/** PostgREST tekil kısıt ihlali. */
function cakismaMi(e: { code?: string | null }): boolean {
  return (e.code ?? "") === "23505";
}

export async function upsertDocumentType(
  t: {
    id?: string;
    code: string;
    label: string;
    warnDays: number;
    requiresNumber: boolean;
    active: boolean;
    sortOrder: number;
  },
  actorWorkerId: string | null
): Promise<DocWriteResult> {
  const satir = {
    // Kod küçük harfe indirilir: 'SRC' ve 'src' aynı belgedir ve ikisini
    // birden açmak sessiz bir çift kayıt kapısıdır (078 gerekçesi).
    code: t.code.trim().toLowerCase(),
    label: t.label.trim(),
    warn_days: t.warnDays,
    requires_number: t.requiresNumber,
    active: t.active,
    sort_order: t.sortOrder,
  };
  const q = t.id
    ? supabaseAdmin.from("document_types").update(satir).eq("id", t.id).select("id").maybeSingle()
    : supabaseAdmin
        .from("document_types")
        .insert({ ...satir, created_by: actorWorkerId })
        .select("id")
        .maybeSingle();
  const { data, error } = await q;
  if (error) {
    return {
      ok: false,
      sebep: tabloYokMu(error) ? "tablo_yok" : cakismaMi(error) ? "cakisma" : "hata",
      mesaj: error.message,
    };
  }
  return { ok: true, id: data ? String((data as { id: string }).id) : undefined };
}

export async function upsertWorkerDocument(
  d: {
    workerId: string;
    typeId: string;
    expiresAt: string;
    documentNo: string | null;
    note: string | null;
  },
  actorWorkerId: string | null
): Promise<DocWriteResult> {
  const { data, error } = await supabaseAdmin
    .from("worker_documents")
    .upsert(
      {
        worker_id: d.workerId,
        type_id: d.typeId,
        expires_at: d.expiresAt,
        document_no: d.documentNo,
        note: d.note,
        updated_at: new Date().toISOString(),
        updated_by: actorWorkerId,
      },
      // Yenileme = mevcut satırın tarihini ileri almak (078'deki tekil kısıt).
      { onConflict: "worker_id,type_id" }
    )
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error.message };
  }
  return { ok: true, id: data ? String((data as { id: string }).id) : undefined };
}

export async function deleteWorkerDocument(id: string): Promise<DocWriteResult> {
  const { error } = await supabaseAdmin.from("worker_documents").delete().eq("id", id);
  if (error) {
    return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error.message };
  }
  return { ok: true };
}
