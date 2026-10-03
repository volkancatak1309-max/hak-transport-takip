#!/usr/bin/env node
/**
 * HAFTALIK AKSİYON KARTI — DİL DENETİMİ (03.10.2026, aksiyon kartı dili).
 *
 * Kusur: kart başlığı/gerekçesi kural motorunda sabit Türkçe üretilip metin olarak
 * saklanıyordu; İngilizce/Almanca kullanan yönetici kartı Türkçe görüyordu.
 * Çözüm: `lib/haftalik-metin.ts` metni saklanan yapıdan okurun dilinde kurar.
 *
 * Bu betik GERÇEK kural fonksiyonlarını (`lib/haftalik-aksiyon.ts`) ve GERÇEK sözlükleri
 * (`messages/*.json` › `haftalikMetin`) kullanır, veritabanı yok:
 *   1) dokuz kuralın HER BİRİ İngilizce ve Almancada kuruluyor (geri düşüş yok);
 *   2) kurulan metinde Türkçe kalmıyor (öznenin adı/plaka/serbest metin hariç);
 *   3) saklanan metnin dilindeki okur metni AYNEN görüyor (Türkçe kullanıcıda değişiklik yok);
 *   4) eski satır (yeni kanıt alanları yok) de kuruluyor; özne adı yoksa saklanan metne düşüyor;
 *   5) birim çevriliyor (gün → days/Tage), evrensel birim (L/100km, %, km) değişmiyor;
 *   6) çoğul kipler doğru (1 day / 3 days, seit 1 Tag / seit 3 Tagen).
 *
 * Kullanım: npm run lint:haftalik-metin
 */
import { readFileSync } from "node:fs";
import { createTranslator } from "use-intl/core";
import {
  kuralAyinEnIyisi,
  kuralBakimGecikti,
  kuralBelgeBitiyor,
  kuralIsEmriBekliyor,
  kuralSaklamaUyarisi,
  kuralSessizArac,
  kuralSkorDususu,
  kuralVardiyaKapanmadi,
  kuralYakitSapmasi,
} from "../lib/haftalik-aksiyon.ts";
import { haftalikMetni } from "../lib/haftalik-metin.ts";

const sozluk = (dil) => JSON.parse(readFileSync(new URL(`../messages/${dil}.json`, import.meta.url), "utf8"));
const cevirmen = (dil) => createTranslator({ locale: dil, messages: sozluk(dil), namespace: "haftalikMetin" });
const T = { tr: cevirmen("tr"), de: cevirmen("de"), en: cevirmen("en") };

let dusen = 0;
let gecen = 0;
const dogru = (ad, kosul, ayrinti = "") => {
  if (kosul) gecen++;
  else {
    dusen++;
    console.log(`  ✗ ${ad}${ayrinti ? `  —  ${ayrinti}` : ""}`);
  }
};

// ── örnek kartlar: GERÇEK kural fonksiyonlarından (Türkçe metin + kanıt + özne adı)
const kartlar = {
  skor_dususu: kuralSkorDususu({ workerId: "w1", ad: "Anna Berger", buHafta: 61, gecenHafta: 72, oncekiHafta: 80 }),
  yakit_sapmasi: kuralYakitSapmasi({ vehicleId: "v1", plaka: "W-GF-113", lPer100Km: 14.6, filoOrtalama: 11.4, ornekSayisi: 120 }),
  sessiz_arac: kuralSessizArac({ vehicleId: "v2", plaka: "W-GF-117", sessizSaat: 15 * 24 + 3 }),
  belge_bitiyor: kuralBelgeBitiyor({ workerId: "w2", ad: "Paul Huber", belgeTuru: "C95", kalanGun: 12, sonTarih: "2026-10-15" }),
  bakim_gecikti: kuralBakimGecikti({ vehicleId: "v3", plaka: "W-GF-120", tip: "Service A", eksen: "km", kalanKm: -650, kalanGun: null, gecti: true }),
  is_emri_bekliyor: kuralIsEmriBekliyor({ emirId: "e1", vehicleId: "v4", plaka: "W-GF-129", aciklama: "Brake pads worn", yasGun: 9, oncelikEtiketi: "normal" }),
  vardiya_kapanmadi: kuralVardiyaKapanmadi({ toplam: 100, kapanmayan: 9 }),
  ayin_en_iyisi: kuralAyinEnIyisi({ workerId: "w3", ad: "Maria Gruber", skor: 92, skorlananSayisi: 7, esik: 85, epokOncesi: false, donemBas: "2026-09-01" }),
  saklama_uyarisi: kuralSaklamaUyarisi({ satirSayisi: 1234567, enEskiGun: 400, uyariGun: 365, ulkeKodu: "AT", yasalEsikGun: null, yasalDayanak: null }),
};
for (const [kural, k] of Object.entries(kartlar)) dogru(`${kural}: kural kart üretti`, k !== null && k.kural === kural);

