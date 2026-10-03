import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { TENANT } from "@/lib/brand";
import { ASISTAN_SESLI_KAYIT } from "@/lib/tenant";
import { tabloYokMu } from "@/lib/fault-reports";
import { startOfDayViennaFromYmd, viennaDayKey } from "@/lib/format";
import { SESLI_KIRACI_AYLIK_BUTCE_USD, YAZI_MODEL, lunaMaliyetUsd } from "@/lib/asistan-sesli-sabitler";
import {
  canliMi,
  etkinSaniye,
  jetonCoz,
  jetonDurumu,
  jetonImzala,
  kayitMaliyeti,
  maliyetTabani,
  nabizSaniyesi,
  sinirKarari,
  type KullanimSatiri,
  type OturumJetonu,
} from "@/lib/asistan-sesli-sinir";

/**
 * SESLİ ASİSTAN — KULLANIM KAYDI, SUNUCU SINIRLARI, BİLDİR (Faz 2a hazırlığı, 03.10.2026).
 *
 * Migration 110 (`db/migrations/_beklemede/110_sesli_asistan_kayit.sql`) — ÇALIŞTIRILMADI.
 * Bütün yazma/okuma `ASISTAN_SESLI_KAYIT=1` arkasında; kapalıyken bu modül HİÇBİR tabloya
 * dokunmaz ve prototip bugünkü gibi çalışır. Açık ama tablo yoksa oturum AÇILMAZ
 * (503 `kayit_tablo_yok`) — sessizce sınırsız çalışmak yerine.
 *
 * Saf hesaplar (jeton, saniye, sınır kararı, maliyet) `lib/asistan-sesli-sinir.ts`te.
 */

export const KAYIT_ACIK = ASISTAN_SESLI_KAYIT;

type Hata = { ok: false; durum: number; kod: string };

const SUTUNLAR = "id, worker_id, motor, model, basladi_at, son_nabiz_at, bitti_at, saniye, tahmini_maliyet_usd";

/**
 * Jeton sırrı oturum çerezinin sırrından TÜRETİLİR (ayrı alan adı): ek env gerekmez, çerez
 * mührü ile jeton imzası birbirine dönüştürülemez.
 */
function jetonSirri(): string | null {
  const p = process.env.SESSION_PASSWORD;
  if (!p || p.length < 32) return null;
  return createHash("sha256").update(`galzura-sesli-oturum:${p}`).digest("hex");
}

function butceUsd(): number {
  const v = Number(process.env.ASISTAN_SESLI_BUTCE_USD?.trim());
  return Number.isFinite(v) && v > 0 ? v : SESLI_KIRACI_AYLIK_BUTCE_USD;
}

/** Kiracının saat diliminde bugünün ve bu ayın başlangıcı. */
function sinirlar(simdi: Date): { gunBasi: Date; ayBasi: Date } {
  const bugun = viennaDayKey(simdi);
  const gunBasi = startOfDayViennaFromYmd(bugun) ?? new Date(simdi.getTime() - 86_400_000);
  const ayBasi = startOfDayViennaFromYmd(`${bugun.slice(0, 7)}-01`) ?? gunBasi;
  return { gunBasi, ayBasi };
}

type Ozet = { gunSn: number; aySn: number; kiraciAyUsd: number; acikOturumVar: boolean };

/** Bu ayın kayıtlarından kişi/gün, kişi/ay saniyesi, kiracı/ay maliyeti, açık oturum. */
async function kullanimOzeti(workerId: string, simdi: Date): Promise<{ ok: true; ozet: Ozet } | Hata> {
  const { gunBasi, ayBasi } = sinirlar(simdi);
  const { data, error } = await supabaseAdmin
    .from("asistan_kullanim")
    .select(SUTUNLAR)
    .gte("basladi_at", ayBasi.toISOString())
    .limit(5000);
  if (error) return { ok: false, durum: 503, kod: tabloYokMu(error) ? "kayit_tablo_yok" : "db_error" };
  const satirlar = (data ?? []) as (KullanimSatiri & { worker_id: string | null; tahmini_maliyet_usd: unknown })[];
  const an = simdi.getTime();
  let gunSn = 0;
  let aySn = 0;
  let kiraciAyUsd = 0;
  let acikOturumVar = false;
  for (const r of satirlar) {
    kiraciAyUsd += Number(r.tahmini_maliyet_usd) || 0;
    if (r.worker_id !== workerId) continue;
    const sn = etkinSaniye(r, an);
    aySn += sn;
    if (Date.parse(r.basladi_at) >= gunBasi.getTime()) gunSn += sn;
    if (canliMi(r, an)) acikOturumVar = true;
  }
  return { ok: true, ozet: { gunSn, aySn, kiraciAyUsd, acikOturumVar } };
}

