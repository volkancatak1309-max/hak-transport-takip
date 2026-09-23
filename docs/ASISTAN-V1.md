# AI ASİSTAN v1 — salt okuma soru-cevap ucu

**Dal:** `feat/asistan-v1` · **Tarih:** 23.09.2026 · **Durum:** kod bitti,
üç kiracıda da **KAPALI** (bayrak yok) — demo'da açılması Volkan'ın env
girmesine bağlı.

---

## 1 · Ne yapıyor

`POST /api/mobile/asistan` — yönetici ve filo şefi, kendi filolarının verisi
hakkında serbest metinle soru sorar; model cevabı **yalnız salt okuma
araçlarının döndürdüğü sayılardan** kurar. Yanıt SSE ile akar.

**Yazma yok.** Dokuz aracın dokuzu da mevcut mobil uçların `GET` işleyicisidir.
Araç katmanı (`lib/asistan-araclar.ts`) `supabaseAdmin`i içe bile aktarmaz.

---

## 2 · Kararlar ve gerekçeleri

### 2.1 Araçlar ucun `GET` işleyicisini DOĞRUDAN çağırıyor (HTTP yok)

Çekirdekleri tek tek çağırıp burada yeniden şekil vermek yerine ucun kendi
işleyicisi süreç içinde çağrılıyor. Üç şeyi birden çözüyor:

| | |
|---|---|
| **Sayı ayrışmaz** | Asistanın söylediği sayı, panelin/uygulamanın gördüğü sayının ta kendisidir — ikinci bir hesap yok. |
| **Kapı doğru kalır** | Kapılar uçtan uca aynı DEĞİL (aşağıdaki tablo). İşleyiciyi çağırmak her aracın kendi kapısını da çalıştırır. |
| **Kapsam sunucudan** | Yetki `Authorization` başlığından, kapsam o kimlikten DB'de çözülür. Modelin ürettiği argüman yalnız süzgeçtir. |

Bu, bu depoda zaten kullanılan bir desendir: `scripts/verify-*.mjs`
betiklerinin hepsi route işleyicilerini böyle çağırıyor.

**Bedeli:** her araç çağrısı ucun kapısını yeniden koşturur, yani `workers`
tablosuna bir okuma daha yapar. Kabul edildi — alternatifi kapıyı bir kez
çalıştırıp kapsamı araçlara elden dağıtmaktı ve o, yetki genişlemesini kodun
içine gömmek olurdu.

### 2.2 🔴 Kapı iki kademeli — ve bu, ilk taslakta bir açıktı

İlk tasarım "uçta tek kapı: `requireMobileFleetView`" diyordu. Uçların gerçek
kapıları ölçüldüğünde bunun bir **yetki genişlemesi** olduğu görüldü:

| araç | uç | ucun KENDİ kapısı |
|---|---|---|
| `filo_panosu` | `/dashboard` | `requireMobileFleetView` |
| `is_emirleri` | `/is-emirleri` | `requireMobileFleetView` |
| `izin_takvimi` | `/leaves` | `requireMobileFleetView` |
| `mevzuat_panosu` | `/mevzuat` | `requireMobileFleetView` |
| `filo_analizi` | `/analytics` | **`requireMobileAdmin`** |
| `alarmlar` | `/alarms` | **`requireMobileAdmin`** |
| `sofor_skorlari` | `/driver-scores` | **`requireMobileAdmin`** |
| `filo_araclari` | `/vehicles` | **`requireMobileAdmin`** |
| `arac_ozeti` | `/vehicles/[id]/ozet` | **`requireMobileAdmin`** |

Yani filo şefi panelde `/admin/analiz` ve `/admin/alarmlar` ekranlarına
giremiyor. Tek kapılı bir asistan, o veriyi şefe sohbet üzerinden açardı.

**Çözüm iki kademe:**
1. Uç `requireMobileFleetView` ile korunuyor — **şoför 403** (zemin).
2. Modele verilen araç listesi role göre süzülüyor (`araclarFor`) — şef
   yönetici araçlarını hiç görmez.
3. Güvenliği sağlayan (2) değil, **ucun kendi kapısı**: şef o aracı bir şekilde
   çağırsa bile `403 admin_required` alır. Canlıda ölçüldü.

`scripts/check-asistan.mjs` her aracın `kapi` alanını **ucun GET gövdesindeki
gerçek kapıyla** karşılaştırır. Bir ucun kapısı ileride değişirse muhafız kırılır.

### 2.3 Daraltma: seçim, türetme değil

Uç yanıtları telefon için tasarlandı; modele ham hâlde vermek çok pahalı.
Araç katmanı daraltıyor ama daraltma yalnız üç işlemden ibaret: **alan seçme**,
**listeyi kesme + `kirpildi` bayrağı**, **olduğu gibi taşıma**.

