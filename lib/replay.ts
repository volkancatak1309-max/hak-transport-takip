import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { SECURITY_LAYER_ENABLED } from "@/lib/tenant";
import type { ChangeField } from "@/lib/security-read";
import { TENANT_TZ } from "@/lib/tz";

/**
 * OTURUM KAYIT OYNATICI (045/046 üstü) — bir kişinin BİR GÜNÜ, tek çizgide.
 *
 * Güvenlik ekranındaki diğer sekmeler tabloları TÜRE göre ayırıyor: girişler
 * bir yerde, eylemler başka yerde. "O gün ne oldu" sorusu bu ayrımla
 * cevaplanamıyordu — üç sekme arasında saat karşılaştırmak gerekiyordu.
 * Burada tek eksen ZAMAN: giriş → sayfalar → indirmeler → değişiklikler → çıkış.
 *
 * ── BOŞLUKLAR OLAY SAYILIR ─────────────────────────────────────────────────
 * İki olay arasında uzun sessizlik, olayların kendisi kadar bilgi taşır
 * ("giriş yaptı, 42 dk hiçbir şey yapmadı, sonra üç rapor indirdi"). Bu yüzden
 * eşiği aşan aralıklar listeye AYRI SATIR olarak giriyor; kullanıcının satır
 * saatlerini kafadan çıkarması beklenmiyor.
 *
 * Katman kapalıyken hiçbir sorgu atılmaz.
 */

/** Bundan uzun sessizlik ayrı bir "hareketsiz" satırı doğurur. */
const BOSLUK_ESIK_MS = 10 * 60 * 1000;

export type ReplayKind =
  | "login"
  | "logout"
  | "page_view"
  | "export"
  | "change"
  | "gap";

export type ReplayEvent = {
  id: string;
  at: string;
  kind: ReplayKind;
  /** Ana satır metni. */
  baslik: string;
  /** İkincil bilgi: IP · şehir · cihaz, ya da hedef yol. */
  alt: string | null;
  /** Yalnız kind==="change": eylem izindeki kırmızı/yeşil biçimiyle aynı. */
  degisim: ChangeField[];
};

/** "YYYY-MM-DD" → o Viyana gününün UTC sınırları. */
function gunSiniri(ymd: string): { bas: string; bit: string } {
  // Viyana yaz saatinde UTC+2, kışın +1. Sınırı sabit kabul etmek yerine
  // günün başını yerel olarak kurup UTC'ye çeviriyoruz.
  const [y, m, d] = ymd.split("-").map(Number);
  // Yerel gün başını bulmak için önce UTC gece yarısını al, sonra o tarihteki
  // Viyana ofsetini ölçüp geri kaydır.
  const utcGeceYarisi = Date.UTC(y, m - 1, d, 0, 0, 0);
  const ofsetDk = viyanaOfsetDk(new Date(utcGeceYarisi));
  const bas = new Date(utcGeceYarisi - ofsetDk * 60_000);
  const bit = new Date(bas.getTime() + 24 * 60 * 60 * 1000);
  return { bas: bas.toISOString(), bit: bit.toISOString() };
}

/** Verilen anda Viyana'nın UTC'den farkı (dakika). */
function viyanaOfsetDk(d: Date): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: TENANT_TZ,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => Number(s.find((p) => p.type === t)?.value ?? 0);
  const yerel = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((yerel - d.getTime()) / 60_000);
}

function cihazAdi(ua: string | null): string {
  if (!ua) return "bilinmeyen cihaz";
  const os = /Windows/i.test(ua) ? "Windows"
    : /Android/i.test(ua) ? "Android"
    : /iPhone|iPad|iOS/i.test(ua) ? "iOS"
    : /Mac OS X/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux" : "?";
  const tr = /Edg\//i.test(ua) ? "Edge"
    : /Chrome\//i.test(ua) ? "Chrome"
    : /Firefox\//i.test(ua) ? "Firefox"
    : /Safari\//i.test(ua) ? "Safari" : "?";
  return `${os} · ${tr}`;
}

function goster(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v).slice(0, 60);
}

/**
 * Tek kalıp okuma: "bu tabloda, bu kişinin AKTÖR olduğu, bu gün içindeki
 * satırlar". Altı kaynağın altısı da bu şekle uyuyor; kolon adları farklı
 * olduğu için aktör ve zaman kolonu parametre.
 *
 * Tablo yoksa (migration çalışmamış) boş döner — eksik kurulum ekranı kırmaz.
 */
async function oku(
  tablo: string,
  kolonlar: string,
  aktorKolonu: string,
  zamanKolonu: string,
  workerId: string,
  bas: string,
  bit: string
): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from(tablo)
      .select(kolonlar)
      .eq(aktorKolonu, workerId)
      .gte(zamanKolonu, bas)
      .lt(zamanKolonu, bit)
      .order(zamanKolonu, { ascending: true })
      .limit(500);
    if (error || !data) return [];
    return data as unknown as Record<string, unknown>[];
  } catch {
    return [];
  }
}

/**
 * Bir kişinin bir gününü kurar.
 *
 * Kaynaklar: login_sessions (giriş/çıkış) + audit_log (sayfa, indirme,
 * değişiklik) + dört eski iz tablosu (vardiya/izin/yetki/kilit). Hepsi AKTÖR
 * ekseninde süzülüyor — yani "bu kişi ne yaptı", "bu kişiye ne yapıldı" değil.
 */