export type OturumAcSonucu =
  | { ok: true; kayitsiz: true }
  | { ok: true; kayitsiz: false; kullanimId: string; oturumJetonu: string; kalanSn: number }
  | Hata;

/**
 * Ses oturumu açılmadan ÖNCE: sınırlar → kayıt satırı → imzalı jeton. Sınır doluysa
 * 429 (`gun_siniri` / `ay_siniri` / `butce`), açık oturum varsa 409 (`oturum_acik`).
 */
export async function oturumAc(p: {
  workerId: string;
  motor: "realtime" | "live";
  model: string;
  ses: string;
}): Promise<OturumAcSonucu> {
  if (!KAYIT_ACIK) return { ok: true, kayitsiz: true };
  const sir = jetonSirri();
  if (!sir) return { ok: false, durum: 503, kod: "jeton_sirri_yok" };

  const simdi = new Date();
  const oz = await kullanimOzeti(p.workerId, simdi);
  if (!oz.ok) return oz;
  const karar = sinirKarari({ ...oz.ozet, butceUsd: butceUsd() });
  if (!karar.izin) return { ok: false, durum: karar.engel === "oturum_acik" ? 409 : 429, kod: karar.engel };

  const basladi = simdi.toISOString();
  const { data, error } = await supabaseAdmin
    .from("asistan_kullanim")
    .insert({ kiraci: TENANT, worker_id: p.workerId, motor: p.motor, model: p.model, ses: p.ses, basladi_at: basladi })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, durum: 503, kod: error && tabloYokMu(error) ? "kayit_tablo_yok" : "db_error" };
  const kullanimId = String((data as { id: string }).id);
  const jeton: OturumJetonu = { k: kullanimId, w: p.workerId, b: Date.parse(basladi), s: karar.kalanSn };
  return { ok: true, kayitsiz: false, kullanimId, oturumJetonu: jetonImzala(jeton, sir), kalanSn: karar.kalanSn };
}

/** OpenAI oturumu açılamadıysa kayıt 0 sn ile kapanır (sınırdan düşmesin). */
export async function oturumHataylaKapat(kullanimId: string): Promise<void> {
  await supabaseAdmin
    .from("asistan_kullanim")
    .update({ bitti_at: new Date().toISOString(), saniye: 0, bitis_sebebi: "hata" })
    .eq("id", kullanimId)
    .is("bitti_at", null);
}

/** Araç ucu ve kalp atışı: jeton imzalı mı, bu kullanıcının mı, süresi dolmadı mı. */
export function jetonDogrula(ham: unknown, workerId: string): { ok: true; jeton: OturumJetonu } | Hata {
  const sir = jetonSirri();
  if (!sir) return { ok: false, durum: 503, kod: "jeton_sirri_yok" };
  const j = jetonCoz(ham, sir);
  if (!j) return { ok: false, durum: 401, kod: "oturum_gecersiz" };
  const d = jetonDurumu(j, workerId, Date.now());
  if (d === "baska_kullanici") return { ok: false, durum: 401, kod: "oturum_gecersiz" };
  if (d === "suresi_doldu") return { ok: false, durum: 401, kod: "oturum_suresi_doldu" };
  return { ok: true, jeton: j };
}

/**
 * Yalnız imza + kullanıcı (süre DENETLENMEZ): kalp atışı ve Bildir için. Süresi dolmuş bir
 * oturumun son atışı kaydı kapatabilmeli; saniye zaten jetondaki sınırla kırpılıyor.
 */
export function jetonImzali(ham: unknown, workerId: string): { ok: true; jeton: OturumJetonu } | Hata {
  const sir = jetonSirri();
  if (!sir) return { ok: false, durum: 503, kod: "jeton_sirri_yok" };
  const j = jetonCoz(ham, sir);
  if (!j || j.w !== workerId) return { ok: false, durum: 401, kod: "oturum_gecersiz" };
  return { ok: true, jeton: j };
}

const BITIS_SEBEPLERI = new Set(["kullanici", "sure_doldu", "arka_plan", "baglanti_koptu", "hata"]);
const tamSayi = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(Math.floor(v), 0), 10_000_000) : 0;

/**
 * KALP ATIŞI. Saniyeyi SUNUCU yazar (geçen süre, oturum sınırıyla kırpılı); maliyet =
 * sunucu tabanı ile istemcinin bildirdiğinin büyüğü. Sınır dolduysa ya da istemci
 * bitirdiyse kayıt kapanır ve `bitir: true` döner. Kapanmış kayıt yeniden açılmaz.
 */