const girdi = (a, ek = {}) => ({
  kural: a.kural,
  kanit: { ...a.kanit, ...ek.kanit },
  baslik: a.baslik,
  gerekce: a.gerekce,
  ozneAdi: "ozneAdi" in ek ? ek.ozneAdi : (a.ozneAdi ?? null),
});

/** Kurulan metinde Türkçeye özgü harf/sözcük kalmamalı (özne adları ASCII seçildi). */
const TURKCE = /[ğşıİĞŞ]|\b(gün|saat|puan|eşik|araç|şoför|günde|gündür|kapatın|baktırın)\b/i;

// ── 1–2) her kural EN ve DE'de kuruluyor, Türkçe kalmıyor
for (const [kural, a] of Object.entries(kartlar)) {
  for (const dil of ["en", "de"]) {
    const m = haftalikMetni(girdi(a), dil, T[dil]);
    dogru(`${kural}/${dil}: kuruldu`, m.kaynak === "kuruldu", `${m.kaynak}`);
    dogru(`${kural}/${dil}: Türkçe kalmadı`, !TURKCE.test(`${m.baslik} ${m.gerekce}`), `${m.baslik} | ${m.gerekce}`);
    dogru(`${kural}/${dil}: boş değil`, m.baslik.length > 5 && m.gerekce.length > 5);
  }
}

// ── 3) aynı dildeki okur saklanan metni AYNEN görür (eski satır: metinDili yok → tr)
for (const [kural, a] of Object.entries(kartlar)) {
  const m = haftalikMetni(girdi(a), "tr", T.tr);
  dogru(`${kural}/tr: saklanan metin aynen`, m.kaynak === "saklanan" && m.baslik === a.baslik && m.gerekce === a.gerekce);
}
const deKayit = haftalikMetni(girdi(kartlar.sessiz_arac, { kanit: { metinDili: "de" } }), "de", T.de);
dogru("metinDili=de + okur de → aynen", deKayit.kaynak === "saklanan");
const deKayitTr = haftalikMetni(girdi(kartlar.sessiz_arac, { kanit: { metinDili: "de" } }), "tr", T.tr);
dogru("metinDili=de + okur tr → Türkçe kuruldu", deKayitTr.kaynak === "kuruldu" && /sinyal yok/.test(deKayitTr.baslik), deKayitTr.baslik);

// ── 4) eski satır (yeni kanıt alanları yok) + özne adı yok
const eskiYakit = girdi(kartlar.yakit_sapmasi);
delete eskiYakit.kanit.esikYuzde;
const ey = haftalikMetni(eskiYakit, "en", T.en);
dogru("eski yakıt satırı: eşik yüzdesi türetildi (25%)", ey.kaynak === "kuruldu" && /25% above/.test(ey.gerekce), ey.gerekce);
const eskiEmir = girdi(kartlar.is_emri_bekliyor);
delete eskiEmir.kanit.aciklama;
const ee = haftalikMetni(eskiEmir, "de", T.de);
dogru("eski iş emri satırı: açıklamasız cümle", ee.kaynak === "kuruldu" && /offene Arbeitsauftrag/.test(ee.gerekce), ee.gerekce);
const ozneSiz = haftalikMetni(girdi(kartlar.belge_bitiyor, { ozneAdi: null }), "en", T.en);
dogru("özne adı yok → saklanan metne düşer", ozneSiz.kaynak === "geri_dusus" && ozneSiz.baslik === kartlar.belge_bitiyor.baslik);
const bilinmeyen = haftalikMetni({ kural: "yeni_kural", kanit: {}, baslik: "B", gerekce: "G", ozneAdi: null }, "en", T.en);
dogru("tanınmayan kural → saklanan metin", bilinmeyen.kaynak === "geri_dusus" && bilinmeyen.baslik === "B");

