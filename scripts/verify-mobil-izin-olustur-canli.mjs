#!/usr/bin/env node
/**
 * POST /api/mobile/leaves — CANLIDA KANIT (yalnız galzura-demo).
 *
 * ═══ NE YAPAR ═══
 *
 * Ucun GERÇEK route handler'ını GERÇEK veritabanına karşı koşturur. Kuru koşum
 * yok: gerçek satırlar yazılır, sayılır, sonra geri alınır.
 *
 * ⚠️ YALNIZ galzura-demo. Betik ilk iş olarak proje referansını doğrular ve
 * HAK61 / Sendigo'ya bağlıysa DURUR (Volkan kuralı: ikisi CANLI MÜŞTERİ).
 *
 * ── GERİ ALMA SÖZÜ ────────────────────────────────────────────────────────
 *   • Yazılan `worker_leaves` satırları `finally` bloğunda SİLİNİR ve silmenin
 *     tuttuğu ölçülür (önce/sonra sayımı eşitlenmeli).
 *
 * ── GERİ ALINAMAYAN (bilerek) ─────────────────────────────────────────────
 *   • `leave_edit_log` satırları — DENETİM İZİ. Silmek izin kendisini anlamsız
 *     kılardı; testin bıraktığı satırlar aşağıda sayılıyor.
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/ts-server.mjs scripts/verify-mobil-izin-olustur-canli.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { LEAVES_ENABLED } from "@/lib/features";

// ── EMNİYET 1: ŞİM DEĞİL, GERÇEK İSTEMCİ ───────────────────────────────────
if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ DURDURULDU — şim devrede. Bu betik GERÇEK veritabanı ister.");
  process.exit(1);
}

// ── EMNİYET 2: YALNIZ galzura-demo ─────────────────────────────────────────
const DEMO_REF = "omgnkvoulndbglmxlvzc";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes(DEMO_REF)) {
  console.error(
    `✗ DURDURULDU — hedef galzura-demo DEĞİL.\n` +
      `  Beklenen ref: ${DEMO_REF}\n  Gelen URL:    ${url}\n` +
      `  HAK61 ve Sendigo CANLI MÜŞTERİ; bu betik oralarda ASLA koşmaz.`
  );
  process.exit(1);
}

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n── ${s} ──`);
const bilgi = (s) => console.log(`     ${s}`);

const say = async (tablo) => {
  const { count, error } = await supabaseAdmin
    .from(tablo)
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`${tablo} sayılamadı: ${error.message}`);
  return count ?? 0;
};

const istek = (yol, { token, method = "POST", govde } = {}) => {
  const h = { "content-type": "application/json", "x-forwarded-for": "198.51.100.42" };
  if (token) h.authorization = `Bearer ${token}`;
  return new Request(`https://demo.galzura.com${yol}`, {
    method,
    headers: h,
    body: govde === undefined ? undefined : JSON.stringify(govde),
  });
};
const cevap = async (res) => ({ kod: res.status, govde: await res.json() });

// Test verisi: geleceğe düşen tarihler — mevcut 8 iznin tamamı Ağustos 2026'da,
// çakışma KURGUSAL olmalı, tesadüfi değil.
const GELECEK_BAS = "2026-11-10";
const GELECEK_BIT = "2026-11-12";

const yazilanIzinler = [];

console.log(`\n╔══ POST /api/mobile/leaves · CANLIDA KANIT (galzura-demo) ═══════════`);
console.log(`║ an       ${new Date().toISOString()}`);
console.log(`║ hedef    ${url}`);
console.log(`║ bayrak   LEAVES_ENABLED=${LEAVES_ENABLED}`);
console.log(`║ ⚠️ bayrak bu KOŞUMUN env'inden; canlı Vercel env'i okunamıyor.`);

try {
  if (!LEAVES_ENABLED) {
    console.error("\n✗ DURDURULDU — LEAVES_ENABLED=false; uç 404 döner, kural sınanamaz.");
    process.exit(1);
  }

  const { POST } = await import("@/app/api/mobile/leaves/route.ts");

  // ── KADRO SEÇİMİ ────────────────────────────────────────────────────────
  baslik("0 · KADRO + JETON");
  const { data: kadro } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_admin, is_active, token_version, managed_fleet, terminated_at")
    .eq("is_active", true);

  const yonetici = (kadro ?? []).find((w) => w.is_admin === true);
  const soforler = (kadro ?? []).filter(
    (w) => !w.is_admin && !w.managed_fleet && !w.terminated_at
  );
  if (!yonetici || soforler.length < 2) {
    throw new Error("Yeterli kadro yok (1 yönetici + 2 şoför gerekli).");
  }

  // Vardiyası OLAN şoför — needConfirm yolunu tetikleyecek.
  const { data: sonVardiya } = await supabaseAdmin
    .from("time_entries")
    .select("worker_id, started_at")
    .order("started_at", { ascending: false })
    .limit(50);
  const vardiyaliId = (sonVardiya ?? []).map((t) => t.worker_id).find((id) =>
    soforler.some((s) => s.id === id)
  );
  if (!vardiyaliId) throw new Error("Vardiyası olan şoför bulunamadı.");
  const vardiyali = soforler.find((s) => s.id === vardiyaliId);
  const vardiyaGunu = (sonVardiya ?? [])
    .find((t) => t.worker_id === vardiyaliId)
    .started_at.slice(0, 10);

  // Vardiyası OLMAYAN (gelecekte) hedef — temiz oluşturma + overlap için.
  const temiz = soforler.find((s) => s.id !== vardiyaliId);

  const jetonAdmin = (
    await issueTokens(yonetici.id, true, yonetici.token_version ?? 0)
  ).accessToken;
  const sofor = soforler.find((s) => s.id !== temiz.id && s.id !== vardiyaliId) ?? temiz;
  const jetonSofor = (await issueTokens(sofor.id, false, sofor.token_version ?? 0))
    .accessToken;

  bilgi(`yönetici     : ${yonetici.name}`);
  bilgi(`temiz hedef  : ${temiz.name}  (${GELECEK_BAS} → ${GELECEK_BIT})`);
  bilgi(`vardiyalı    : ${vardiyali.name}  (${vardiyaGunu})`);
  bilgi(`şoför jetonu : ${sofor.name}`);

  const izinOnce = await say("worker_leaves");
  const izOnce = await say("leave_edit_log");
  bilgi(`ÖNCE — worker_leaves=${izinOnce} · leave_edit_log=${izOnce}`);

  // ── T1: ŞOFÖR 403 ───────────────────────────────────────────────────────
  baslik("1 · ŞOFÖR REDDEDİLİR (403)");
  {
    const r = await cevap(
      await POST(
        istek("/api/mobile/leaves", {
          token: jetonSofor,
          govde: {
            worker_id: temiz.id,
            leave_type: "jahresurlaub",
            start_date: GELECEK_BAS,
            end_date: GELECEK_BIT,
          },
        })
      )
    );
    iddia("403 döndü", r.kod === 403, `kod=${r.kod}`);
    iddia(
      "hata kodu fleet_view_required",
      r.govde.error === "fleet_view_required",
      `error=${r.govde.error}`
    );
    const sonra = await say("worker_leaves");
    iddia("HİÇBİR satır yazılmadı", sonra === izinOnce, `${izinOnce} → ${sonra}`);
  }

  // ── T2: GEÇERSİZ TÜR 400 ────────────────────────────────────────────────
  baslik("2 · GEÇERSİZ İZİN TÜRÜ (400)");
  {
    const r = await cevap(
      await POST(
        istek("/api/mobile/leaves", {
          token: jetonAdmin,
          govde: {
            worker_id: temiz.id,
            leave_type: "yok_boyle_bir_tur",
            start_date: GELECEK_BAS,
            end_date: GELECEK_BIT,
          },
        })
      )
    );
    iddia("400 döndü", r.kod === 400, `kod=${r.kod}`);
    iddia("hata kodu invalid", r.govde.error === "invalid", `error=${r.govde.error}`);
    iddia(
      "geçerli tür listesi cevapta (10 tür)",
      Array.isArray(r.govde.gecerliTurler) && r.govde.gecerliTurler.length === 10,
      `n=${r.govde.gecerliTurler?.length}`
    );
  }

  // ── T3: BİTİŞ < BAŞLANGIÇ 400 ───────────────────────────────────────────
  baslik("3 · BİTİŞ BAŞLANGIÇTAN ÖNCE (400 range)");
  {
    const r = await cevap(
      await POST(
        istek("/api/mobile/leaves", {
          token: jetonAdmin,
          govde: {
            worker_id: temiz.id,
            leave_type: "jahresurlaub",
            start_date: GELECEK_BIT,
            end_date: GELECEK_BAS,
          },
        })
      )
    );
    iddia("400 döndü", r.kod === 400, `kod=${r.kod}`);
    iddia("hata kodu range", r.govde.error === "range", `error=${r.govde.error}`);
  }

  // ── T4: `id` REDDEDİLİR (uç yalnız oluşturma) ───────────────────────────
  baslik("4 · GÖVDEDE `id` → 400 (düzenleme yolu kapalı)");
  {
    const r = await cevap(
      await POST(
        istek("/api/mobile/leaves", {
          token: jetonAdmin,
          govde: {
            id: "00000000-0000-4000-8000-000000000000",
            worker_id: temiz.id,
            leave_type: "jahresurlaub",
            start_date: GELECEK_BAS,
            end_date: GELECEK_BIT,
          },
        })
      )
    );
    iddia("400 döndü", r.kod === 400, `kod=${r.kod}`);
    iddia(
      "hata kodu id_not_allowed",
      r.govde.error === "id_not_allowed",
      `error=${r.govde.error}`
    );
  }

  // ── T5: YÖNETİCİ HEDEFİ 403 ─────────────────────────────────────────────
  baslik("5 · HEDEF YÖNETİCİ → 403 admin_target");
  {
    const r = await cevap(
      await POST(
        istek("/api/mobile/leaves", {
          token: jetonAdmin,
          govde: {
            worker_id: yonetici.id,
            leave_type: "jahresurlaub",
            start_date: GELECEK_BAS,
            end_date: GELECEK_BIT,
          },
        })
      )
    );
    iddia("403 döndü", r.kod === 403, `kod=${r.kod}`);
    iddia(
      "hata kodu admin_target",
      r.govde.error === "admin_target",
      `error=${r.govde.error}`
    );
  }

  // ── T6: BAŞARILI OLUŞTURMA ──────────────────────────────────────────────
  baslik("6 · BAŞARILI OLUŞTURMA (patron → approved)");
  {
    const r = await cevap(
      await POST(
        istek("/api/mobile/leaves", {
          token: jetonAdmin,
          govde: {
            worker_id: temiz.id,
            leave_type: "jahresurlaub",
            start_date: GELECEK_BAS,
            end_date: GELECEK_BIT,
            not: "canlı doğrulama — silinecek",
          },
        })
      )
    );
    iddia("201 döndü", r.kod === 201, `kod=${r.kod}`);
    iddia("ok:true", r.govde.ok === true, `ok=${r.govde.ok}`);
    iddia(
      "durum approved (patron kendi onaylar)",
      r.govde.izin?.durum === "approved",
      `durum=${r.govde.izin?.durum}`
    );
    iddia(
      "kararVerenId = yönetici (sunucu zorladı)",
      r.govde.izin?.kararVerenId === yonetici.id,
      `${r.govde.izin?.kararVerenId === yonetici.id ? "eşleşti" : r.govde.izin?.kararVerenId}`
    );
    iddia("not taşındı", r.govde.izin?.not === "canlı doğrulama — silinecek");
    if (r.govde.izin?.id) yazilanIzinler.push(r.govde.izin.id);

    const sonra = await say("worker_leaves");
    iddia("satır sayısı 1 arttı", sonra === izinOnce + 1, `${izinOnce} → ${sonra}`);
  }

  // ── T7: ÖRTÜŞME 409 ─────────────────────────────────────────────────────
  baslik("7 · AYNI GÜNLERE İKİNCİ İZİN → 409 overlap");
  {
    const oncekiSayi = await say("worker_leaves");
    const r = await cevap(
      await POST(
        istek("/api/mobile/leaves", {
          token: jetonAdmin,
          govde: {
            worker_id: temiz.id,
            leave_type: "krankenstand",
            start_date: GELECEK_BAS,
            end_date: GELECEK_BIT,
          },
        })
      )
    );
    iddia("409 döndü", r.kod === 409, `kod=${r.kod}`);
    iddia("hata kodu overlap", r.govde.error === "overlap", `error=${r.govde.error}`);
    const sonra = await say("worker_leaves");
    iddia("satır YAZILMADI", sonra === oncekiSayi, `${oncekiSayi} → ${sonra}`);
  }

  // ── T8: VARDİYA ÇAKIŞMASI → 200 + needConfirm ───────────────────────────
  baslik("8 · VARDİYA ÇAKIŞMASI → 200 + needConfirm (409 DEĞİL)");
  {
    const oncekiSayi = await say("worker_leaves");
    const r = await cevap(
      await POST(
        istek("/api/mobile/leaves", {
          token: jetonAdmin,
          govde: {
            worker_id: vardiyali.id,
            leave_type: "jahresurlaub",
            start_date: vardiyaGunu,
            end_date: vardiyaGunu,
          },
        })
      )
    );
    iddia("200 döndü (409 DEĞİL)", r.kod === 200, `kod=${r.kod}`);
    iddia("needConfirm:true", r.govde.needConfirm === true, `needConfirm=${r.govde.needConfirm}`);
    iddia("ok:false (hiçbir şey yazılmadı)", r.govde.ok === false, `ok=${r.govde.ok}`);
    iddia(
      "conflictShifts > 0",
      typeof r.govde.conflictShifts === "number" && r.govde.conflictShifts > 0,
      `conflictShifts=${r.govde.conflictShifts}`
    );
    const sonra = await say("worker_leaves");
    iddia("satır YAZILMADI", sonra === oncekiSayi, `${oncekiSayi} → ${sonra}`);
  }

  // ── T9: force:true İLE GEÇİLİR ──────────────────────────────────────────
  baslik("9 · force:true → teyit geçilir, KAYDEDİLİR");
  {
    const oncekiSayi = await say("worker_leaves");
    const r = await cevap(
      await POST(
        istek("/api/mobile/leaves", {
          token: jetonAdmin,
          govde: {
            worker_id: vardiyali.id,
            leave_type: "jahresurlaub",
            start_date: vardiyaGunu,
            end_date: vardiyaGunu,
            force: true,
          },
        })
      )
    );
    iddia("201 döndü", r.kod === 201, `kod=${r.kod}`);
    iddia("ok:true", r.govde.ok === true, `ok=${r.govde.ok}`);
    iddia("needConfirm YOK", r.govde.needConfirm === undefined);
    if (r.govde.izin?.id) yazilanIzinler.push(r.govde.izin.id);
    const sonra = await say("worker_leaves");
    iddia("satır sayısı 1 arttı", sonra === oncekiSayi + 1, `${oncekiSayi} → ${sonra}`);
  }

  // ── İZ ─────────────────────────────────────────────────────────────────
  baslik("10 · DEĞİŞİKLİK İZİ");
  {
    const izSonra = await say("leave_edit_log");
    iddia(
      "iki oluşturma için iki iz satırı",
      izSonra === izOnce + 2,
      `${izOnce} → ${izSonra}`
    );
  }

  // ── T11: FİLO ŞEFİ YOLU — ÇEKİRDEK SEVİYESİNDE ──────────────────────────
  //
  // ⚠️ NEDEN ROTA ÜZERİNDEN DEĞİL: galzura-demo'da `managed_fleet` dolu TEK
  // personel yok, yani `requireMobileFleetView` bir şef aktörü ÜRETEMEZ. Şef
  // yaratmak kadroyu kalıcı olarak değiştirirdi. Onun yerine ÇEKİRDEK doğrudan
  // bir şef aktörüyle çağrılıyor: rota katmanının tek yaptığı bu aktörü kurmak
  // olduğundan, kuralın kendisi (status='pending' + kapsam assert) burada
  // birebir aynı kodla sınanıyor — GERÇEK veritabanına karşı.
  baslik("11 · FİLO ŞEFİ (çekirdek) — pending + kapsam kapısı");
  {
    const { submitLeave, parseLeaveInput } = await import("@/lib/leave-submit-db.ts");
    const sefId = yonetici.id; // izi yazacak kişi; rolü aktör belirler, kayıt değil
    const kapsamli = {
      fleet: "mavi",
      vehicleIds: [],
      workerIds: [temiz.id],
      restricted: true,
      isFleetVehicle: () => false,
      isFleetWorker: (id) => id === temiz.id,
    };

    // 11a — kapsam DIŞI hedef reddedilir.
    const disParsed = parseLeaveInput({
      worker_id: vardiyali.id,
      leave_type: "jahresurlaub",
      start_date: GELECEK_BAS,
      end_date: GELECEK_BIT,
      force: true,
    });
    const dis = await submitLeave(disParsed.data, {
      workerId: sefId,
      isChief: true,
      scope: kapsamli,
    });
    iddia(
      "kapsam dışı hedef → scope",
      dis.ok === false && dis.hata === "scope",
      `hata=${dis.hata}`
    );

    // 11b — kapsam İÇİ hedef 'pending' yazılır (patron 'approved' yazmıştı).
    const icParsed = parseLeaveInput({
      worker_id: temiz.id,
      leave_type: "jahresurlaub",
      start_date: "2026-12-01",
      end_date: "2026-12-03",
      force: true,
    });
    const ic = await submitLeave(icParsed.data, {
      workerId: sefId,
      isChief: true,
      scope: kapsamli,
    });
    iddia("kapsam içi hedef yazıldı", ic.ok === true, `ok=${ic.ok}`);
    iddia(
      "durum pending (şef ONAYLAYAMAZ)",
      ic.ok === true && ic.satir.status === "pending",
      `durum=${ic.ok ? ic.satir.status : "-"}`
    );
    iddia(
      "approved_by boş (şef kendi onaylamadı)",
      ic.ok === true && ic.satir.approved_by === null,
      `approved_by=${ic.ok ? ic.satir.approved_by : "-"}`
    );
    if (ic.ok) yazilanIzinler.push(ic.id);
  }
} catch (e) {
  console.error(`\n✗ KOŞUM HATASI: ${e?.message ?? e}`);
  dusen++;
} finally {
  // ── GERİ ALMA ───────────────────────────────────────────────────────────
  baslik("GERİ ALMA");
  if (yazilanIzinler.length === 0) {
    bilgi("yazılan izin yok — geri alınacak bir şey de yok.");
  } else {
    const { error } = await supabaseAdmin
      .from("worker_leaves")
      .delete()
      .in("id", yazilanIzinler);
    const kalan = await supabaseAdmin
      .from("worker_leaves")
      .select("id", { count: "exact", head: true })
      .in("id", yazilanIzinler);
    iddia(
      `${yazilanIzinler.length} test izni silindi`,
      !error && (kalan.count ?? 0) === 0,
      `kalan=${kalan.count ?? "?"}`
    );
  }
  bilgi("leave_edit_log satırları BIRAKILDI — denetim izi silinmez (bilerek).");

  console.log(
    `\n╚══ ${dusen === 0 ? "TÜM İDDİALAR GEÇTİ" : `${dusen} İDDİA DÜŞTÜ`} ═══════════════════════════════════\n`
  );
  process.exit(dusen === 0 ? 0 : 1);
}