export async function nabiz(p: {
  jeton: OturumJetonu;
  bitti: boolean;
  sebep: unknown;
  istemciMaliyetUsd: unknown;
  arkaToken: unknown;
}): Promise<{ ok: true; kalanSn: number; bitir: boolean } | Hata> {
  const { data, error } = await supabaseAdmin
    .from("asistan_kullanim")
    .select("id, worker_id, motor, model, saniye, bitti_at, arka_girdi_token, arka_cikti_token")
    .eq("id", p.jeton.k)
    .maybeSingle();
  if (error) return { ok: false, durum: 503, kod: tabloYokMu(error) ? "kayit_tablo_yok" : "db_error" };
  const r = data as {
    worker_id: string | null;
    motor: string;
    model: string;
    saniye: number;
    bitti_at: string | null;
    arka_girdi_token: number;
    arka_cikti_token: number;
  } | null;
  if (!r || r.worker_id !== p.jeton.w) return { ok: false, durum: 404, kod: "kayit_yok" };
  if (r.bitti_at) return { ok: true, kalanSn: 0, bitir: true };

  const an = Date.now();
  const saniye = nabizSaniyesi(p.jeton, an, Number(r.saniye) || 0);
  const tok = (p.arkaToken ?? {}) as Record<string, unknown>;
  const girdi = Math.max(Number(r.arka_girdi_token) || 0, tamSayi(tok.girdi));
  const cikti = Math.max(Number(r.arka_cikti_token) || 0, tamSayi(tok.cikti));
  const taban = maliyetTabani(r.motor, r.model, saniye) + (r.motor === "live" ? lunaMaliyetUsd(girdi, cikti) : 0);
  const doldu = saniye >= p.jeton.s;
  const kapat = p.bitti || doldu;
  const sebep = typeof p.sebep === "string" && BITIS_SEBEPLERI.has(p.sebep) ? p.sebep : doldu ? "sure_doldu" : "kullanici";

  const { error: uHata } = await supabaseAdmin
    .from("asistan_kullanim")
    .update({
      saniye,
      son_nabiz_at: new Date(an).toISOString(),
      tahmini_maliyet_usd: kayitMaliyeti(taban, p.istemciMaliyetUsd),
      arka_girdi_token: girdi,
      arka_cikti_token: cikti,
      ...(kapat ? { bitti_at: new Date(an).toISOString(), bitis_sebebi: doldu && !p.bitti ? "sure_doldu" : sebep } : {}),
    })
    .eq("id", p.jeton.k)
    .is("bitti_at", null);
  if (uHata) return { ok: false, durum: 503, kod: "db_error" };
  return { ok: true, kalanSn: Math.max(0, p.jeton.s - saniye), bitir: kapat };
}

/** Yazılı yol: çağrıdan ÖNCE kiracı/ay bütçesi. Kapalıyken her zaman izin. */
export async function yaziOnKontrol(workerId: string): Promise<{ ok: true } | Hata> {
  if (!KAYIT_ACIK) return { ok: true };
  const oz = await kullanimOzeti(workerId, new Date());
  if (!oz.ok) return oz;
  if (oz.ozet.kiraciAyUsd >= butceUsd()) return { ok: false, durum: 429, kod: "butce" };
  return { ok: true };
}

/** Yazılı yol: çağrıdan SONRA token kullanımı kayda (saniye 0, maliyet gpt-6-luna fiyatıyla). */
export async function yaziKaydet(p: { workerId: string; girdi: number; cikti: number }): Promise<void> {
  if (!KAYIT_ACIK) return;
  const an = new Date().toISOString();
  await supabaseAdmin.from("asistan_kullanim").insert({
    kiraci: TENANT,
    worker_id: p.workerId,
    motor: "yazi",
    model: YAZI_MODEL,
    basladi_at: an,
    bitti_at: an,
    saniye: 0,
    bitis_sebebi: "kullanici",
    tahmini_maliyet_usd: kayitMaliyeti(lunaMaliyetUsd(tamSayi(p.girdi), tamSayi(p.cikti)), 0),
    arka_girdi_token: tamSayi(p.girdi),
    arka_cikti_token: tamSayi(p.cikti),
  });
}

export type BildirimGirdisi = {
  workerId: string;
  kullanimId: string | null;
  motor: "realtime" | "live" | "yazi";
  model: string | null;
  dil: "tr" | "de" | "en" | null;
  soru: string;
  cevap: string | null;
  araclar: { ad: string; sureMs: number | null; onbellek: string | null }[];
};

/** "Bildir" → `asistan_bildirimleri` (90 gün). */
export async function bildirimYaz(g: BildirimGirdisi): Promise<{ ok: true; id: string } | Hata> {
  const { data, error } = await supabaseAdmin
    .from("asistan_bildirimleri")
    .insert({
      kiraci: TENANT,
      worker_id: g.workerId,
      kullanim_id: g.kullanimId,
      motor: g.motor,
      model: g.model,
      dil: g.dil,
      soru: g.soru,
      cevap: g.cevap,
      arac_cagrilari: g.araclar,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, durum: 503, kod: error && tabloYokMu(error) ? "kayit_tablo_yok" : "db_error" };
  return { ok: true, id: String((data as { id: string }).id) };
}
