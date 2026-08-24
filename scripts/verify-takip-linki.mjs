#!/usr/bin/env node
/**
 * MÜŞTERİ TAKİP LİNKİ — KANIT (migration 079).
 *
 * ⚠️ ÜRETİME DEĞİL, YEREL YIĞINA KOŞAR. `ENV_FILE=.env.takipqa` ile
 * çağrıldığında Docker'daki Postgres + PostgREST çiftine bağlanır. Üretim
 * veritabanında sefer ve link YARATMAK istemediğimiz için harness ayrı:
 * bu özellik yazma yollarını sınıyor ve sınama verisi gerçek bir müşteriye
 * gönderilmiş gibi görünen linkler üretiyor.
 *
 * Yerel yığının kurulumu: docs/TAKIP-LINKI.md §Prova.
 *
 * Kullanım:
 *   ENV_FILE=.env.takipqa node --import ./scripts/ts-server.mjs scripts/verify-takip-linki.mjs
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { createTakipLink } from "@/lib/takip-db";
import { sinirSifirla } from "@/lib/rate-limit";
import { GET as TAKIP_GET } from "@/app/api/takip/[token]/route";
import {
  POST as LINK_POST,
  GET as LINK_GET,
  DELETE as LINK_DELETE,
} from "@/app/api/mobile/sefer/[id]/takip-linki/route";

const SEFER = "e0000000-0000-0000-0000-00000000000e";
const YONETICI = "a0000000-0000-0000-0000-00000000000a";
const SOFOR = "b0000000-0000-0000-0000-00000000000b";

let dusen = 0;
function iddia(baslik, kosul, kanit) {
  console.log(`  ${kosul ? "✓" : "✗"} ${baslik}${kanit ? "  —  " + kanit : ""}`);
  if (!kosul) dusen++;
}
function bilgi(s) {
  console.log(`    ${s}`);
}

/** Girişsiz ucun GERÇEK işleyicisi. */
async function takipCagir(token, ip = "1.2.3.4") {
  const res = await TAKIP_GET(
    new Request(`http://x/api/takip/${token}`, { headers: { "x-forwarded-for": ip } }),
    { params: Promise.resolve({ token }) }
  );
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}

async function linkUret(token, govde) {
  const res = await LINK_POST(
    new Request(`http://x/api/mobile/sefer/${SEFER}/takip-linki`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(govde ?? {}),
    }),
    { params: Promise.resolve({ id: SEFER }) }
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}

console.log(`\n╔══ MÜŞTERİ TAKİP LİNKİ · KANIT (079) ═══════════════════════════════`);
console.log(`║ an   ${new Date().toISOString()}`);
console.log(`╚════════════════════════════════════════════════════════════════════\n`);

const temizlenecek = [];

