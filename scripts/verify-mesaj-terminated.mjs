#!/usr/bin/env node
/**
 * MESAJ UÇLARINDA AYRILMIŞ PERSONEL KAPISI — CANLI kanıt (15. madde).
 *
 * ⚠️ BU BETİK **YAZAR**: bir şoförü geçici olarak `terminated_at` ile
 * işaretler, ölçer ve geri alır. Bu yüzden YALNIZ galzura-demo'da koşar;
 * HAK61 ve Sendigo canlı müşteri olduğu için orada kendini durdurur.
 *
 * ⚠️ `is_active`'e DOKUNULMAZ. Ölçülecek şey tam olarak şu: çıkışı işlenmiş
 * ama hesabı hâlâ aktif olan kişi (canlıda gerçekten olan durum) eski kapıdan
 * GEÇİYORDU — yeni kapı onu durduruyor mu?
 *
 * NE KANITLIYOR:
 *   1. VAR OLAN konuşmanın geçmişi 200 döner ve mesaj sayısı DEĞİŞMEZ
 *   2. Aynı konuşmaya POST → 409 `worker_left`
 *   3. Konuşması OLMAYAN ayrılmış şoförle yeni sohbet → GET 409 `worker_left`
 *   4. Gruba üye ekleme → 409 `worker_left`
 *   5. terminated_at geri alınınca ÜÇÜ DE eski hâline döner
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo npm run verify:mesaj-terminated
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";

if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ şim devrede — gerçek veritabanı gerekli.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KIRACI = url.includes("gopptkmetpfsxmgcijbb")
  ? "HAK61"
  : url.includes("ftbazsyiolkeqivwzmlh")
    ? "Sendigo"
    : url.includes("omgnkvoulndbglmxlvzc")
      ? "galzura-demo"
      : "BİLİNMEYEN";
if (KIRACI !== "galzura-demo") {
  console.error(
    `✗ DURDURULDU — bu betik YAZAR ve yalnız galzura-demo'da koşar.\n` +
      `  Bulunan kiracı: ${KIRACI}. HAK61/Sendigo canlı müşteri.`
  );
  process.exit(1);
}

let gecen = 0;
const dusen = [];
function ok(baslik, kosul, kanit) {
  if (kosul) {
    gecen++;
    console.log(`  ✓ ${baslik}${kanit ? `   [${kanit}]` : ""}`);
  } else {
    dusen.push({ baslik, kanit });
    console.log(`  ✗ ${baslik}   [${kanit}]`);
  }
}

const { GET: MSG_GET, POST: MSG_POST } = await import(
  "@/app/api/mobile/messages/[id]/route.ts"
);
const { POST: UYE_EKLE } = await import(
  "@/app/api/mobile/messages/gruplar/[id]/uyeler/route.ts"
);

// ── Yönetici jetonu ─────────────────────────────────────────────────────────
const { data: adm } = await supabaseAdmin
  .from("workers")
  .select("id, name, token_version")
  .eq("is_admin", true)
  .eq("is_active", true)
  .limit(1)
  .maybeSingle();
if (!adm) {
  console.error("✗ yönetici bulunamadı");
  process.exit(1);
}
const token = (await issueTokens(adm.id, true, adm.token_version ?? 0)).accessToken;
const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const gecmis = async (adres) => {
  const res = await MSG_GET(
    new Request(`https://x.invalid/api/mobile/messages/${adres}`, { headers: H }),
    { params: Promise.resolve({ id: adres }) }
  );
  return { kod: res.status, govde: await res.json() };
};
const yaz = async (adres, metin) => {
  const res = await MSG_POST(
    new Request(`https://x.invalid/api/mobile/messages/${adres}`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ govde: metin }),
    }),
    { params: Promise.resolve({ id: adres }) }
  );
  return { kod: res.status, govde: await res.json() };
};
const grupKur = async (baslik, uyeler) => {
  const { POST: GRUP_KUR } = await import("@/app/api/mobile/messages/gruplar/route.ts");
  const res = await GRUP_KUR(
    new Request("https://x.invalid/api/mobile/messages/gruplar", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ baslik, uyeler }),
    })
  );
  return { kod: res.status, govde: await res.json() };
};
const uyeEkle = async (grupId, uyeIdler) => {
  const res = await UYE_EKLE(
    new Request(`https://x.invalid/api/mobile/messages/gruplar/${grupId}/uyeler`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ uyeler: uyeIdler }),
    }),
    { params: Promise.resolve({ id: grupId }) }
  );
  return { kod: res.status, govde: await res.json() };
};

console.log(`\n═══ kiracı: ${KIRACI} · yönetici: ${adm.name} ═══`);

// ── Denek seç ───────────────────────────────────────────────────────────────
// A) KONUŞMASI OLAN şoför  B) konuşması OLMAYAN şoför
const { data: konusmalar } = await supabaseAdmin
  .from("conversations")
  .select("id, worker_id, kind")
  .eq("kind", "direct");
const konusmaliIdler = (konusmalar ?? []).map((c) => c.worker_id).filter(Boolean);

const { data: soforler } = await supabaseAdmin
  .from("workers")
  .select("id, name, is_active, is_admin, counts_as_driver, terminated_at")
  .eq("is_active", true)
  .is("terminated_at", null)
  .order("name");
const uygun = (soforler ?? []).filter(
  (w) => !(w.is_admin === true && w.counts_as_driver !== true)
);
let A = uygun.find((w) => konusmaliIdler.includes(w.id));
/**
 * Demo'da hiç birebir konuşma yoksa deneği BETİK KENDİ AÇAR — ucun kendi POST
 * yolundan, elle INSERT ederek değil. Böylece "geçmiş" gerçekten bu ucun
 * yazdığı bir geçmiş olur. Sonda satırlar KİMLİKLE silinir (bkz. temizlik).
 */