// ── tam metin örnekleri (şablon hatasını yakalar)
const en = (k) => haftalikMetni(girdi(kartlar[k]), "en", T.en);
const de = (k) => haftalikMetni(girdi(kartlar[k]), "de", T.de);
dogru("EN sessiz araç başlığı", en("sessiz_arac").baslik === "Have the tracker in W-GF-117 checked — no signal for 15 days", en("sessiz_arac").baslik);
dogru("DE sessiz araç başlığı", de("sessiz_arac").baslik === "Lassen Sie das Gerät in W-GF-117 prüfen — seit 15 Tagen kein Signal", de("sessiz_arac").baslik);
dogru("EN yakıt gerekçesi (ondalık nokta)", en("yakit_sapmasi").gerekce.includes("14.6 L/100 km; fleet average 11.4"), en("yakit_sapmasi").gerekce);
dogru("DE yakıt gerekçesi (ondalık virgül)", de("yakit_sapmasi").gerekce.includes("14,6 l/100 km; Flottendurchschnitt 11,4"), de("yakit_sapmasi").gerekce);
dogru("EN belge tarihi biçimi", en("belge_bitiyor").gerekce.includes("October 15, 2026"), en("belge_bitiyor").gerekce);
dogru("DE belge tarihi biçimi", de("belge_bitiyor").gerekce.includes("15. Oktober 2026"), de("belge_bitiyor").gerekce);
dogru("DE büyük sayı biçimi", de("saklama_uyarisi").baslik.startsWith("1.234.567 "), de("saklama_uyarisi").baslik);
dogru("EN çıpa doğrulanmadı cümlesi", en("saklama_uyarisi").gerekce.includes("NOT YET VERIFIED"), en("saklama_uyarisi").gerekce);
dogru("EN vardiya çoğul", en("vardiya_kapanmadi").baslik.includes("9 shifts were left open"), en("vardiya_kapanmadi").baslik);

// ── 6) çoğul: 1 gün
const birGun = kuralBelgeBitiyor({ workerId: "w9", ad: "Lea Wolf", belgeTuru: "C95", kalanGun: 1, sonTarih: "2026-10-04" });
dogru("EN tekil gün", haftalikMetni(girdi(birGun), "en", T.en).baslik.endsWith("expires in 1 day"), haftalikMetni(girdi(birGun), "en", T.en).baslik);
dogru("DE tekil gün", haftalikMetni(girdi(birGun), "de", T.de).baslik.endsWith("läuft in 1 Tag ab"), haftalikMetni(girdi(birGun), "de", T.de).baslik);

// ── 5) birimler
dogru("birim gün → days", en("belge_bitiyor").birim === "days");
dogru("birim saat → Stunden", de("sessiz_arac").birim === "Stunden");
dogru("birim puan → points", en("skor_dususu").birim === "points");
dogru("birim L/100km aynen", en("yakit_sapmasi").birim === "L/100km");
dogru("birim % aynen", de("vardiya_kapanmadi").birim === "%");
dogru("Türkçe okurda birim gün kalır", haftalikMetni(girdi(kartlar.belge_bitiyor), "tr", T.tr).birim === "gün");

if (dusen > 0) {
  console.log(`\n✗ HAFTALIK KART DİLİ — ${dusen} denetim düştü (${gecen} geçti).\n`);
  process.exit(1);
}
console.log(`✓ haftalık kart dili: ${gecen} denetim geçti (9 kural × EN/DE kuruluyor, TR okurda metin aynen).`);