try {
  // ══ 0) ÖN KOŞUL ═══════════════════════════════════════════════════════
  console.log(`── 0) ÖN KOŞUL ──`);
  const { count, error } = await supabaseAdmin
    .from("sefer_takip_linkleri")
    .select("*", { count: "exact", head: true });
  iddia("079 tablosu okunabiliyor", !error, error ? error.message : `${count} satır`);
  if (error) throw new Error("079 yok");

  const { data: sefer } = await supabaseAdmin
    .from("seferler")
    .select("id, durum, vehicle_id, zone_id")
    .eq("id", SEFER)
    .maybeSingle();
  iddia(
    "QA seferi hazır (yolda · araç + hedef bağlı)",
    !!sefer && sefer.durum === "yolda" && !!sefer.vehicle_id && !!sefer.zone_id,
    sefer ? `durum=${sefer.durum}` : "yok"
  );

  // ══ 1) KAPI ═══════════════════════════════════════════════════════════
  console.log(`\n── 1) LİNK ÜRETME KAPISI ──`);
  const yonetici = await issueTokens(YONETICI, true, 0);
  const soforTok = await issueTokens(SOFOR, false, 0);

  const jetonsuz = await LINK_POST(
    new Request(`http://x/api/mobile/sefer/${SEFER}/takip-linki`, { method: "POST" }),
    { params: Promise.resolve({ id: SEFER }) }
  );
  iddia("jetonsuz istek 401", jetonsuz.status === 401, String(jetonsuz.status));

  const soforDeneme = await linkUret(soforTok.accessToken, {});
  iddia("ŞOFÖR link üretemedi (403)", soforDeneme.status === 403, String(soforDeneme.status));

  const uretim = await linkUret(yonetici.accessToken, { aliciNot: "QA müşterisi" });
  iddia("yönetici link üretti (201)", uretim.status === 201, String(uretim.status));
  const link = uretim.json?.link;
  if (!link) throw new Error("link üretilemedi");
  temizlenecek.push(link.id);
  const token = String(link.url).split("/takip/")[1];
  bilgi(`url  : ${String(link.url).replace(token, token.slice(0, 8) + "…")}`);
  bilgi(`bitiş: ${link.bitis}  (ttl ${uretim.json.ttlDk} dk)`);
  iddia("token 43 karakter (32 bayt base64url)", token.length === 43, `${token.length} karakter`);
  iddia(
    "bitiş ~2 saat sonra",
    Math.abs((Date.parse(link.bitis) - Date.now()) / 60000 - 120) < 2,
    `${Math.round((Date.parse(link.bitis) - Date.now()) / 60000)} dk`
  );

  // ══ 2) GİRİŞSİZ OKUMA ═════════════════════════════════════════════════
  console.log(`\n── 2) GİRİŞSİZ OKUMA (gerçek uç) ──`);
  sinirSifirla();
  const acilis = await takipCagir(token);
  iddia("girişsiz istek 200", acilis.status === 200, String(acilis.status));
  const g = acilis.json;
  bilgi(
    `durum=${g?.durum} · eta=${g?.eta?.dakika ?? "—"} dk · konum=${g?.konum ? "var" : "yok"} · bayat=${g?.konum?.bayat}`
  );
  iddia("durum 'yolda'", g?.durum === "yolda", g?.durum);
  iddia(
    "araç konumu döndü",
    !!g?.konum && Number.isFinite(g.konum.lat),
    g?.konum ? `${g.konum.lat.toFixed(4)}, ${g.konum.lng.toFixed(4)}` : "yok"
  );
  iddia("hedef döndü", !!g?.hedef, g?.hedef ? `yarıçap ${g.hedef.yaricapM} m` : "yok");
  iddia(
    "ETA hesaplandı",
    typeof g?.eta?.dakika === "number",
    `${g?.eta?.dakika} dk (hız ${g?.eta?.kullanilanHizKms} km/s)`
  );
  iddia("konum TAZE (bayat değil)", g?.konum?.bayat === false);
  iddia(
    "cache-control no-store",
    (acilis.headers.get("cache-control") ?? "").includes("no-store"),
    acilis.headers.get("cache-control")
  );
  iddia(
    "x-robots-tag noindex",
    (acilis.headers.get("x-robots-tag") ?? "").includes("noindex"),
    acilis.headers.get("x-robots-tag")
  );

  // ══ 3) SIZINTI ════════════════════════════════════════════════════════
  console.log(`\n── 3) SIZINTI TESTİ (uç gövdesi) ──`);
  const govdeMetin = JSON.stringify(g);
  const yasakli = [
    ["şoför adı", "Sızıntı"],
    ["plaka", "QA-999XX"],
    ["filo kodu", "bordo"],
    ["araç kimliği", "c0000000-0000-0000-0000-00000000000c"],
    ["şoför kimliği", SOFOR],
    ["sefer kimliği", SEFER],
    ["bölge adı", "Adresi QA"],
  ];
  for (const [ad, iz] of yasakli) {
    iddia(`gövdede ${ad} YOK`, !govdeMetin.includes(iz), iz.slice(0, 18));
  }
  bilgi(`gövde alanları: ${Object.keys(g ?? {}).join(", ")}`);
  bilgi(`gövde uzunluğu: ${govdeMetin.length} bayt`);

  // ══ 4) HIZ SINIRI ═════════════════════════════════════════════════════
  console.log(`\n── 4) HIZ SINIRI ──`);
  sinirSifirla();
  let ilk429 = 0;
  let sonCevap = null;
  for (let i = 1; i <= 40; i++) {
    const r = await takipCagir(token, "9.9.9.9");
    if (r.status === 429 && ilk429 === 0) {
      ilk429 = i;
      sonCevap = r;
    }
  }
  iddia("tavan aşılınca 429 döndü", ilk429 > 0, ilk429 ? `${ilk429}. istekte` : "hiç dönmedi");
  iddia("429 TOKEN tavanında (31. istek)", ilk429 === 31, `${ilk429}. istek`);
  iddia(
    "Retry-After başlığı var",
    !!sonCevap?.headers.get("retry-after"),
    sonCevap?.headers.get("retry-after") + " sn"
  );
  sinirSifirla();
  const sonrasi = await takipCagir(token, "8.8.8.8");
  iddia("sayaç sıfırlanınca yine 200", sonrasi.status === 200, String(sonrasi.status));

  // ══ 5) ÜÇ ÖLÜM YOLU ═══════════════════════════════════════════════════
  console.log(`\n── 5) LİNK NASIL ÖLÜYOR ──`);
  sinirSifirla();

  // (a) SÜRE DOLDU
  const sureli = await createTakipLink(SEFER, YONETICI, "süre sınaması");
  if (!sureli.ok) throw new Error("süre sınaması linki üretilemedi");
  temizlenecek.push(sureli.veri.id);
  /**
   * ⚠️ YALNIZ `expires_at`i geçmişe çekmek İŞE YARAMAZ: 079'daki
   * `sefer_takip_sure_ileri` kısıtı (expires_at > created_at) UPDATE'i
   * reddeder ve link canlı kalır — ilk koşumda tam olarak bu oldu ve sınama
   * sessizce 200 gördü. Doğru benzetim: linki 3 saat ÖNCE üretilmiş gibi
   * geriye almak, yani İKİ damgayı birden kaydırmak.
   */
  const geriAl = await supabaseAdmin
    .from("sefer_takip_linkleri")
    .update({
      created_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
      expires_at: new Date(Date.now() - 3600_000).toISOString(),
    })
    .eq("id", sureli.veri.id)
    .select("id, expires_at")
    .maybeSingle();
  iddia(
    "(a) süre geçmişe alındı (kısıt korunarak)",
    !geriAl.error && !!geriAl.data,
    geriAl.error ? geriAl.error.message.slice(0, 60) : `bitiş ${geriAl.data?.expires_at}`
  );
  const doldu = await takipCagir(sureli.veri.token);
  iddia(
    "(a) süresi dolan link 410 · sebep=suresi_doldu",
    doldu.status === 410 && doldu.json?.sebep === "suresi_doldu",
    `${doldu.status} ${doldu.json?.sebep}`
  );

  // (b) YÖNETİCİ İPTALİ — gerçek uçtan
  const iptallik = await createTakipLink(SEFER, YONETICI, "iptal sınaması");
  if (!iptallik.ok) throw new Error("iptal sınaması linki üretilemedi");
  temizlenecek.push(iptallik.veri.id);
  const oncesi = await takipCagir(iptallik.veri.token);
  iddia("(b) iptalden ÖNCE 200", oncesi.status === 200, String(oncesi.status));
  const iptalRes = await LINK_DELETE(
    new Request(`http://x/api/mobile/sefer/${SEFER}/takip-linki?link=${iptallik.veri.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${yonetici.accessToken}` },
    }),
    { params: Promise.resolve({ id: SEFER }) }
  );
  iddia("(b) iptal ucu 200", iptalRes.status === 200, String(iptalRes.status));
  const iptalSonrasi = await takipCagir(iptallik.veri.token);
  iddia(
    "(b) iptalden SONRA 410 · sebep=iptal_edildi",
    iptalSonrasi.status === 410 && iptalSonrasi.json?.sebep === "iptal_edildi",
    `${iptalSonrasi.status} ${iptalSonrasi.json?.sebep}`
  );

  // (c) SEFER TAMAMLANDI — link tablosuna DOKUNULMADAN ölmeli
  const canli = await createTakipLink(SEFER, YONETICI, "tamamlanma sınaması");
  if (!canli.ok) throw new Error("tamamlanma sınaması linki üretilemedi");
  temizlenecek.push(canli.veri.id);
  const tamOnce = await takipCagir(canli.veri.token);
  iddia("(c) sefer açıkken 200", tamOnce.status === 200, String(tamOnce.status));
  await supabaseAdmin
    .from("seferler")
    .update({ durum: "tamamlandi", tamamlandi_at: new Date().toISOString() })
    .eq("id", SEFER);
  const tamSonra = await takipCagir(canli.veri.token);
  iddia(
    "(c) sefer tamamlanınca 410 · sebep=sefer_kapandi",
    tamSonra.status === 410 && tamSonra.json?.sebep === "sefer_kapandi",
    `${tamSonra.status} ${tamSonra.json?.sebep}`
  );
  const { data: dokunulmus } = await supabaseAdmin
    .from("sefer_takip_linkleri")
    .select("revoked_at")
    .eq("id", canli.veri.id)
    .maybeSingle();
  iddia(
    "(c) link satırına DOKUNULMADI (türetilen gerçek)",
    dokunulmus?.revoked_at === null,
    `revoked_at=${dokunulmus?.revoked_at}`
  );

  const kapaliya = await linkUret(yonetici.accessToken, {});
  iddia("kapalı sefere link ÜRETİLEMEZ (409)", kapaliya.status === 409, `${kapaliya.status} ${kapaliya.json?.sebep}`);

  // Seferi geri aç — sonraki koşumlar aynı yerden başlasın.
  await supabaseAdmin.from("seferler").update({ durum: "yolda", tamamlandi_at: null }).eq("id", SEFER);

  // ══ 6) GEÇERSİZ TOKEN ═════════════════════════════════════════════════
  console.log(`\n── 6) GEÇERSİZ TOKEN ──`);
  sinirSifirla();
  const kisa = await takipCagir("kisa");
  iddia("biçimsiz token 404 (DB'ye gidilmeden)", kisa.status === 404, String(kisa.status));
  const olmayan = await takipCagir("A".repeat(43));
  iddia(
    "var olmayan token 404",
    olmayan.status === 404 && olmayan.json?.sebep === "bulunamadi",
    `${olmayan.status} ${olmayan.json?.sebep}`
  );

  // ══ 7) YÖNETİCİ LİSTESİ ═══════════════════════════════════════════════
  console.log(`\n── 7) YÖNETİCİ LİSTESİ ──`);
  const liste = await LINK_GET(
    new Request(`http://x/api/mobile/sefer/${SEFER}/takip-linki`, {
      headers: { authorization: `Bearer ${yonetici.accessToken}` },
    }),
    { params: Promise.resolve({ id: SEFER }) }
  );
  const listeJson = await liste.json();
  iddia("liste 200", liste.status === 200, String(liste.status));
  iddia("üretilen linkler listede", (listeJson.linkler ?? []).length >= 4, `${(listeJson.linkler ?? []).length} link`);
  const iptalli = (listeJson.linkler ?? []).filter((l) => l.iptalEdildi).length;
  bilgi(`iptalli: ${iptalli} · açık: ${(listeJson.linkler ?? []).length - iptalli}`);
  iddia(
    "yönetici listesinde tam URL var",
    String(listeJson.linkler?.[0]?.url ?? "").includes("/takip/"),
    String(listeJson.linkler?.[0]?.url ?? "").slice(0, 30) + "…"
  );
} catch (e) {
  console.error(`\n  ✗ KOŞUM İSTİSNAYLA KESİLDİ: ${e?.stack ?? e}`);
  dusen++;
} finally {
  console.log(`\n── TEMİZLİK ──`);
  const idler = temizlenecek.filter(Boolean);
  if (idler.length) {
    const { error } = await supabaseAdmin.from("sefer_takip_linkleri").delete().in("id", idler);
    iddia(`${idler.length} QA linki silindi`, !error, error?.message);
  }
  const { count: kalan } = await supabaseAdmin
    .from("sefer_takip_linkleri")
    .select("id", { count: "exact", head: true });
  console.log(`  tabloda kalan link: ${kalan ?? 0}`);
  console.log(`\n${dusen === 0 ? "✓ TÜM ÖLÇÜLEBİLİR İDDİALAR DOĞRULANDI" : `✗ ${dusen} iddia düştü`}\n`);
  process.exit(dusen === 0 ? 0 : 1);
}