let bizOlusturduk = false;
if (!A) {
  A = uygun[0];
  if (A) {
    const ilk = await yaz(A.id, "[kanıt betiği] konuşma açılışı");
    if (ilk.kod !== 200 && ilk.kod !== 201) {
      console.error(`✗ denek konuşması açılamadı: ${ilk.kod} ${JSON.stringify(ilk.govde)}`);
      process.exit(1);
    }
    bizOlusturduk = true;
  }
}
const { data: konusmalar2 } = await supabaseAdmin
  .from("conversations")
  .select("id, worker_id, kind")
  .eq("kind", "direct");
const konusmaliIdler2 = (konusmalar2 ?? []).map((c) => c.worker_id).filter(Boolean);
const B = uygun.find((w) => !konusmaliIdler2.includes(w.id) && w.id !== A?.id);
if (!A || !B) {
  console.error(
    `✗ denek bulunamadı (konuşmalı=${A ? "var" : "yok"} konuşmasız=${B ? "var" : "yok"})`
  );
  process.exit(1);
}
const konusmaA = (konusmalar2 ?? []).find((c) => c.worker_id === A.id);
console.log(`denek A (konuşması VAR) : ${A.name}${bizOlusturduk ? "  (konuşmayı betik açtı)" : ""}`);
console.log(`denek B (konuşması YOK) : ${B.name}`);

// Grup denek
const { data: gruplar } = await supabaseAdmin
  .from("conversations")
  .select("id, title, archived_at")
  .eq("kind", "group")
  .is("archived_at", null)
  .limit(1);
let GRUP = (gruplar ?? [])[0] ?? null;
/**
 * Grup yoksa BETİK AÇAR — yine ucun kendi yolundan. Grup denetimi atlanamaz:
 * istenen kapı ÜÇ yüzeyde birden ve biri ölçülmezse kanıt eksik kalır.
 * Açtığımız grup sonda kimlikle silinir.
 */