🔴 **Aritmetik yok.** Dosyada tek bir `+ - * / % Math. reduce toFixed` yok ve
muhafız bunu denetliyor (yorum ve dize sabitleri sökülerek). Kesilen listelerde
toplamlar kırpılmaz — `sayfa.total` / `uyari.tur` gerçek sayı kalır.

### 2.4 Sistem istemi durağan, değişken bağlam ayrı mesajda

Prompt caching **ön ek** eşleşmesidir (`tools` → `system` → `messages`).
İsteme "bugün 23.09" yazsaydık ön ek her gün değişir, önbellek hiç tutmazdı.

Bu yüzden `lib/asistan-istem.ts` **tamamen durağandır** (muhafız orada
`new Date` / `Math.random` / `process.env` arar). "Şu an" ve "çağıranın rolü"
bilgisi `messages` sonuna eklenen `{role:"system"}` mesajında taşınıyor —
Claude Opus 5 bunu destekliyor ve o mesaj ön ekin dışında kalıyor.

**Kanıt alanı:** `kullanim` olayındaki `onbellekOkuma`
(`usage.cache_read_input_tokens`). Sıfırsa ön ek bir yerde değişiyordur.

### 2.5 Hız sınırı: yeni tablo YOK

30 soru / saat / kişi. Sayaç `login_attempts` tablosunda, `asistan:<workerId>`
anahtarıyla. Yeni migration gerekmedi.

**Çakışma yok ve bu tesadüf değil:** giriş yolu satırlarını `<ip>|<telefon>`
yazıyor ve hep `identifier LIKE '%|<kanonik telefon>'` ile arıyor. Asistan
anahtarında **boru işareti hiç yok**, dolayısıyla o kalıba asla uymaz. Canlıda
ölçüldü: "Giriş kilidini kaldır" düğmesinin kalıbı 0 asistan satırı buluyor.

**Hata = kapalı.** Sayaç okunamazsa istek reddedilir (503). `getLoginLockState`
tersini yapıyor ama orada ikinci bir hat var; burada yok — açık düşersek
maliyet tavanı tamamen kalkar ve kimse fark etmez.

**Kredi model çağrısından ÖNCE düşülür.** Sonra düşseydi iptal/hata veren her
istek bedava olurdu — yani tavan, tam da en çok gerektiği durumda (döngüye
girmiş istemci) çalışmazdı.

### 2.6 Sunucu tarafı yedekleme (server-side fallbacks) AÇILMADI

`claude-api` rehberi Opus 5 kodunda `fallbacks` parametresini varsayılan
öneriyor. **Bilerek eklenmedi:** beta bayrağı gerektiriyor ve hesapta açık
değilse **isteğin tamamı 400 döner** — yani filo sayısı soran bir uç, hiç
yaşanmayacak bir red senaryosu için tamamen ölebilirdi. Red hâli bunun yerine
`hata` olayıyla (`model_reddetti` + kategori) dürüstçe bildiriliyor.
Gerekirse ayrı bir turda açılır.

---

## 3 · Sözleşme

### İstek

```
POST /api/mobile/asistan
Authorization: Bearer <access token>
Content-Type: application/json

{
  "mesajlar": [
    { "rol": "kullanici", "metin": "Bugün sahada kaç araç var?" }
  ],
  "dil": "tr"          // opsiyonel: tr | de | en (varsayılan: kurulum dili)
}
```

- `mesajlar` **en fazla 20** (10 tur). Fazlası **sessizce kırpılmaz → 400**.
- İlk ve son mesaj `kullanici` olmak zorunda.
- Mesaj başına en fazla 4000 karakter.
- **Sohbet geçmişi sunucuda SAKLANMAZ** — her istekte istemciden gelir.
  Bedeli açık: önceki turun araç çağrıları taşınmaz, model aracı yeniden çağırır
  (yani sayı tazelenir).

### Hata kodları

| durum | kod | anlamı |
|---|---|---|
| 401 | `missing_token` · `invalid_token` · `revoked` · `inactive` | kimlik |
| 403 | `fleet_view_required` | şoför — asistan bir yönetim yüzeyidir |
| 503 | `asistan_kapali` + `sebep: "bayrak_kapali"` | bu kiracıda açık değil |
| 503 | `asistan_kapali` + `sebep: "anahtar_yok"` | `ANTHROPIC_API_KEY` girilmemiş |
| 503 | `hiz_sayaci_okunamadi` | sayaç okunamadı (fail-closed) |
| 400 | `invalid` (+`alan`) · `invalid_dil` | gövde |
| 429 | `hiz_siniri` (+`retryAfter`, `pencereBitis`) | saatlik tavan |

