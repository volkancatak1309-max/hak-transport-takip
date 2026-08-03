# Sendigo kabul testi — 2. tur

**Tarih:** 31.07.2026, 21:45–22:00 (Viyana)
**Adres:** https://sendigo-delta.vercel.app
**Test edilen sürüm:** `7ed6885` (dpl_Hi6B2AABsRYSprHnox33oeA421W6)
**Kapsam:** 1. turda bulunan 8 kusurun tek tek doğrulanması + 11 sayfa turu +
iki tema + mobil (390 px)

**Sonuç: 7 kusur kapandı, 1 kusur (K3) kapanmadı — sebebi kod değil ENV.**
Ayrıca 1 yeni bulgu (konsol hidrasyon hatası, 2 sayfada).

> Bu turda hiçbir düzeltme yapılmadı, yalnız ölçüm. HAK61'e dokunulmadı.

---

## Özet tablo

| # | Kusur | Durum | Tek cümlelik kanıt |
|---|---|---|---|
| K1 | PDF künyesinde HAK61'in adı/adresi/UID'si | 🟢 **KAPANDI** | Üretilen AZG PDF'inde `Sendigo GmbH · Bildgasse 10 · FN 681377a`, HAK61 izi **sıfır**; dosya adı `SEN_AZG_…` |
| K2 | HAK61'in cihaz eşiği kaydı Sendigo DB'sinde | 🟢 **KAPANDI** | `/admin/alarmlar`'da "Seit den neuen Schwellen" yok, filtre `7 Tage` |
| K3 | Paket kalemleri panoda duruyor | 🔴 **KAPANMADI** | Kalemler hâlâ görünür — ⚠️ *bu turdaki "env eksik" teşhisi 03.08'de YANLIŞ çıktı; gerçek sebep `lib/tenant.ts`'te dinamik `process.env[name]`, bkz. sondaki **EK — 3. tur*** |
| K4 | İzin takvimi Almanca arayüzde Türkçe | 🟢 **KAPANDI** | Lejant: `Urlaub · Krankenstand · Pflegefreistellung · Unbezahlter Urlaub · Eheschließung` |
| K5 | Tek filoda ikinci filo çipi | 🟢 **KAPANDI** | Araçlar sayfasında yalnız `Flotte 0`; `Bordo-Flotte` yok |
| K6 | Kenar çubuğu logosu okunmuyor | 🟢 **KAPANDI** | Logo 39×38 → **60×59 px**, "SENDIGO" okunuyor |
| K7 | Türkçe sabit metinler | 🟢 **KAPANDI** | `Befehlspalette` · `Zeilendichte` · `Komfortabel` / `Kompakt`; JS paketinde sabit Türkçe kalmadı |
| K8 | "0Std 00Min" + Bölgeler alt başlığı | 🟢 **KAPANDI** | `0 Std 00 Min`; alt başlıkta Depot açıklaması var |

---

## K1 — PDF künyesi 🟢 KAPANDI

`/admin` → AZG → **Bericht erstellen** ile gerçek PDF üretildi ve metin katmanı
pdf.js ile okundu.

**İndirilen dosya adı:** `SEN_AZG_2026-07.pdf`
*(1. turda `HAK_AZG_2026-07.pdf` idi.)*

**Antet — PDF'in ilk satırları, birebir:**

```
SEN
Sendigo GmbH
Bildgasse 10, 6850 Dornbirn, Österreich
FN 681377a (Landesgericht Feldkirch)
Geschäftsführer: Gökhan Kalkanlı
AZG-Prüfbericht 2026-07
Erstellt am: 31.7.2026, 21:48:27
```