let grubuBizActi = false;
if (!GRUP) {
  const kurucuUye = uygun.find((w) => w.id !== A?.id && w.id !== adm.id);
  const g = await grupKur("[kanıt betiği] geçici grup", kurucuUye ? [kurucuUye.id] : []);
  if (g.kod === 200 && g.govde.grup) {
    GRUP = { id: g.govde.grup.konusmaId ?? g.govde.grup.id, title: g.govde.grup.baslik };
    grubuBizActi = true;
  } else {
    console.log(`   grup açılamadı: ${g.kod} ${JSON.stringify(g.govde).slice(0, 120)}`);
  }
}
console.log(
  `denek grup              : ${GRUP ? GRUP.title : "YOK"}${grubuBizActi ? "  (grubu betik açtı)" : ""}`
);

const mesajSay = async (konusmaId) => {
  const { count } = await supabaseAdmin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", konusmaId);
  return count ?? 0;
};

let damgaAtildi = false;
try {
  // ══ ÖNCE ════════════════════════════════════════════════════════════════
  console.log("\n────────── ÖNCE (terminated_at boş) ──────────");
  const g0 = await gecmis(A.id);
  const sayi0 = await mesajSay(konusmaA.id);
  ok("A geçmişi 200", g0.kod === 200, String(g0.kod));
  ok("A yazabilir:true", g0.govde.yazabilir === true, String(g0.govde.yazabilir));
  console.log(`   A konuşmasındaki mesaj sayısı: ${sayi0}`);
  const b0 = await gecmis(B.id);
  ok("B (yeni sohbet) 200", b0.kod === 200, String(b0.kod));
  ok("B konuşmaId null (henüz yok)", b0.govde.konusmaId === null, String(b0.govde.konusmaId));
  if (GRUP) {
    // Zaten üyeyse "already_member" gelebilir; ölçtüğümüz şey 409 worker_left DEĞİL olması.
    const u0 = await uyeEkle(GRUP.id, [A.id]);
    ok(
      "gruba ekleme worker_left DEĞİL",
      u0.govde.error !== "worker_left",
      `${u0.kod} ${u0.govde.error ?? "ok"}`
    );
  }

  // ══ DAMGA: terminated_at (is_active'e DOKUNULMUYOR) ══════════════════════
  console.log("\n────────── terminated_at işaretleniyor ──────────");
  const cikis = "2026-09-15";
  for (const w of [A, B]) {
    const { error } = await supabaseAdmin
      .from("workers")
      .update({ terminated_at: cikis })
      .eq("id", w.id);
    if (error) throw new Error(`terminated_at yazılamadı: ${error.message}`);
  }
  damgaAtildi = true;
  const { data: kontrol } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_active, terminated_at")
    .in("id", [A.id, B.id]);
  for (const w of kontrol ?? []) {
    console.log(`   ${w.name}: terminated_at=${w.terminated_at} · is_active=${w.is_active}`);
  }
  ok(
    "is_active'e DOKUNULMADI (ikisi de hâlâ aktif)",
    (kontrol ?? []).every((w) => w.is_active === true),
    JSON.stringify((kontrol ?? []).map((w) => w.is_active))
  );

  // ══ SONRA ═══════════════════════════════════════════════════════════════
  console.log("\n────────── SONRA (terminated_at dolu) ──────────");
  const g1 = await gecmis(A.id);
  ok("🔑 A geçmişi HÂLÂ 200 (geçmiş okunur)", g1.kod === 200, String(g1.kod));
  ok(
    "A mesaj sayısı DEĞİŞMEDİ",
    (await mesajSay(konusmaA.id)) === sayi0,
    `${await mesajSay(konusmaA.id)} vs ${sayi0}`
  );
  ok("A yazabilir:false oldu", g1.govde.yazabilir === false, String(g1.govde.yazabilir));

  const p1 = await yaz(A.id, "kapı denemesi — bu mesaj yazılmamalı");
  ok("🔑 A'ya POST 409", p1.kod === 409, String(p1.kod));
  ok("🔑 sebep worker_left", p1.govde.error === "worker_left", String(p1.govde.error));
  ok(
    "POST hiçbir mesaj YAZMADI",
    (await mesajSay(konusmaA.id)) === sayi0,
    `${await mesajSay(konusmaA.id)} vs ${sayi0}`
  );

  const b1 = await gecmis(B.id);
  ok("🔑 B (yeni sohbet) 409", b1.kod === 409, String(b1.kod));
  ok("🔑 sebep worker_left", b1.govde.error === "worker_left", String(b1.govde.error));

  if (GRUP) {
    const u1 = await uyeEkle(GRUP.id, [B.id]);
    ok("🔑 gruba ekleme 409", u1.kod === 409, String(u1.kod));
    ok("🔑 sebep worker_left", u1.govde.error === "worker_left", String(u1.govde.error));
  }

  // Ayrılmamış başka biri ETKİLENMEDİ — kapı geniş değil, hedefli.
  const C = uygun.find((w) => w.id !== A.id && w.id !== B.id);
  if (C) {
    const c1 = await gecmis(C.id);
    ok(
      "ayrılmamış şoför ETKİLENMEDİ (200)",
      c1.kod === 200 && c1.govde.yazabilir === true,
      `${c1.kod} yazabilir=${c1.govde.yazabilir}`
    );
  }
} finally {
  // ══ GERİ AL ═════════════════════════════════════════════════════════════
  console.log("\n────────── temizlik ──────────");
  if (damgaAtildi) {
    for (const w of [A, B]) {
      await supabaseAdmin.from("workers").update({ terminated_at: null }).eq("id", w.id);
    }
  }
  const { data: son } = await supabaseAdmin
    .from("workers")
    .select("id, name, is_active, terminated_at")
    .in("id", [A.id, B.id]);
  ok(
    "terminated_at geri alındı (ikisi de null)",
    (son ?? []).every((w) => w.terminated_at === null),
    JSON.stringify((son ?? []).map((w) => w.terminated_at))
  );
  ok(
    "is_active bozulmadı",
    (son ?? []).every((w) => w.is_active === true),
    JSON.stringify((son ?? []).map((w) => w.is_active))
  );
  const g2 = await gecmis(A.id);
  ok("A yeniden yazılabilir", g2.kod === 200 && g2.govde.yazabilir === true, `${g2.kod} yazabilir=${g2.govde.yazabilir}`);
  const b2 = await gecmis(B.id);
  ok("B yeni sohbet yeniden 200", b2.kod === 200, String(b2.kod));

  // Betiğin KENDİ açtığı konuşma + mesajı sil. Ürün verisi değil, bu koşumun
  // çöpü; var olan bir konuşmaya rastladıysak HİÇBİR ŞEYE dokunulmaz.
  if (bizOlusturduk && konusmaA) {
    await supabaseAdmin.from("messages").delete().eq("conversation_id", konusmaA.id);
    await supabaseAdmin.from("conversations").delete().eq("id", konusmaA.id);
    const { count } = await supabaseAdmin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("id", konusmaA.id);
    ok("betiğin açtığı konuşma silindi", (count ?? 0) === 0, `kalan=${count ?? 0}`);
  }
  if (grubuBizActi && GRUP) {
    await supabaseAdmin.from("messages").delete().eq("conversation_id", GRUP.id);
    await supabaseAdmin.from("conversation_members").delete().eq("conversation_id", GRUP.id);
    await supabaseAdmin.from("conversations").delete().eq("id", GRUP.id);
    const { count } = await supabaseAdmin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("id", GRUP.id);
    ok("betiğin açtığı grup silindi", (count ?? 0) === 0, `kalan=${count ?? 0}`);
  }
}

console.log(
  `\n${dusen.length === 0 ? "✓" : "✗"} mesaj ayrılmış-personel kapısı: ${gecen}/${gecen + dusen.length} denetim geçti` +
    (dusen.length ? `\nDÜŞEN:\n${dusen.map((d) => `  · ${d.baslik}  [${d.kanit}]`).join("\n")}` : "")
);
process.exit(dusen.length === 0 ? 0 : 1);