export async function buildDayReplay(
  workerId: string,
  ymd: string
): Promise<ReplayEvent[]> {
  if (!SECURITY_LAYER_ENABLED) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !workerId) return [];
  const { bas, bit } = gunSiniri(ymd);

  try {
    const [oturumlar, izler, vardiya, izin, yetki, kilit] = await Promise.all([
      oku("login_sessions",
        "id, started_at, ended_at, ended_reason, ip, city, country, user_agent, source",
        "worker_id", "started_at", workerId, bas, bit),
      oku("audit_log", "id, at, action, target, meta",
        "worker_id", "at", workerId, bas, bit),
      oku("shift_edit_log", "id, changed_at, field, old_value, new_value",
        "changed_by", "changed_at", workerId, bas, bit),
      oku("leave_edit_log", "id, changed_at, action, field, old_value, new_value",
        "changed_by", "changed_at", workerId, bas, bit),
      oku("worker_admin_log", "id, changed_at, granted",
        "changed_by", "changed_at", workerId, bas, bit),
      oku("login_unlock_log", "id, unlocked_at, cleared_rows",
        "unlocked_by", "unlocked_at", workerId, bas, bit),
    ]);

    const olaylar: ReplayEvent[] = [];

    for (const s of oturumlar) {
      const yer = [s.city, s.country].filter(Boolean).join(", ");
      olaylar.push({
        id: `in-${s.id as string}`,
        at: s.started_at as string,
        kind: "login",
        baslik: s.source === "mobile" ? "Giriş (mobil)" : "Giriş",
        alt: [s.ip ?? "—", yer || null, cihazAdi(s.user_agent as string | null)]
          .filter(Boolean).join(" · "),
        degisim: [],
      });
      if (s.ended_at) {
        olaylar.push({
          id: `out-${s.id as string}`,
          at: s.ended_at as string,
          kind: "logout",
          baslik: "Çıkış",
          alt: (s.ended_reason as string | null) ?? null,
          degisim: [],
        });
      }
    }

    for (const a of izler) {
      const act = a.action as string;
      const meta = (a.meta ?? null) as Record<string, unknown> | null;
      if (act === "page_view") {
        olaylar.push({ id: `a-${a.id as string}`, at: a.at as string, kind: "page_view",
          baslik: "Sayfa", alt: (a.target as string | null) ?? null, degisim: [] });
      } else if (act === "export_pdf" || act === "export_csv") {
        olaylar.push({ id: `a-${a.id as string}`, at: a.at as string, kind: "export",
          baslik: act === "export_pdf" ? "PDF indirdi" : "CSV indirdi",
          alt: (a.target as string | null) ?? null, degisim: [] });
      } else {
        const before = (meta?.before ?? null) as Record<string, unknown> | null;
        const after = (meta?.after ?? null) as Record<string, unknown> | null;
        let degisim: ChangeField[] = [];
        if (act === "update" && before && after) {
          degisim = Object.keys(after).map((k) => ({
            alan: k, eski: goster(before[k]), yeni: goster(after[k]),
          }));
        } else if (before || after) {
          const kaynak = act === "delete" ? before : after;
          degisim = Object.keys(kaynak ?? {})
            .filter((k) => k !== "_kirpildi")
            .map((k) => act === "delete"
              ? { alan: k, eski: goster((kaynak ?? {})[k]), yeni: "—" }
              : { alan: k, eski: "—", yeni: goster((kaynak ?? {})[k]) });
        }
        olaylar.push({ id: `a-${a.id as string}`, at: a.at as string, kind: "change",
          baslik: act, alt: (a.target as string | null) ?? null, degisim });
      }
    }

    for (const r of vardiya) {
      olaylar.push({ id: `se-${r.id as string}`, at: r.changed_at as string, kind: "change",
        baslik: "Vardiya düzenledi", alt: "time_entries",
        degisim: [{ alan: r.field as string, eski: goster(r.old_value), yeni: goster(r.new_value) }] });
    }
    for (const r of izin) {
      olaylar.push({ id: `le-${r.id as string}`, at: r.changed_at as string, kind: "change",
        baslik: `İzin: ${r.action as string}`, alt: "worker_leaves",
        degisim: [{ alan: r.field as string, eski: goster(r.old_value), yeni: goster(r.new_value) }] });
    }
    for (const r of yetki) {
      olaylar.push({ id: `wa-${r.id as string}`, at: r.changed_at as string, kind: "change",
        baslik: r.granted ? "Yönetici yetkisi verdi" : "Yönetici yetkisini aldı", alt: "workers",
        degisim: [{ alan: "is_admin", eski: String(!r.granted), yeni: String(!!r.granted) }] });
    }
    for (const r of kilit) {
      olaylar.push({ id: `lu-${r.id as string}`, at: r.unlocked_at as string, kind: "change",
        baslik: "Giriş kilidini açtı", alt: "login_attempts",
        degisim: [{ alan: "cleared_rows", eski: "—", yeni: goster(r.cleared_rows) }] });
    }

    olaylar.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    // ── BOŞLUKLARI ARAYA SER ────────────────────────────────────────────
    const sonuc: ReplayEvent[] = [];
    for (let i = 0; i < olaylar.length; i++) {
      if (i > 0) {
        const fark = new Date(olaylar[i].at).getTime() - new Date(olaylar[i - 1].at).getTime();
        if (fark >= BOSLUK_ESIK_MS) {
          const dk = Math.round(fark / 60000);
          sonuc.push({
            id: `gap-${i}`,
            at: olaylar[i - 1].at,
            kind: "gap",
            baslik: dk >= 60
              ? `${Math.floor(dk / 60)} sa ${dk % 60} dk hareketsiz`
              : `${dk} dk hareketsiz`,
            alt: null,
            degisim: [],
          });
        }
      }
      sonuc.push(olaylar[i]);
    }
    return sonuc;
  } catch {
    return [];
  }
}
