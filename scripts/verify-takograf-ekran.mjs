#!/usr/bin/env node
/**
 * TAKOGRAF EKRANI — RENDER KANITI (migration 091).
 *
 * Kardeş betik (`verify-takograf.mjs`) motoru ölçüyor. Bu betik EKRANI ölçüyor:
 * üretim derlemesi (`next start`), gerçek iron-session çerezi, gerçek HTML.
 *
 * Beş soru:
 *   1. Liste ve detay sayfaları 200 dönüyor mu?
 *   2. Arşiv vaadi ("dosya silinmez, her zaman indirilir") ekranda YAZILI mı?
 *   3. Mühür doğrulanamamış dosya için KALICI ŞERİT + 2px amber çizgi var mı?
 *   4. Okunamamış dosya için "arşivde duruyor" cümlesi çıkıyor mu?
 *   5. Ölçülemeyen süre "—" mi, "0:00" mı?
 *   6. Ekranda SİLME düğmesi YOK mu? (olmaması bir özellik)
 *
 * ⚠️ `NEXT_PUBLIC_*` derleme anında gömülür: QA yığınına bakan bir `next start`
 * için QA env'iyle YENİDEN DERLEMEK şart.
 *
 * Kullanım:
 *   cp <scratchpad>/.env.takoqa .env.production.local
 *   npm run build && npx next start -p 3301 &
 *   ENV_FILE=<scratchpad>/.env.takoqa TAKOGRAF_EKRAN_PORT=3301 \
 *     node --import ./scripts/ts-server.mjs scripts/verify-takograf-ekran.mjs
 */
import { sealData } from "iron-session";
import { supabaseAdmin } from "@/lib/supabase";

const TABAN = `http://127.0.0.1:${process.env.TAKOGRAF_EKRAN_PORT ?? 3301}`;