**Arama sonucu (3 sayfalık PDF'in tamamında):**

| Aranan | Beklenen | Bulundu |
|---|---|---|
| `Sendigo GmbH` | VAR | ✅ VAR |
| `Bildgasse` | VAR | ✅ VAR |
| `681377a` | VAR | ✅ VAR |
| `Kalkanlı` | VAR | ✅ VAR |
| `SEN` (amblem) | VAR | ✅ VAR |
| `HAK61` | YOK | ✅ yok |
| `ATU79519228` | YOK | ✅ yok |
| `Josef-Ganahl` | YOK | ✅ yok |
| `HAK` (amblem) | YOK | ✅ yok |

### Diğer 4 PDF — SINANAMADI (veri yok)

| PDF | Durum |
|---|---|
| AZG | ✅ üretildi ve doğrulandı |
| Vardiya (Schichtbericht) | ⬜ **PDF düğmesi pasif** — 0 vardiya |
| Personel PDF'i | ⬜ **düğme pasif** — 0 vardiya |
| Yakıt (Kraftstoffbericht) | ⬜ sayfada dışa aktarım düğmesi hiç yok — 0 araç/telemetri |
| CO₂ · Fahrerleistung | ⬜ aynı sebep |

Beşi de aynı `lib/report-de.ts` modülünden `COMPANY` / `BRAND_MARK` /
`FILE_PREFIX_*` okuyor ve dosya adı önekleri aynı commit'te bağlandı; AZG'nin
doğru çıkması modül çözümlemesinin doğru olduğunu gösterir. **Ama bu dördü
canlıda üretilmedi** — araç/şoför/vardiya girildikten sonra tekrar bakılmalı.

### Not: istemci paketinde her iki firmanın dizeleri de var

Paket taraması `ATU79519228` ve `Bildgasse`'yi **birlikte** buluyor. Bu bir
kusur değil: HAK61 değerleri koddaki **yedek** (`|| "HAK61 GmbH"`) literalleri,
Sendigo değerleri env'den gömülenler. Hangisinin kazandığını yalnız üretilen
belge söyler — ve belge Sendigo'yu basıyor.

---

## K2 — HAK61 cihaz kaydı 🟢 KAPANDI

`/admin/alarmlar` sayfasında:

- Sayfa metninde `Schwellen` geçmiyor (regex taraması: eşleşme yok)
- Tarih filtresi artık **`7 Tage`** (1. turda `Seit den neuen Schwellen` idi)

Volkan `db/install/sendigo-fix-033-hak61-epoch.sql` betiğini çalıştırdı ve
`kalan_kayit=0` bildirdi; arayüz bunu doğruluyor. Kaynak tarafı da düzeltildi —
`db/install/sendigo-full.sql` artık o satırı hiç yazmıyor.

---

## K3 — Paket kalemleri 🔴 KAPANMADI (~~kod değil, ENV~~ → ENV değil, KOD)

> ⚠️ **Bu bölümün teşhisi 03.08.2026'da çürütüldü.** Aşağıdaki 3 kanıttan
> 3.'sü (`NEXT_PUBLIC_FLEETS` çalışıyor → env mekanizması sağlam) geçersiz:
> FLEETS **statik**, bayraklar **dinamik** okunuyor — aynı mekanizma değiller.
> Doğru teşhis için sondaki **EK — 3. tur** bölümüne bak. Bölüm, nasıl yanlış
> sonuca varıldığının kaydı olarak silinmeden bırakıldı.

**Hâlâ görünen kalemler:**

| Yer | Metin |
|---|---|
| Üst şerit | `HEUTE ZU LIEFERNDE PAKETE` |
| Heutiger Betriebsüberblick | `Geladen` · `Zugestellt` · `Nicht zugestellt` |
| Personel detayı özet şeridi | `Pakete` (4. kutu) |
| Sayfa başlığı balonu | "…wie viele **Pakete**, was ist dringend." |

### Bu bir kod kusuru DEĞİL — ölçüldü

Üç bağımsız kanıt, aynı dağıtımda:

1. **Yeni kod canlıda.** K5 (filo çipi) ve K7 (Almanca `Zeilendichte`)
   düzeltmeleri **aynı commit'ten** ve ikisi de çalışıyor. Vercel derlemesi
   atomiktir — `AdminClient.tsx` ve `WorkerDetailClient.tsx` de yeni sürümdür.

2. **Yeni kodun kendisi bayrağı `true` okuduğunu gösteriyor.** Personel detayı
   özet şeridinin ızgara sınıfı ölçüldü:
   ```
   glass-panel mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[16px] sm:grid-cols-4
   ```
   Yeni kod `stats.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"` yazıyor.
   `sm:grid-cols-4` seçilmiş → dizide 4 kutu var → `PACKAGES_ENABLED === true`.
   Eski kodda bu ternary hiç yoktu; yani hem yeni kod çalışıyor **hem** bayrak
   `true`.

3. **Env mekanizmasının kendisi çalışıyor.** `NEXT_PUBLIC_FLEETS=mavi` etkisini
   gösteriyor (K5 kapandı). Yani sorun "NEXT_PUBLIC env'ler okunmuyor" değil,
   **bu tek değişkene** özgü.

### Yarın yapılacak (düzeltme YAPILMADI)

Vercel → `sendigo` projesi → Settings → Environment Variables:

```
NEXT_PUBLIC_PACKAGES_ENABLED=false
```

satırının **var olduğunu**, değerinin `false` yazdığını ve **Production +
Preview + Development** üçünde de işaretli olduğunu doğrula; sonra **Redeploy**.
(Env build anında gömülür, kaydetmek yetmez.) `envBool` yalnız
`false`/`0`/`no` değerlerini false sayar — boş bırakılmış ya da silinmişse
varsayılan `true`'dur.

Aynı gözle şunlar da kontrol edilmeli (aynı anda kaybolmuş olabilirler):
`NEXT_PUBLIC_LENKZEIT_WARNING_ENABLED=false` ·
`NEXT_PUBLIC_SAFETY_SCORE_CALIBRATED=false` · `NEXT_PUBLIC_DRIVER_PANEL_ENABLED=false`.
*(Şoför paneli için dolaylı kanıt var: `/panel` hâlâ `/admin`'e yönleniyor,
yani o bayrak yerinde.)*

---

## K4 — İzin takvimi 🟢 KAPANDI

`/admin/izinler` lejantı, Almanca arayüzde artık Almanca:

```
U  Urlaub          K  Krankenstand      P  Pflegefreistellung
UB Unbezahlter Urlaub                   H  Eheschließung
```

1. turda: `Yıllık izin · Raporlu / hasta · Hasta yakını bakımı · Ücretsiz izin ·
Düğün / evlilik`.

---

## K5 — Filo çipi 🟢 KAPANDI

`/admin/araclar` çip satırı: `Alle 0` · `Kein Signal 0` · `Störung 0` ·
`Ohne Fahrer 0` · **`Flotte 0`** — `Bordo-Flotte` çipi **yok**.

---

## K6 — Logo 🟢 KAPANDI

Kenar çubuğu logosu **60×59 px** (1. turda 39×38). Ekran görüntüsünde
amblemin içindeki "SENDIGO" yazısı okunuyor. HAK61 tarafında ölçek çarpanı
tam olarak 1 kalıyor (116×38 değişmedi) — bu, aynı commit'te ölçülerek
doğrulandı.

---

## K7 — Türkçe sabit metinler 🟢 KAPANDI

| Yer | 1. tur | 2. tur |
|---|---|---|
| Komut paleti başlığı | `Komut paleti` | `Befehlspalette` |
| Komut paleti açıklaması | `Araç, sayfa veya eylem ara` | `Fahrzeug, Seite oder Aktion suchen` |
| Yoğunluk grubu | `Satır yoğunluğu` | `Zeilendichte` |
| Yoğunluk düğmeleri | `Rahat` / `Sıkı` | `Komfortabel` / `Kompakt` |

Ayrıca canlı JS paketi tarandı: `Satır yoğunluğu` ve `Komut paleti` dizeleri
**hiçbir chunk'ta kalmadı**.

---

## K8 — Biçim ve metin 🟢 KAPANDI

- `/admin/workers` → `Std. (Monat)` sütunu: **`0 Std 00 Min`** (öncesi `0Std 00Min`)
- `/admin/bolgeler` alt başlığı:
  > "Geografische Zonen: Sperr- und Pflichtbereiche sowie das Depot — der
  > Depot-Bereich steuert den automatischen Schichtbeginn und das Schichtende."

---

## Yeni bulgu — 🟠 Y1: konsolda hidrasyon hatası (2 sayfada)

**React #418** — *"Hydration failed because the server rendered HTML didn't
match the client."* Üretim derlemesi küçültülmüş olduğu için hatanın hangi
düğümde olduğu okunamıyor.

**Sayfa haritası (her biri ayrı tam sayfa yüklemesiyle ölçüldü):**

| Sayfa | Konsol |
|---|---|
| `/admin` | 🟠 1 hata |
| `/admin/workers/[id]` | 🟠 1 hata |
| `/admin/workers` | ✅ temiz |
| `/admin/araclar` | ✅ temiz |
| `/admin/alarmlar` | ✅ temiz |
| `/admin/analiz` | ✅ temiz |
| `/admin/raporlar` | ✅ temiz |
| `/admin/bolgeler` | ✅ temiz |
| `/admin/seferler` | ✅ temiz |
| `/admin/telegram` | ✅ temiz |
| `/admin/harita` | ✅ temiz (yalnız maplibre `circle-11` uyarısı — 1. turda da vardı) |

**Bilinenler:**

- 1. turda bu hata **yoktu** (tüm oturumda 0 hata) → bu sürümle geldi.
- Hata veren iki sayfa, bu sürümde **değiştirilen** iki dosyaya karşılık geliyor:
  `app/admin/AdminClient.tsx` ve `app/admin/workers/[id]/WorkerDetailClient.tsx`.
  Üçüncü değiştirilen sayfa dosyası (`AraclarClient.tsx`) **temiz** — yani
  "değiştirilen her sayfa" değil.
- **Görsel sonuç doğru:** React istemci tarafında yeniden çiziyor; iki sayfada da
  içerik, sayılar ve düzen beklendiği gibi. Çökme yok, boş ekran yok.
- Tema hipotezi **elendi**: `localStorage.theme` silinip tekrar konularak sınandı;
  hata temadan bağımsız olarak yalnız bu iki sayfada çıkıyor.

**Localize edilemedi.** Küçültülmüş üretim derlemesinde hatalı düğüm görünmüyor;
kesin teşhis için `npm run dev` ile yerel bir tekrar üretim gerekiyor.

**Önem:** orta. Kullanıcı bir şey görmüyor (sayfa doğru render oluyor), ama
hidrasyon uyuşmazlığı o alt ağacın istemcide baştan çizilmesine yol açar ve
ileride gerçek bir görsel hataya dönüşebilir.

---

## Sayfa turu — 11 sayfa

Hepsi **HTTP 200**, çökme yok, boş ekran yok.

| Sayfa | Durum | Not |
|---|---|---|
| `/admin` | ✅ | Boş durumlar düzgün; K3 kalemleri duruyor; Y1 hatası |
| `/admin/harita` | ✅ | "Derzeit keine aktive Schicht"; maplibre uyarısı |
| `/admin/araclar` | ✅ | "Noch keine Fahrzeuge"; tek filo çipi |
| `/admin/alarmlar` | ✅ | "Keine Ereignisse in diesem Zeitraum" |
| `/admin/analiz` | ✅ | Tüm bloklar boş-durum metniyle; `€ 0,00` |
| `/admin/raporlar` | ✅ | 9 rapor kartı, hepsi 0 sayacıyla |
| `/admin/bolgeler` | ✅ | "Noch keine Zonen definiert" |
| `/admin/seferler` | ✅ | "Noch keine Aufträge zugewiesen" |
| `/admin/workers` | ✅ | 1 kayıt (Volkan, VERWALTUNG); test şoförü gizli |
| `/admin/izinler` | ✅ | Lejant Almanca; "Keine Mitarbeiter" |
| `/admin/telegram` | ✅ | "Webhook nicht konfiguriert (Token oder Secret fehlt)" |

**Sunucu HTML taraması (11 sayfa):** Türkçe sızıntı **yok**, `NaN` /
`undefined` / `[object Object]` **yok**.

**Kurulum modu kontrolleri:** `/panel` → **307 → `/admin`** (şoför paneli
kapalı ✅) · arayüz **Almanca** (tarayıcı `en-US`, saat dilimi
`Europe/Istanbul` olmasına rağmen) ✅ · üst çubuktaki saat **Viyana** saatini
gösteriyor (`21:53`, tarayıcı `22:53`) ✅ · menüde Yakıt/Masraf/Bakım yok ✅

---

## Tema ve mobil

| Kontrol | Sonuç |
|---|---|
| Koyu tema | ✅ Düzgün |
| Açık tema | ✅ Düzgün (koyu kenar çubuğu bilinçli tasarım, metin kontrastı sağlam) |
| Mobil 390 px | ✅ Sayfa **yatay taşmıyor** (`scrollWidth = clientWidth = 375`) |
| Mobil kırpılan öğe | 1 adet — roster çip şeridi, `overflow-x: auto` ile **bilinçli kaydırmalı**, kusur değil |

---

## Yarın için yapılacaklar listesi

1. **K3 → env düzeltmesi.** Vercel'de `NEXT_PUBLIC_PACKAGES_ENABLED=false`
   satırını doğrula/ekle, üç ortamda da işaretle, **Redeploy**. Yanında
   `LENKZEIT_WARNING` ve `SAFETY_SCORE_CALIBRATED` bayraklarını da gözden geçir.
2. **Y1 → yerel teşhis.** `npm run dev` ile `/admin` ve `/admin/workers/[id]`
   açılıp React'in ayrıntılı hidrasyon uyarısı okunmalı (üretimde okunamıyor).
3. **Kalan 4 PDF.** Araç/şoför/vardiya girildikten sonra Vardiya, Personel,
   Yakıt ve Fahrerleistung PDF'lerinin anteti tekrar kontrol edilmeli.

---
---

# EK — 3. tur doğrulama (03.08.2026)

**Tarih:** 03.08.2026, 13:28–13:35 (Viyana)
**Test edilen dağıtım:** `dpl_G8FKbv8eBsY4VrM9Un5tnm4vrCNP` *(2. turdaki
`dpl_Hi6B2AABsRYSprHnox33oeA421W6` değil — yani araya bir **redeploy girdi**)*
**Kapsam:** yalnız ölçüm. Hiçbir kod değiştirilmedi.

**Sonuç:**
- **K3 hâlâ açık** — ama 2. turun teşhisi **YANLIŞTI**. Sorun env'in eksik
  olması değil; **`lib/tenant.ts`'te bir kod kusuru**. Env doğru girilmiş ve
  sunucu onu doğru okuyor.
- **Y1 (React #418) artık YOK.** 12 sayfa gezildi, hidrasyon hatası sıfır.

---

## Kök neden — `process.env[name]` istemcide gömülmüyor

`lib/tenant.ts:30`:

```ts
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();   // ← DİNAMİK İNDEKS
  ...
}
```

Next.js istemci paketine **yalnız statik** `process.env.NEXT_PUBLIC_X`
erişimlerinin değerini gömer. `process.env[name]` **hesaplanmış** bir erişimdir;
derleyici hangi anahtarın okunacağını bilemez, dolayısıyla değiştirmez.
Tarayıcıda `process.env` bu anahtarları içermez → `raw` `undefined` →
**fonksiyon varsayılana düşer**. Sunucuda ise gerçek `process.env` çalışma
anında okunur ve **doğru** değeri verir.

Yani tek dağıtımda **sunucu `false`, istemci `true`** okuyor.

### Kanıt A — canlı JS paketinden birebir alıntı

`01f~i.u6z6e7w.js?dpl=dpl_G8FKbv8eBsY4VrM9Un5tnm4vrCNP`:

```js
function r(e,r){let n=t.default.env[e]?.trim().toLowerCase();...}
let a=r("NEXT_PUBLIC_FUEL_ENABLED",!1),
    i=r("NEXT_PUBLIC_EXPENSE_ENABLED",!1);
    r("NEXT_PUBLIC_MAINTENANCE_ENABLED",!1);
let s=r("NEXT_PUBLIC_LEAVES_ENABLED",!0),
    l=r("NEXT_PUBLIC_DRIVER_PANEL_ENABLED",!0),
    o=r("NEXT_PUBLIC_PACKAGES_ENABLED",!0),      // ← değer YOK, yalnız AD + varsayılan
    u=r("NEXT_PUBLIC_LENKZEIT_WARNING_ENABLED",!0),
    c=r("NEXT_PUBLIC_SAFETY_SCORE_CALIBRATED",!0),
    d={bordo:t.default.env.NEXT_PUBLIC_FLEET_BORDO_LABEL?.trim()||"",
       mavi:"Flotte".trim()||""},                 // ← STATİK erişim: değer GÖMÜLMÜŞ
    f=(()=>{let e="mavi".trim(); ... })();        // ← NEXT_PUBLIC_FLEETS: GÖMÜLMÜŞ
```

Aynı satırlarda iki davranış yan yana duruyor: **env adı dize olarak kalanlar**
(bayraklar) gömülmedi, **statik okunan** filo değerleri (`"Flotte"`, `"mavi"`)
gömüldü.

**Bu, 2. turun 3. kanıtını da düzeltiyor.** "`NEXT_PUBLIC_FLEETS` çalışıyor,
demek ki env mekanizması sağlam" çıkarımı geçersizdi: FLEETS statik okunuyor,
bayraklar dinamik. İkisi aynı mekanizma değil.

### Kanıt B — sunucu doğru, istemci yanlış (aynı sayfa, aynı istek)

`/admin/workers/[id]` — tarayıcının aldığı **HTML belgesi** ile hidrasyon
sonrası **DOM** karşılaştırıldı:

| Ölçüm | Sunucudan gelen HTML | Tarayıcıdaki DOM |
|---|---|---|
| Özet şeridi ızgarası | `sm:grid-cols-3` (1 kez) | `sm:grid-cols-4` |
| `sm:grid-cols-4` | **0 kez** | var |
| Kutular | 3 | 4 → `0 SCHICHTEN · 00:00:00 STUNDEN · 0 KILOMETER · **0 PAKETE**` |

`/admin` — sunucu HTML'inde paket kalemleri **hiç yok** (dize sayımı; sözlük
içindeki çeviri kayıtları hariç tutuldu):

| Dize | Sunucu HTML'i | DOM |
|---|---|---|
| `Fahrzeuge ohne Signal` (kontrol kalemi) | 2 kez → **1'i render edilmiş** | var |
| `Heute zu liefernde Pakete` | 1 kez → **yalnız sözlükte, render YOK** | var |
| `Geladen` | 1 kez → yalnız sözlükte | var |

Yani sunucu bayrağı `false` okuyup kalemleri **düşürüyor**; istemci `true`
okuyup **geri koyuyor**.

---

## K3'ün 4 yüzeyi — tek tek

| # | Yüzey | Durum | Kanıt |
|---|---|---|---|
| 1 | **Pano kalemleri** | 🔴 **KALDI** | Üst şerit `HEUTE ZU LIEFERNDE PAKETE`; Betriebsüberblick `Geladen · Zugestellt · Nicht zugestellt`; başlık balonu hâlâ "…wie viele **Pakete**…" (`page_dashboard`, `page_dashboard_nopkg` değil); personel detayında 4. kutu `0 PAKETE` |
| 2 | **Kapanış formu** | 🔴 **KALDI — üstelik iki ayrı kusur** | (a) **Şoför kapanış formu** `app/panel/PanelClient.tsx` `PACKAGES_ENABLED`'ı **hiç kontrol etmiyor** — bayrak doğru çalışsa bile alanlar kalkmazdı; kodda uygulanmamış. Sendigo'da pratik etkisi yok: `/panel` → **307 `/admin`** (ölçüldü). (b) **Yönetici düzenleme dialogu** (`AdminClient.tsx:1083`) kodu doğru ama istemci bayrağı `true` → `PAKETE` alan grubu görünür kalır. Canlıda açılamadı: **0 vardiya** var |
| 3 | **Tablo kolonları** | 🟠 **ÖLÇÜLEMEDİ — mekanizma gereği kalır** | Arşiv katlaması açıldı: `0 Einträge`, DataTable boş-durum basıyor, hiç `<th>` yok. Kolonlar (`AdminClient.tsx:516`) ve Excel başlıkları (`:335`) aynı istemci bayrağından besleniyor → `true` olduğu sürece kalırlar. Excel/PDF düğmeleri 0 kayıtta **pasif** |
| 4 | **PDF sütunları** | 🟠 **ÖLÇÜLEMEDİ — mekanizma gereği kalır** | `components/pdf/ShiftReport.tsx` `"use client"` — PDF **tarayıcıda** üretiliyor, yani istemci bayrağını kullanır. 0 vardiya olduğu için üretilemedi |

**Özet: 4 yüzeyin hiçbiri kapanmadı.** 1 ve 2 doğrudan ölçüldü; 3 ve 4 veri
yokluğundan ölçülemedi ama ikisi de aynı istemci bayrağını okuyor.

---

## Yan hasar — aynı kusur 3 bayrağı daha varsayılanda tutuyor

İstemcide **her** `envBool` çağrısı varsayılana düşüyor. Etkisi olanlar:

| Bayrak | Sendigo'da olması gereken | İstemcide fiilen |
|---|---|---|
| `NEXT_PUBLIC_PACKAGES_ENABLED` | `false` | 🔴 `true` |
| `NEXT_PUBLIC_DRIVER_PANEL_ENABLED` | `false` | 🔴 `true` *(rota sunucuda korunuyor: `/panel` 307 ✅)* |
| `NEXT_PUBLIC_LENKZEIT_WARNING_ENABLED` | `false` | 🔴 `true` |
| `NEXT_PUBLIC_SAFETY_SCORE_CALIBRATED` | `false` | 🔴 `true` |

Etkisi olmayanlar (varsayılanı zaten istenen değer): `FUEL` · `EXPENSE` ·
`MAINTENANCE` (üçü de `false`) · `LEAVES` (`true`).

⚠️ `scripts/check-tenant-defaults.mjs` bunu **yakalayamaz**: muhafız Node'da
çalışır, orada `process.env[name]` sorunsuz okunur. Kusur yalnız tarayıcı
paketinde doğuyor.

---

## Y1 — hidrasyon hatası ARTIK YOK ✅

12 sayfa, her biri ayrı tam yükleme, `console` + `pageerror` dinleyicisiyle
(dinleyici sağlaması yapıldı: enjekte edilen test hatası yakalandı):

| Sayfa | Konsol |
|---|---|
| `/admin` | ✅ temiz |
| `/admin/workers/[id]` | ✅ temiz |
| `/admin/workers` · `/admin/araclar` · `/admin/alarmlar` · `/admin/analiz` · `/admin/raporlar` · `/admin/bolgeler` · `/admin/seferler` · `/admin/izinler` · `/admin/telegram` | ✅ temiz |
| `/admin/harita` | 🟡 yalnız maplibre `circle-11` uyarısı (1. ve 2. turda da vardı) |

**Not — kapanmamış bir soru:** sunucu 3 kutu, istemci 4 kutu basmasına rağmen
React hata vermiyor. Yani K3'ün altındaki uyuşmazlık duruyor, React'in
şikâyeti susmuş. K3 düzeltilince bu soru kendiliğinden kapanır; ayrıca
kovalamaya değmez.

---

## Yapılacaklar — güncellenmiş

1. **K3 → kod düzeltmesi (env DEĞİL).** `lib/tenant.ts`'teki `envBool` /
   `envEnum` dinamik `process.env[name]` erişimini bırakmalı; her
   `NEXT_PUBLIC_` değişken **statik** okunmalı, örneğin adları değil
   **değerleri** taşıyan bir sabit haritadan:
   ```ts
   const RAW = {
     PACKAGES: process.env.NEXT_PUBLIC_PACKAGES_ENABLED,   // statik → gömülür
     ...
   } as const;
   ```
   Sonra `envBool(RAW.PACKAGES, true)`. Dört bayrak da (PACKAGES,
   DRIVER_PANEL, LENKZEIT_WARNING, SAFETY_SCORE_CALIBRATED) aynı anda düzelir.
2. **Muhafıza istemci kuralı ekle.** `check-tenant-defaults.mjs` bu sınıfı
   göremiyor; `lib/tenant.ts` içinde `process.env[` deseni yasaklanmalı.
3. **Şoför kapanış formu.** `app/panel/PanelClient.tsx` `PACKAGES_ENABLED`'ı
   hiç kontrol etmiyor — bayrak düzelse bile paket alanları kalkmaz.
4. **Kalan 4 PDF + tablo kolonları.** Araç/şoför/vardiya girildikten sonra
   ölçülmeli (2. turdan devreden madde; hâlâ 0 vardiya).
