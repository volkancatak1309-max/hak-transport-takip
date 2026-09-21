#!/usr/bin/env node
/**
 * İŞ EMRİ UÇLARI MUHAFIZI — kaynak denetimi (Faz C-1).
 *
 * ═══ NE KORUYOR ═══
 *
 * Bu turun tek cümlelik sözü: **kural çekirdekte, yüzeyler onu çağırır.**
 * Panel (`app/actions/is-emri.ts`) ve mobil uçlar aynı `lib/is-emri-db.ts`
 * fonksiyonlarını kullanıyor. Bir yüzeye "hızlıca" kopyalanan bir kural,
 * diğeri düzeltilirken unutulur ve iki ekran aynı soruya farklı cevap verir —
 * bu depoda o hata bir kez yaşandı (bkz. app/api/mobile/_rapor/csv.ts başlığı,
 * FUEL_ENABLED ↔ EXPORT_ENABLED).
 *
 * Ayrıca yetki kapıları: kapılar rol adlarıyla YAZILI olduğu için sessizce
 * gevşetilebilirler. Burada her uç için beklenen kapı adıyla denetleniyor.
 *
 * Kullanım: npm run lint:is-emri
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oku = (p) => {
  const tam = path.join(ROOT, p);
  if (!existsSync(tam)) {
    console.error(`✗ dosya yok: ${p}`);
    process.exit(1);
  }
  return readFileSync(tam, "utf8");
};

let dusen = 0;
const kontrol = (ad, kosul, kanit) => {
  if (!kosul) {
    dusen++;
    console.log(`  ✗ ${ad}${kanit ? "  —  " + kanit : ""}`);
  }
};

const LISTE = "app/api/mobile/is-emirleri/route.ts";
const TEK = "app/api/mobile/is-emirleri/[id]/route.ts";
const PANEL = "app/actions/is-emri.ts";
const CEKIRDEK = "lib/is-emri-db.ts";
const ARIZA = "app/api/mobile/vehicles/[id]/ariza-bildir/route.ts";

const liste = oku(LISTE);
const tek = oku(TEK);
const panel = oku(PANEL);
const cekirdek = oku(CEKIRDEK);
const ariza = oku(ARIZA);

// ══ 1 · KAPILAR ═══════════════════════════════════════════════════════════
// GET yönetici/şef: kuyruk bir YÖNETİM ekranı. POST şoföre de açık: arızayı
// ilk gören direksiyondaki kişi. DELETE yalnız patron: silme geri alınamaz.
kontrol("GET requireMobileFleetView", /GET[\s\S]{0,400}?requireMobileFleetView\(/.test(liste));
kontrol("POST requireMobileWorkerScoped", /POST[\s\S]{0,400}?requireMobileWorkerScoped\(/.test(liste));
kontrol("PATCH requireMobileFleetView", /PATCH[\s\S]{0,600}?requireMobileFleetView\(/.test(tek));
kontrol("DELETE requireMobileAdmin", /DELETE[\s\S]{0,400}?requireMobileAdmin\(/.test(tek));

// ══ 2 · KURAL ÇEKİRDEKTE ══════════════════════════════════════════════════
// Uçlar ham tabloya DOKUNMAZ: `vehicle_fault_reports` adı route dosyalarında
// hiç geçmemeli, yoksa kural ikinci bir yerde doğmaya başlar.
kontrol("liste ucu ham tabloya yazmıyor", !liste.includes("vehicle_fault_reports"));
kontrol("tek emir ucu ham tabloya yazmıyor", !tek.includes("vehicle_fault_reports"));
kontrol("liste ucu çekirdekten besleniyor", /from "@\/lib\/is-emri-db"/.test(liste));
kontrol("tek emir ucu çekirdekten besleniyor", /from "@\/lib\/is-emri-db"/.test(tek));
kontrol("panel AYNI çekirdeği kullanıyor", /from "@\/lib\/is-emri-db"/.test(panel));
for (const fn of ["listIsEmirleri", "createIsEmri", "updateIsEmri", "deleteIsEmri"]) {
  kontrol(`${fn} yalnız çekirdekte tanımlı`, new RegExp(`export async function ${fn}\\b`).test(cekirdek));
}

// ══ 3 · YAZMA ANAHTARLI ═══════════════════════════════════════════════════
// `kaynak` gövdeden okunursa şoför kendi bildirimini 'elle' diye açar ve
// silinebilir hâle getirir (deleteIsEmri yalnız 'elle' siler).
kontrol("kaynak GÖVDEDEN okunmuyor", !/kaynak:\s*[^,\n}]*\bg\.[a-z]/i.test(liste));
kontrol("kaynak roldan türüyor", /kaynak:\s*izin\.kaynak/.test(liste));
kontrol("reported_by OTURUMDAN (createIsEmri actor)", /createIsEmri\([\s\S]{0,300}?worker\.id/.test(liste));
kontrol("araç kapsamı ORTAK çekirdekten", /isEmriYazmaIzni\(/.test(liste));
kontrol("ariza-bildir AYNI kapsam kuralını çağırıyor", /isEmriYazmaIzni\(/.test(ariza));
kontrol("kapsam dışı 403", /!izin\.ok\)\s*return mobileError\(403/.test(liste));

// ══ 4 · ŞOFÖR ÖNCELİK/ATAMA GÖNDEREMEZ ════════════════════════════════════
// Sessizce yok saymak, şoförün "kritik" işaretlediğini sanmasına yol açardı.
kontrol("şoförün yasaklı alanları adıyla reddediliyor", /forbidden_fields/.test(liste));
kontrol("yasaklı alan listesi oncelik+atananId", /\["oncelik",\s*"atananId"\]/.test(liste));

// ══ 5 · AÇIKLAMA DEĞİŞMEZ ═════════════════════════════════════════════════
// Kusur metni bildirildiği anki hâliyle kalır (DVIR kanıt zinciri).
kontrol("PATCH aciklama'yı 400 ile reddediyor", /g\.aciklama !== undefined[\s\S]{0,200}?immutable_field/.test(tek));
kontrol("updateIsEmri aciklama alanı TAŞIMIYOR", !/aciklama\?:/.test(cekirdek.split("export async function updateIsEmri")[1] ?? ""));

// ══ 6 · KAPANIŞ NOTU POLİTİKASI ═══════════════════════════════════════════
// Kural çekirdekte, sıkılığı yüzeyin kararı. Mobil AÇIK gönderiyor; panel
// bugünkü davranışını koruyor (notsuz kapatabiliyor) — bilinçli.
kontrol("kural çekirdekte", /kapanisNotuZorunlu/.test(cekirdek));
kontrol("mobil PATCH sıkılığı AÇIK gönderiyor", /kapanisNotuZorunlu:\s*true/.test(tek));
kontrol("panel sıkılığı GÖNDERMİYOR (davranış korunuyor)", !/kapanisNotuZorunlu/.test(panel));

// ══ 7 · YENİDEN AÇMA SERBEST (panel paritesi, Volkan 21.09.2026) ══════════
// Üç yüzey (panel · U7 · yeni uç) aynı tabloya bakıyor; biri 409 derse ikisi
// ayrışır. Bu denetim o ayrışmayı geri getirmeyi zorlaştırır.
kontrol("tek emir ucu kapalıyı 409 ile REDDETMİYOR", !/409[\s\S]{0,120}?(kapali_emir|yeniden_ac)/.test(tek));
kontrol("çekirdek yeniden açarken damgayı temizliyor", /satir\.closed_at = null/.test(cekirdek));

// ══ 8 · SİLME ═════════════════════════════════════════════════════════════
kontrol("silme kuralı çekirdekte (elle + açık)", /!== "elle"[\s\S]{0,200}?sebep: "silinemez"/.test(cekirdek));
kontrol("uç silinemezi 409 ile söylüyor", /409,\s*"silinemez"/.test(tek));

// ══ 9 · SAYFALAMA VE SÜZGEÇ ═══════════════════════════════════════════════
kontrol("ortak sayfalama sözleşmesi", /parsePage|pageInfo/.test(liste));
kontrol("geçersiz durum 400", /alan: "durum", gecerli/.test(liste));
kontrol("geçersiz öncelik 400", /alan: "oncelik", gecerli/.test(liste));
kontrol("okuma 1000 satır tavanına takılmıyor", /fetchAllRows/.test(cekirdek));

if (dusen > 0) {
  console.log(`\n✗ İŞ EMRİ UÇLARI MUHAFIZI — ${dusen} denetim düştü.\n`);
  process.exit(1);
}
console.log("✓ iş emri uçları muhafızı: tüm denetimler geçti (kapı + çekirdek + sözleşme).");
