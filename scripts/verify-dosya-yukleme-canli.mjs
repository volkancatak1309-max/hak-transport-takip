#!/usr/bin/env node
/**
 * DOSYA YÜKLEME — CANLIDA KANIT (yalnız galzura-demo).
 *
 * ═══ NE İSPATLAR ═══
 *
 * Dört söz, her biri **Storage'daki dosya sayılarak**:
 *   1. Yükleme çalışıyor (gerçek PNG → gerçek kova, kayıt onu gösteriyor).
 *   2. Reddedilen istek DOSYA BIRAKMIYOR (boyut / tip / eksik kanıt).
 *   3. 🔑 YAZMA DÜŞERSE YÜKLENEN DOSYA GERİ ALINIYOR (yetim yok).
 *   4. 🔑 KAYIT SİLİNİNCE DOSYA DA GİDİYOR (vardiya sil → shift_photos).
 *
 * ⚠️ YALNIZ galzura-demo. Proje referansı doğrulanır; HAK61/Sendigo'da DURUR.
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/ts-server.mjs scripts/verify-dosya-yukleme-canli.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { upsertDvirMadde, deleteDvirMadde } from "@/lib/dvir-db";
import {
  dosyaYukle,
  dosyaSil,
  yukleVeYaz,
  HIZ_TAVAN,
  YUKLEME_TAVAN_BAYT,
} from "@/lib/upload-core";
import { SHIFT_PHOTO_KOVA } from "@/lib/driver-panel-kova";
import { DVIR_KOVA } from "@/lib/dvir-submit";

if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ DURDURULDU — şim devrede; bu betik GERÇEK veritabanı ister.");
  process.exit(1);
}
const DEMO_REF = "omgnkvoulndbglmxlvzc";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes(DEMO_REF)) {
  console.error(`✗ DURDURULDU — hedef galzura-demo DEĞİL (${url}).`);
  process.exit(1);
}

const TEL = "+90123456789";
let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n── ${s} ──`);
const bilgi = (s) => console.log(`     ${s}`);

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const png = (ad = "test.png") =>
  new File([Buffer.from(PNG_B64, "base64")], ad, { type: "image/png" });

/** Bir kişinin bu ayki klasöründeki dosyalar. */
async function depoSay(kova, workerId) {
  const d = new Date();
  const yol = `${workerId}/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const { data, error } = await supabaseAdmin.storage.from(kova).list(yol, { limit: 1000 });
  if (error) return { adet: 0, hata: error.message, dosyalar: [] };
  return { adet: (data ?? []).length, dosyalar: (data ?? []).map((x) => `${yol}/${x.name}`) };
}
async function varMi(kova, tamYol) {
  if (!tamYol) return false;
  const i = tamYol.lastIndexOf("/");
  const { data } = await supabaseAdmin.storage
    .from(kova)
    .list(tamYol.slice(0, i), { limit: 1000, search: tamYol.slice(i + 1) });
  return (data ?? []).some((x) => `${tamYol.slice(0, i)}/${x.name}` === tamYol);
}

const istek = (yol, { token, method = "POST", form } = {}) => {
  const h = { "x-forwarded-for": "198.51.100.77" };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(`https://demo.galzura.com${yol}`, { method, headers: h, body: form });
};
const cevap = async (r) => ({ kod: r.status, govde: await r.json() });