İki 503 sebebi **ayrıdır** ve bu sessiz eksik yasağının uygulamasıdır: biri bir
KARAR (bu kiracıda asistan açılsın mı), öteki bir KURULUM adımıdır.

Kapı sırası: **kimlik → rol → bayrak → anahtar → gövde → hız**. Bayrak ve
anahtar kimlikten sonra gelir; doğrulanmamış birine kiracının kurulum durumu
söylenmez.

### Yanıt (SSE)

```
event: basladi     data: { dil, araclar: [ad], kalanSoru }
event: metin       data: { parca }
event: arac        data: { ad, girdi }
event: arac_sonuc  data: { ad, sureMs, hata }
event: kullanim    data: { girdi, cikti, onbellekOkuma, onbellekYazma, tur }
event: bitti       data: { durdurma, tur }
event: hata        data: { kod, ... }
```

`arac_sonuc` **sonucun gövdesini taşımaz**: gövde modele gider, istemciye değil.
Taşısaydı aynı veri iki kez akar ve telefon bağlantısında ağırlığın çoğunu
kimsenin okumadığı JSON oluştururdu.

---

## 4 · 🔴 VOLKAN'A: demo Vercel'e girilecek env

Demo projesi (`galzura-demo`) → Settings → Environment Variables:

| Ad | Değer biçimi | Ortam | Not |
|---|---|---|---|
| `ASISTAN_ENABLED` | `true` | Production (+ Preview istenirse) | Düz metin, tırnaksız. `NEXT_PUBLIC_` **YOK** — sunucu tarafı. |
| `ANTHROPIC_API_KEY` | `sk-ant-api03-…` | Production (+ Preview istenirse) | **Sensitive** işaretlenmeli. Konsoldan alınan gerçek anahtar. |

**Sadece demo'ya.** HAK61 ve Sendigo projelerine **hiçbir şey eklenmez** —
ikisi de bugünkü davranışını korur ve uç 503 `asistan_kapali` döner.
`scripts/check-tenant-defaults.mjs` bu varsayılanı kayıt altına aldı
(`tenant.ASISTAN_ENABLED: false`), kayarsa `npm run verify` kırılır.

Env girildikten sonra yeniden dağıtım gerekir (env değişimi tek başına
çalışan lambdayı güncellemez).

**Kalan iş (anahtar girildikten sonra):** 10 gerçek soruyla tam tur — her
cevaptaki sayının araç sonucuyla birebir eşleştiği tablo, süre ölçümü ve
`onbellekOkuma > 0` kanıtı. O tur bu belgeye eklenecek.

---

## 5 · Doğrulama

### Muhafız — `npm run lint:asistan`

Dokuz kural: yazma aracı yok · kapı ucun kapısıyla eşleşiyor · kapsam
sunucudan · rapor/güvenlik uçları listede yok · anahtar tek yerde ve
loglanmıyor · araç katmanında aritmetik yok · istem durağan · hız sınırı
fail-closed · akış sözleşmesi.

`npm run verify` zincirine eklendi.

### Arıza enjeksiyonu — 14/14 yakalandı (23.09.2026)

| # | enjekte edilen kusur | sonuç |
|---|---|---|
| A1 | `import { GET as x, POST as y }` — yazma işleyicisi listenin 2. elemanı | 🔴 **İLK ÖLÇÜMDE KAÇTI** → muhafız düzeltildi |
| A2 | `alarmlar` aracının kapısı `filo`ya çevrildi | kırmızı |
| A3 | uç gövdeden `fleetScope` okuyor | kırmızı |
| A4 | araca rapor ucu bağlandı | kırmızı |
| A5 | `console.log(anahtar)` | kırmızı |
| A6 | araç katmanına aritmetik | kırmızı |
| A7 | sistem istemine tarih eklendi | kırmızı |
| A8 | hız sayacı fail-OPEN | kırmızı |
| A9 | hız sınırı model çağrısından sonraya alındı | kırmızı |
| A10 | `ASISTAN_ENABLED` varsayılanı `true` | kırmızı |
| A11 | fazla mesaj sessizce kırpılıyor | kırmızı |
| A12 | araç sonucu gövdesi istemciye de akıtılıyor | kırmızı |
| A13 | `kirpildi` bayrağı sabitlendi | kırmızı |
| A14 | `supabaseAdmin` araç katmanına sızdı | kırmızı |

A1'in kaçma sebebi kayıt altında: kontrol `import {` hemen ardındaki ismi
arıyordu, yazma fiili listenin ikinci elemanıydı. Artık fiil adı dosyanın
hiçbir yerinde aranmıyor.

### Canlı demo turu — `npm run verify:asistan`

