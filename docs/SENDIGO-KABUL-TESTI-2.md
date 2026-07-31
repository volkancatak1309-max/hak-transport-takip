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
| K3 | Paket kalemleri panoda duruyor | 🔴 **KAPANMADI** | Kalemler hâlâ görünür — **kod doğru, `NEXT_PUBLIC_PACKAGES_ENABLED` bu dağıtımda `false` değil** (kanıt aşağıda) |
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

## K3 — Paket kalemleri 🔴 KAPANMADI (kod değil, ENV)

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