let dusen = 0;
let gecen = 0;
const iddia = (b, k, kanit = "") => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit ? "  —  " + kanit : ""}`);
  if (k) gecen++;
  else dusen++;
};
const baslik = (s) => console.log(`\n═══ ${s} ═══`);

const { data: yon } = await supabaseAdmin
  .from("workers")
  .select("id, name, phone")
  .limit(1)
  .single();

const cerez = await sealData(
  { worker_id: yon.id, name: yon.name ?? "QA", phone: yon.phone ?? "", is_admin: true },
  { password: process.env.SESSION_PASSWORD, ttl: 0 }
);

/**
 * 🔴 İKİ TUZAK, İKİSİ DE BU FONKSİYONDA KARŞILANIYOR.
 *
 * BİR — GÖRÜNEN METİN, GÖMÜLÜ SÖZLÜK DEĞİL. Next tüm i18n sözlüğünü
 * `self.__next_f.push(...)` içine gömüyor; ham HTML'de arama yapmak sözlükteki
 * metni "ekranda var" sanır. Bu tuzağa bu projede iki kez düşüldü — iddialar
 * <script> blokları ÇIKARILMIŞ metinde aranır.
 *
 * İKİ — AKIŞ (streaming) İSKELETİ. 26.08.2026'da yakalandı.
 *
 * Sayfa hızlı render olduğunda gerçek DOM doğrudan HTML'de gelir. QA
 * veritabanı yavaşladığında Next önce `loading.tsx` iskeletini FLUSH eder ve
 * gerçek DOM'u `<script>self.__next_f.push(…)</script>` parçalarında gönderir.
 * Script'leri soyan bir denetim o durumda ELİNDE YALNIZ İSKELET kalır ve
 * "ekranda yok" der — ya da daha kötüsü, olumsuz iddialar ("SİL düğmesi yok")
 * boş sayfada KENDİLİĞİNDEN geçer. Ölçüldü: aynı URL bir koşuda 277.543 bayt
 * (içerik gömülü), başka bir koşuda 184.813 bayt (yalnız iskelet).
 *
 * Çözüm: iskelet gelirse YENİDEN DENE, üç denemede de iskelet gelirse
 * ÇÖK. Sessiz geçen bir kanıt, kanıt değildir.
 */
async function sayfa(yol, deneme = 0) {
  const r = await fetch(TABAN + yol, {
    headers: { cookie: `hak_session=${cerez}` },
    redirect: "manual",
  });
  const ham = await r.text();
  const html = ham.replace(/<script[\s\S]*?<\/script>/g, "");
  const yalnizIskelet = html.includes("animate-pulse") && !html.includes("<table");
  if (yalnizIskelet && r.status === 200) {
    if (deneme >= 2) {
      console.error(
        [
          "",
          `✗ ${yol} üç denemede de yalnız AKIŞ İSKELETİ döndü (${ham.length} bayt).`,
          "  İçerik <script> parçalarında geliyor; bu betik onu göremez ve",
          "  iddialar sessizce geçer. QA veritabanını ısıtıp tekrar koşun.",
        ].join(String.fromCharCode(10))
      );
      process.exit(2);
    }
    await new Promise((c) => setTimeout(c, 400));
    return sayfa(yol, deneme + 1);
  }
  return { durum: r.status, ham, html };
}
const metin = (h) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

// ── LİSTE ────────────────────────────────────────────────────────────────
baslik("LİSTE — /admin/takograf");
const L = await sayfa("/admin/takograf");
iddia("sayfa 200", L.durum === 200, `HTTP ${L.durum}`);
const lMetin = metin(L.html);

iddia(
  "🔑 ARŞİV VAADİ ekranda yazılı",
  /kalıcı olarak saklanır/i.test(lMetin) && /hiçbir zaman silinmez/i.test(lMetin),
  "'kalıcı olarak saklanır … hiçbir zaman silinmez'"
);
iddia("orijinali indirme her satırda", (L.html.match(/Orijinalini indir/g) ?? []).length > 0);

// Süzgeç şeridi + sayılar
for (const e of ["Tümü", "Doğrulandı", "Doğrulanamadı", "Denetlenmedi", "Okunamadı"]) {
  iddia(`süzgeç şeridinde "${e}"`, lMetin.includes(e));
}

// ── MÜHÜR UYARISI ────────────────────────────────────────────────────────
baslik("MÜHÜR UYARISI");
const { data: uyarili } = await supabaseAdmin
  .from("takograf_dosyalari")
  .select("id")
  .eq("muhur_durumu", "dogrulanamadi")
  .limit(1);
const { count: uyariSayisi } = await supabaseAdmin
  .from("takograf_dosyalari")
  .select("id", { count: "exact", head: true })
  .eq("muhur_durumu", "dogrulanamadi");

iddia("QA'da doğrulanamamış dosya var (uyarı yüzeyi sınanabilir)", (uyarili ?? []).length > 0, `${uyariSayisi} dosya`);

iddia(
  "🔴 KALICI ŞERİT tablo üstünde",
  /doğrulaması yapılamadı/i.test(lMetin) && /denetimde kullanmayın/i.test(lMetin),
  "'… doğrulaması yapılamadı — denetimde kullanmayın'"
);
iddia("şerit dosya SAYISINI veriyor", new RegExp(`${uyariSayisi}\\s*dosyanın`).test(lMetin));
iddia(
  "🔴 satırın SOL KENARINDA 2px amber çizgi",
  /border-l-2[^"]*border-l-amber-500|border-l-amber-500[^"]*border-l-2/.test(L.html),
  "border-l-2 border-l-amber-500"
);

// ── DETAY ────────────────────────────────────────────────────────────────
baslik("DETAY — /admin/takograf/[id]");
const { data: tamam } = await supabaseAdmin
  .from("takograf_dosyalari")
  .select("id")
  .eq("ayristirma_durumu", "tamam")
  .limit(1)
  .single();
const D = await sayfa(`/admin/takograf/${tamam.id}`);
iddia("sayfa 200", D.durum === 200, `HTTP ${D.durum}`);
const dMetin = metin(D.html);

for (const s of ["Şoför", "Tarih", "Ne yapıyordu", "Başlangıç", "Bitiş", "Süre", "Araç"]) {
  iddia(`sütun "${s}"`, dMetin.includes(s));
}
iddia("faaliyet etiketleri Türkçe sektör terimi", /Sürüş/.test(dMetin) && /Diğer iş/.test(dMetin));
iddia("🔴 detayda da mühür şeridi var", /doğrulaması yapılamadı/i.test(dMetin));

// Alt toplam + ölçülemeyen
const { count: satirSayisi } = await supabaseAdmin
  .from("takograf_faaliyetleri")
  .select("id", { count: "exact", head: true })
  .eq("dosya_id", tamam.id);
const { count: olculemeyen } = await supabaseAdmin
  .from("takograf_faaliyetleri")
  .select("id", { count: "exact", head: true })
  .eq("dosya_id", tamam.id)
  .is("sure_dk", null);

iddia("alt toplam satır sayısını veriyor", new RegExp(`${satirSayisi}\\s*kayıt`).test(dMetin), `${satirSayisi} kayıt`);
iddia(
  "🔑 ölçülemeyen süre AYRI sayılıyor",
  olculemeyen === 0 || new RegExp(`${olculemeyen} kaydın süresi ölçülemedi`).test(dMetin),
  `${olculemeyen} satır`
);
/**
 * 🔑 "ölçülemedi ≠ 0" — EKRANDA. Alt toplam yalnız ölçülmüş satırlardan
 * gelir; hiç ölçülmemiş bir kategori "0:00" değil "—" yazar. Tabloda da her
 * ölçülemeyen satır bir "—" bırakır, dolayısıyla en az o kadar tire olmalı.
 */
const tireSayisi = (dMetin.match(/—/g) ?? []).length;
iddia(
  "🔑 ölçülemeyen satır '0:00' DEĞİL '—' gösteriyor",
  olculemeyen === 0 || tireSayisi >= olculemeyen,
  `${tireSayisi} tire ≥ ${olculemeyen} ölçülemeyen satır`
);
if (olculemeyen === satirSayisi) {
  iddia(
    "🔑 HİÇBİRİ ölçülemeyen dosyada alt toplam '0:00' YAZMIYOR",
    !/Sürüş\s*0:00/.test(dMetin),
    "alt toplamda 'Sürüş —'"
  );
}

// ── OKUNAMAMIŞ DOSYA ─────────────────────────────────────────────────────
baslik("OKUNAMAMIŞ DOSYA — arşivde duruyor");
const { data: bozuk } = await supabaseAdmin
  .from("takograf_dosyalari")
  .select("id")
  .eq("ayristirma_durumu", "basarisiz")
  .limit(1)
  .single();
if (bozuk) {
  const B = await sayfa(`/admin/takograf/${bozuk.id}`);
  const bMetin = metin(B.html);
  iddia("sayfa 200", B.durum === 200, `HTTP ${B.durum}`);
  iddia(
    "🔑 'arşivde DURUYOR ve indirilebilir — silinmedi' yazıyor",
    /arşivde DURUYOR/i.test(bMetin) && /silinmedi/i.test(bMetin)
  );
  iddia("indirme düğmesi YİNE var", /Orijinalini indir/.test(B.html));
  iddia("boş faaliyet tablosunda iskelet kalıyor (Twingate)", /<thead/.test(B.html));
}

// ── SİLME YOK ────────────────────────────────────────────────────────────
baslik("SİLME YOK");
iddia(
  "🔴 listede SİL düğmesi YOK",
  !/>\s*Sil\s*</.test(L.html) && !L.html.includes("CrudSatirEylemleri"),
  "silme yüzeyi hiç render edilmiyor"
);
iddia("🔴 detayda SİL düğmesi YOK", !/>\s*Sil\s*</.test(D.html));

console.log(`\n${"─".repeat(62)}`);
console.log(`  ${gecen} geçti · ${dusen} kaldı`);
if (dusen > 0) process.exit(1);
console.log(`  ✓ TAKOGRAF EKRANI DOĞRULANDI`);