console.log(`\n╔══ DOSYA YÜKLEME · CANLIDA KANIT (galzura-demo) ════════════════════`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ tavan  ${YUKLEME_TAVAN_BAYT} bayt · hız ${HIZ_TAVAN}/dk`);

let maddeId = null;
let formId = null;
let vardiyaId = null;
let w = null;
let foto0 = { adet: 0 };

try {
  baslik("0. ÖNCE");
  ({ data: w } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_admin, counts_as_driver, token_version")
    .eq("phone", TEL)
    .maybeSingle());
  if (!w) {
    console.error(`✗ ${TEL} bulunamadı.`);
    process.exit(1);
  }
  const { data: arac } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate")
    .eq("assigned_worker_id", w.id)
    .limit(1)
    .maybeSingle();
  if (!arac) {
    console.error("✗ atanmış araç yok.");
    process.exit(1);
  }

  const dvir0 = await depoSay(DVIR_KOVA, w.id);
  foto0 = await depoSay(SHIFT_PHOTO_KOVA, w.id);
  bilgi(`worker ${w.id} · araç ${arac.plate}`);
  bilgi(`Storage ÖNCE: ${DVIR_KOVA}=${dvir0.adet} · ${SHIFT_PHOTO_KOVA}=${foto0.adet}`);

  const { error: hizErr } = await supabaseAdmin.from("upload_rate").select("worker_id").limit(1);
  bilgi(`migration 098 (upload_rate): ${hizErr ? "YOK → hız sınırı fail-open" : "VAR"}`);

  const token = (await issueTokens(w.id, w.is_admin, w.token_version ?? 0)).accessToken;
  const { POST: DVIR_POST } = await import("@/app/api/mobile/dvir/route.ts");

  const m = await upsertDvirMadde(
    { kod: `zz_qa_${Date.now()}`, etiket: "ZZ QA foto", tur: "ikisi", sira: 999, aktif: true },
    w.id
  );
  if (!m.ok) {
    console.error("✗ test maddesi açılamadı:", m.sebep, m.mesaj);
    process.exit(1);
  }
  maddeId = m.veri.id;
  bilgi(`test maddesi ${maddeId}`);

  // ══════════════════════════════════════════════════════════════════════
  baslik("1. YÜKLEME — DVIR formu + kusur fotoğrafı");
  {
    const fd = new FormData();
    fd.set("vehicleId", arac.id);
    fd.set("tur", "once");
    fd.set("yanitlar", JSON.stringify([{ maddeId, durum: "kusurlu", notlar: "QA kusur" }]));
    fd.set(`foto_${maddeId}`, png());

    const r = await cevap(await DVIR_POST(istek("/api/mobile/dvir", { token, form: fd })));
    const depo = await depoSay(DVIR_KOVA, w.id);
    iddia(
      "form + foto → 200",
      r.kod === 200 && r.govde.ok === true,
      `${r.kod} ${JSON.stringify(r.govde).slice(0, 150)}`
    );
    formId = r.govde.form?.id ?? null;
    iddia(`Storage'da DOSYA VAR (${dvir0.adet} → ${depo.adet})`, depo.adet === dvir0.adet + 1, `${depo.adet}`);

    const { data: y } = await supabaseAdmin
      .from("dvir_yanitlari")
      .select("foto_yolu")
      .eq("form_id", formId ?? "")
      .maybeSingle();
    iddia("kayıt dosyayı gösteriyor", !!y?.foto_yolu, `${y?.foto_yolu}`);
    iddia("gösterilen dosya GERÇEKTEN orada", await varMi(DVIR_KOVA, y?.foto_yolu), "");
    iddia("kusur iş emri açtı", (r.govde.form?.isEmri ?? 0) >= 1, `isEmri=${r.govde.form?.isEmri}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  baslik("2. RED — boyut / tip / eksik kanıt (dosya bırakmamalı)");
  {
    const oncekiAdet = (await depoSay(DVIR_KOVA, w.id)).adet;
    const kur = (dosya) => {
      const fd = new FormData();
      fd.set("vehicleId", arac.id);
      fd.set("tur", "sonra");
      fd.set("yanitlar", JSON.stringify([{ maddeId, durum: "kusurlu", notlar: "QA" }]));
      if (dosya) fd.set(`foto_${maddeId}`, dosya);
      return fd;
    };

    const rb = await cevap(
      await DVIR_POST(
        istek("/api/mobile/dvir", {
          token,
          form: kur(
            new File([Buffer.alloc(YUKLEME_TAVAN_BAYT + 1024)], "b.png", { type: "image/png" })
          ),
        })
      )
    );
    iddia("5 MB üstü → 400 cok_buyuk", rb.kod === 400 && rb.govde.error === "cok_buyuk", `${rb.kod} ${rb.govde.error}`);

    const rt = await cevap(
      await DVIR_POST(
        istek("/api/mobile/dvir", {
          token,
          form: kur(new File([Buffer.from("merhaba")], "a.txt", { type: "text/plain" })),
        })
      )
    );
    iddia("text/plain → 400 tip_yasak", rt.kod === 400 && rt.govde.error === "tip_yasak", `${rt.kod} ${rt.govde.error} (${rt.govde.ayrinti})`);

    const rh = await cevap(
      await DVIR_POST(
        istek("/api/mobile/dvir", {
          token,
          form: kur(new File([Buffer.from("x")], "a.heic", { type: "image/heic" })),
        })
      )
    );
    iddia("image/heic → 400 tip_yasak (yeni uçlarda kapalı)", rh.kod === 400 && rh.govde.error === "tip_yasak", `${rh.kod} ${rh.govde.error}`);

    const rk = await cevap(await DVIR_POST(istek("/api/mobile/dvir", { token, form: kur(null) })));
    iddia("kusurlu ama fotoğrafsız → 400 kanit_yok", rk.kod === 400 && rk.govde.error === "kanit_yok", `${rk.kod} ${rk.govde.error}`);

    const depo = await depoSay(DVIR_KOVA, w.id);
    iddia(`🔴 REDDEDİLEN 4 İSTEK DOSYA BIRAKMADI (${oncekiAdet} → ${depo.adet})`, depo.adet === oncekiAdet, `${depo.adet}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  baslik("3. 🔑 YETİM YOK — yazma düşerse yüklenen dosya geri alınır");
  {
    const oncekiAdet = (await depoSay(DVIR_KOVA, w.id)).adet;
    // `yaz` BİLEREK null döner: yükleme başarılı, kayıt yazılamadı.
    const c = await yukleVeYaz(DVIR_KOVA, w.id, png("yetim.png"), async () => null);
    const depo = await depoSay(DVIR_KOVA, w.id);
    iddia("yazma düştü → ok:false", c.ok === false, `${c.ok} ${c.hata}`);
    iddia("dosyaTemizlendi=true", c.dosyaTemizlendi === true, `${c.dosyaTemizlendi}`);
    iddia(`🔴 DOSYA SAYISI DEĞİŞMEDİ (${oncekiAdet} → ${depo.adet})`, depo.adet === oncekiAdet, `${depo.adet}`);
  }

  // ══════════════════════════════════════════════════════════════════════
  baslik("4. 🔑 KAYIT SİLİNİNCE DOSYA DA GİDİYOR (vardiya → shift_photos)");
  {
    const { data: v } = await supabaseAdmin
      .from("time_entries")
      .insert({
        worker_id: w.id,
        vehicle_id: arac.id,
        plate: arac.plate,
        started_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
        ended_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
        start_km: 1,
        end_km: 2,
        break_minutes: 0,
        auto_started: false,
        confirmation_status: "confirmed",
      })
      .select("id")
      .maybeSingle();
    vardiyaId = v?.id ?? null;
    iddia("test vardiyası açıldı", !!vardiyaId, `${vardiyaId}`);

    const yollar = [];
    for (const ad of ["v1.png", "v2.png"]) {
      const up = await dosyaYukle(SHIFT_PHOTO_KOVA, w.id, png(ad), { hizSiniri: false });
      if (up.ok) {
        yollar.push(up.yol);
        await supabaseAdmin.from("shift_photos").insert({
          time_entry_id: vardiyaId,
          worker_id: w.id,
          storage_path: up.yol,
        });
      }
    }
    const oncekiAdet = (await depoSay(SHIFT_PHOTO_KOVA, w.id)).adet;
    iddia(
      `2 fotoğraf yüklendi (${foto0.adet} → ${oncekiAdet})`,
      yollar.length === 2 && oncekiAdet === foto0.adet + 2,
      `${oncekiAdet}`
    );
    iddia(
      "ikisi de Storage'da",
      (await varMi(SHIFT_PHOTO_KOVA, yollar[0])) && (await varMi(SHIFT_PHOTO_KOVA, yollar[1])),
      ""
    );

    /**
     * SİLME — `deleteEntryAction`ın adım sırasının AYNISI ve aynı çekirdek
     * (`dosyaSil`). Action'ın kendisi çağrılamıyor: ilk satırı `requireAdmin()`
     * ve o kapı çerezsiz istekte `redirect()` fırlatıyor.
     */
    const { data: oncekiSatirlar } = await supabaseAdmin
      .from("shift_photos")
      .select("storage_path")
      .eq("time_entry_id", vardiyaId);
    const silinecek = (oncekiSatirlar ?? []).map((f) => f.storage_path).filter(Boolean);
    await supabaseAdmin.from("time_entries").delete().eq("id", vardiyaId);
    const sil = await dosyaSil(SHIFT_PHOTO_KOVA, silinecek);
    vardiyaId = null;

    const { data: kalanSatir } = await supabaseAdmin
      .from("shift_photos")
      .select("id")
      .in("storage_path", silinecek);
    const depo = await depoSay(SHIFT_PHOTO_KOVA, w.id);

    iddia("vardiya silindi → shift_photos satırları CASCADE ile gitti", (kalanSatir ?? []).length === 0, `${(kalanSatir ?? []).length} satır`);
    iddia(`🔴 DOSYALAR DA GİTTİ (${oncekiAdet} → ${depo.adet})`, depo.adet === foto0.adet, `${depo.adet}, silinen=${sil.silinen}`);
    iddia("dosya 1 Storage'da YOK", !(await varMi(SHIFT_PHOTO_KOVA, yollar[0])), yollar[0]);
    iddia("dosya 2 Storage'da YOK", !(await varMi(SHIFT_PHOTO_KOVA, yollar[1])), yollar[1]);
  }
} finally {
  baslik("5. TEMİZLİK");
  if (vardiyaId) await supabaseAdmin.from("time_entries").delete().eq("id", vardiyaId);
  if (formId) {
    const { data: y } = await supabaseAdmin
      .from("dvir_yanitlari")
      .select("foto_yolu")
      .eq("form_id", formId);
    const yollar = (y ?? []).map((x) => x.foto_yolu).filter(Boolean);
    await supabaseAdmin
      .from("vehicle_fault_reports")
      .delete()
      .eq("dvir_form_id", formId)
      .then(
        () => {},
        () => {}
      );
    await supabaseAdmin.from("dvir_yanitlari").delete().eq("form_id", formId);
    await supabaseAdmin.from("dvir_formlari").delete().eq("id", formId);
    if (yollar.length) {
      const s = await dosyaSil(DVIR_KOVA, yollar);
      iddia("test formunun dosyaları silindi", s.ok, `${s.silinen} dosya`);
    }
    const { data: kalan } = await supabaseAdmin
      .from("dvir_formlari")
      .select("id")
      .eq("id", formId)
      .maybeSingle();
    iddia("test formu silindi", !kalan, formId);
  }
  if (maddeId) {
    const d = await deleteDvirMadde(maddeId);
    iddia("test maddesi silindi", d.ok, d.ok ? maddeId : d.sebep);
  }
  if (w) {
    const d1 = await depoSay(DVIR_KOVA, w.id);
    const d2 = await depoSay(SHIFT_PHOTO_KOVA, w.id);
    iddia(
      `🔴 STORAGE TEMİZ (${DVIR_KOVA}=${d1.adet} · ${SHIFT_PHOTO_KOVA}=${d2.adet})`,
      d1.adet === 0 && d2.adet === foto0.adet,
      [...d1.dosyalar, ...d2.dosyalar].join(", ") || "boş"
    );
  }
  console.log(`\n╚══ ${dusen === 0 ? "TÜM İDDİALAR GEÇTİ" : `${dusen} İDDİA DÜŞTÜ`} ${"═".repeat(26)}`);
}
process.exit(dusen === 0 ? 0 : 1);