```bash
# bayrak kapalı (HAK61/Sendigo provası)
ENV_FILE=.env.galzura-demo npm run verify:asistan

# bayrak açık + AÇIKÇA GEÇERSİZ yer tutucu anahtar (gövde + akış yolu)
ASISTAN_ENABLED=true ANTHROPIC_API_KEY="sk-ant-GECERSIZ-YER-TUTUCU" \
  ENV_FILE=.env.galzura-demo npm run verify:asistan
```

**Sonuç: 42 geçti · 0 düştü** (23.09.2026, galzura-demo canlı DB).

En değerli ölçüm 6. adım — her aracın döndürdüğü sayı, ucun **kendi**
yanıtındaki sayıyla birebir:

| araç | süre | ölçülen |
|---|---|---|
| `filo_panosu` | 3,2 sn | bugün km=418 · filo=30 · uyarı=10 · dtc=9 · 7g skor=57 |
| `filo_analizi` | **17,4 sn** | vardiya=455 · km=24.061 · alarm=2.831 · rölanti=186.138.940 ms |
| `alarmlar` | 0,6 sn | 399 |
| `sofor_skorlari` | 10,0 sn | ort=49 · skorlanan=23 · şoför=26 · km=24.061 |
| `filo_araclari` | 0,7 sn | 30 |
| `is_emirleri` | 0,2 sn | 0 |
| `izin_takvimi` | 0,5 sn | kadro=31 · izin=0 |
| `mevzuat_panosu` | 0,7 sn | AT_AZG · vardiyasız=22 · bayat=0 |
| `arac_ozeti` | 1,0 sn | km=**null** (ölçülemedi, 0 değil) |

⚠️ `filo_analizi` 17 saniye — asistanın en yavaş aracı. Tek soruda birkaç araç
çağrılırsa `maxDuration=300` gerçekten gerekiyor.

**Rol kapısı canlıda ölçüldü:** filo şefi dört yönetici aracını çağırdığında
dördünde de `403 admin_required`; panosunda `rolanti`/`alarm` blokları `null`
(panel paritesi) ve kapsamı `fleet=mavi` olarak **sunucudan** geldi.

### ⚠️ İki ders — ölçerek öğrenildi

**1. Demo kadrosunda filo şefi YOKTU.** İlk tur bu yüzden en değerli kontrolü
"atlandı" diye geçiyordu. "Şef yok" bir kanıt değildir: betik artık bir şoförü
geçici olarak şef yapıp turdan sonra geri alıyor.

**2. `finally` her zaman koşmaz.** Geri alma en dıştaki `finally`deydi; betik
bir kez boru hattı kapandığı için yarıda öldü ve demo'da **"Andreas Bauer"
filo şefi olarak KALDI** (elle düzeltildi, doğrulandı: `managed_fleet` dolu
kayıt sayısı 0). İki değişiklik yapıldı:
- **pencere daraltıldı** — atama ve geri alma aynı blokta, arada yalnız şef
  kontrolleri var;
- **günlük eklendi** — atama diske not ediliyor, bir sonraki tur başlangıcında
  dosya duruyorsa önce o geri alınıyor. Çöken tur kendini onarır.
  Bu kendini-onarma ayrıca **taklit edilerek doğrulandı**.

### Standart doğrulama

| adım | sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| `npm run build` | ✅ (aşağıdaki nota bakın) |
| `npm run lint` | **43 problem (28 hata, 15 uyarı)** — mevcut durumla BİREBİR aynı; asistan dosyalarında bulgu yok |
| `node scripts/check-test-filters.mjs` | tek bulgu `lib/auto-shift.ts:825` — mevcut durum, değişmedi |
| `lint:tenant-defaults` | 67 varsayılan birebir (yenisi: `ASISTAN_ENABLED=false`) |
| diğer 10 muhafız | hepsi yeşil |

⚠️ **Build notu:** bu makinede `npm run build`, Turbopack `fonts.gstatic.com`a
bağlanamadığı için düşüyor. **Mevcut duruma ait**: `git stash` ile değişiklikler
kaldırıldığında TEMİZ AĞAÇTA da aynı hatayla düşüyor (ölçüldü). Kabuktan
`curl` ve `node fetch` aynı adrese 200 alıyor, yani ağ değil Turbopack'in font
çekicisi. Build sinyalini almak için `app/layout.tsx`teki Google Font çağrısı
geçici olarak devre dışı bırakılıp derlendi: **derleme başarılı** ve
`/api/mobile/asistan` route'u üretildi (`.next/server/app/api/mobile/asistan/`
+ `app-path-routes-manifest.json`). `app/layout.tsx` sonrasında birebir geri
alındı (`git diff` boş).
