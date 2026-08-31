# Zamanlayıcı (cron) kayıtları — GERÇEK DURUM

> Son ölçüm: **25.08.2026**. Bu dosya, dış zamanlayıcıya (cron-job.org /
> GitHub Actions / Vercel Cron) girilecek işlerin **tek kaynağıdır**.
> Kurulum belgeleri (`SENDIGO-KURULUM.md`, `GALZURA-KURULUM.md`,
> `YENI-MUSTERI-KURULUM.md`) buraya işaret eder — liste üç yerde
> tekrarlandığı için bir kez bayatladı ve silinmiş bir ucu aylarca
> anlatmaya devam etti.

Her kiracının **kendi dağıtımı ve kendi veritabanı** var (bkz. `lib/brand.ts`).
Yani bu kayıtlar **her kiracı için ayrı ayrı** kurulur; sırlar da o kiracının
Vercel projesinden alınır.

---

## Özet tablo

| # | İş | URL | Sır | Sıklık | Hangi kiracı |
|---|----|-----|-----|--------|--------------|
| 1 | flespi senkronu | `/api/flespi/sync` | `FLESPI_SYNC_SECRET` | **30–60 sn** | Cihazı olan her kiracı |
| 2 | Yakıt fiyatı | `/api/cron/fuel-price-sync` | `CRON_SECRET` | **günde 1 · 06:00** | Yakıt maliyeti isteyen her kiracı (migration 077) |
| 3 | Belge uyarısı | `/api/cron/document-alerts` | `CRON_SECRET` | **günde TAM 1 · 06:00** | Belge takibi açık kiracı (migration 078 — bugün yalnız HAK61) |
| 4 | Demo telemetri temizliği | `/api/cron/demo-retention` | `CRON_SECRET` | günde 1 · gece | **YALNIZ galzura-demo** |
| 5 | Periyodik bakım uyarısı | `/api/cron/bakim-alerts` | `CRON_SECRET` | **günde TAM 1 · 06:15** | Bakım planı kuran her kiracı (migration 081) |
| 6 | Haftalık aksiyon | `/api/cron/haftalik-aksiyon` | `CRON_SECRET` | **haftada TAM 1 · Pazartesi 06:30** | Haftalık panel isteyen her kiracı (migration 084) |
| 7 | Mevzuat erken uyarı | `/api/cron/mevzuat-tarama` | `CRON_SECRET` | **15 dakika** | Canlı mevzuat katmanı isteyen her kiracı (migration 086) |
| 8 | Dönem skoru + rozet | `/api/cron/skor-donem` | `CRON_SECRET` | **haftada 1** | Ödül/liderlik isteyen her kiracı (migration 088) |
| 9 | **Saklama UYARISI** (silmez) | `/api/cron/saklama` | `CRON_SECRET` | **günde 1 · gece 03:00** | Saklama katmanı kuran her kiracı (migration 090) |
| 10 | **Aylık metrik** (kapanmış ay özeti) | `/api/cron/aylik-metrik` | `CRON_SECRET` | **günde 1 · gece 03:30** | CO₂/yakıt aylık trendi isteyen her kiracı (migration 090) |
| ~~9~~ | ~~Vardiya bekçisi~~ | ~~`/api/cron/shift-watchdog`~~ | — | — | **KALDIRILDI — kaydı SİL** |

Sır iki biçimde de kabul edilir ve karşılaştırma zamanlama-güvenlidir
(`safeEqual`):

```
GET https://<alan-adı>/<yol>?secret=<SIR>
GET https://<alan-adı>/<yol>          + Authorization: Bearer <SIR>
```

`?secret=` dış zamanlayıcılar için, `Bearer` Vercel Cron için pratiktir
(Vercel başlığı kendisi ekler). `POST` da aynı gövdeyi çalıştırır.

> **Sır tanımsızsa uç KAPALIDIR (fail-closed) ve 401 döner.** Env'i unutmak
> "herkese açık" anlamına gelemez — ama zamanlayıcıda da sessiz bir 401
> demektir. Kaydı kurduktan sonra **ilk çağrının 200 döndüğünü doğrula.**

---

## 1 · flespi senkronu — DOKUNMA

```
GET https://<alan-adı>/api/flespi/sync?secret=<FLESPI_SYNC_SECRET>     — her 30–60 sn
```

| Kod | Anlamı |
|-----|--------|
| 200 | Tur tamam (gövdede araç/satır sayısı) |
| 401 | Sır yanlış ya da `FLESPI_SYNC_SECRET` tanımsız |
| 500 | Tur sırasında hata — gövdede sebep |

Motor **yalnız kendi veritabanındaki** `flespi_device_id` dolu araçları çeker;
kiracılar arası sızıntı yapısal olarak imkânsızdır. Bu kayıt atlanırsa
`device_telemetry` boş kalır — Sendigo'da bir kez tam olarak bu oldu.

## 2 · Yakıt fiyatı senkronu

```
GET https://<alan-adı>/api/cron/fuel-price-sync?secret=<CRON_SECRET>   — günde 1, 06:00
```

AB Weekly Oil Bulletin'den ülke dizel fiyatını çeker (`fuel_price_reference`).
Kaynak **haftalık** yayınlanır ama iş **günlük** koşar: yayın saati garanti
değil ve kaçan bir haftayı 7 gün sonra fark etmek istemiyoruz. Yazma
idempotenttir, aynı satır yeniden yazılır.

| Kod | Anlamı | Ne yapmalı |
|-----|--------|------------|
| 200 | Fiyat yazıldı / zaten günceldi | — |
| 401 | Sır yanlış/tanımsız | Vercel env'i kontrol et |
| 502 | Muhafızlardan biri durdurdu (kaynak okunamadı, biçim değişti) | Gövdedeki `guard` alanına bak |
| 503 | migration **077** çalıştırılmamış | SQL'i çalıştır; tekrar denemek işe yaramaz |

## 3 · Belge uyarısı — GÜNDE TAM BİR KEZ

```
GET https://<alan-adı>/api/cron/document-alerts?secret=<CRON_SECRET>   — günde 1, 06:00
```

Süresi yaklaşan/dolmuş şoför belgelerini (SRC, ADR, oturma izni…) **dönüm
noktalarında** bildirir: eşik günü (tür başına `warn_days`, varsayılan 30) ·
7 gün kala · 1 gün kala · dolduğu gün · dolduktan sonra haftada bir.

> ⚠️ **Günde birden fazla çağırma.** Tetikleme "en son ne zaman bildirdim"
> kolonundan değil, **o günün kalan gün sayısından** türetiliyor. İkinci çağrı
> aynı dönüm noktasını yeniden bulur ve **aynı bildirimi tekrar gönderir**.
>
> Saat 06:00 (Europe/Vienna) öneriliyor: gün sınırı UTC'de hesaplandığı için
> gece yarısından uzak durmak, koşumun gün değişimine denk gelmesini önler.

| Kod | Anlamı | Ne yapmalı |
|-----|--------|------------|
| 200 | Hesap yapıldı (`esiktekiBelge`, `bildirilen`, `kalemler`) | — |
| 401 | Sır yanlış/tanımsız | Vercel env'i kontrol et |
| 503 | migration **078** çalıştırılmamış | Belge takibi o kiracıda kapalı demektir; ya SQL'i çalıştır ya kaydı kurma |

**Kurmadan önce kuru koşum** — hangi bildirimlerin gideceğini **göndermeden**
gösterir:

```
GET https://<alan-adı>/api/cron/document-alerts?secret=<CRON_SECRET>&kuru=1
```

Pano kalemi bu işten **bağımsızdır**: Dikkat listesinde belge, eşiğe girdiği
andan düzeltilene kadar her gün durur. Cron yalnız *dürtme*; kaçan bir gün
kalemi kaybettirmez, yalnız o günün bildirimini kaçırır.

## 4 · Demo telemetri temizliği — YALNIZ galzura-demo

```
GET https://<alan-adı>/api/cron/demo-retention?secret=<CRON_SECRET>    — günde 1, gece
```

`device_telemetry`de 14 günden eski satırları parça parça siler (tur başına
20.000, çağrı başına en çok 25 tur = 500 bin satır).

| Kod | Anlamı |
|-----|--------|
| 200 | Silindi (`deleted`, `rounds`) |
| 401 | Sır yanlış/tanımsız |
| 403 | `tenant_locked` — bu dağıtım galzura-demo DEĞİL |

> 🔴 **HAK61 ve Sendigo'da bu kaydı KURMA.** Oralarda ham telemetrinin saklama
> süresi hukuki bir konudur (§ 132 BAO). Üç savunma katmanı var ve üçü de
> bağımsız: (a) tenant kilidi 403 verir, (b) `CRON_SECRET` ayrıdır,
> (c) silme fonksiyonu o veritabanlarında **hiç kurulmaz** —
> `054_demo_telemetry_retention.sql` kurulum SQL'ine bilerek dahil edilmez.

## 5 · Periyodik bakım uyarısı — GÜNDE TAM BİR KEZ

```
GET https://<alan-adı>/api/cron/bakim-alerts?secret=<CRON_SECRET>      — günde 1, 06:15
```

İki iş yapar, tek geçişte:

1. **İş emri açar.** Eşiğe giren (ya da geçmiş) her bakım planı için
   `kaynak='periyodik'` bir iş emri açar. Aynı araçta AÇIK periyodik emir
   varsa **ikincisini açmaz** — ölçüldü: ikinci tur `isEmriAcilan=0`.
2. **Bildirim gönderir.** Alıcı YALNIZ yönetim tarafıdır (patronlar + o
   ARACIN filosunun şefleri). Şoföre gitmez: bakım randevusunu o almıyor.

**Dönüm noktaları** — belge cron'uyla aynı gerekçe (her sabah bağıran bir
kanal susturulur):

| Eksen | Ne zaman bildirir |
|-------|-------------------|
| süre  | eşiğe giriş günü (`uyari_gun`, varsayılan 14) · 7 · 1 · 0 · sonra haftada bir |
| km    | yalnız **eşiğe giriş** ve **geçiş** anları |

> Km'de "gün" diye bir şey yoktur: eşik takvime değil aracın ne kadar
> çalıştığına bağlıdır. "1.200 km kaldı" ile "1.150 km kaldı" arasında
> yöneticinin davranışını değiştirecek bir fark yok.

> ⚠️ **Günde birden fazla çağırma.** Belge cron'undaki tuzağın aynısı:
> tetikleme "en son ne zaman bildirdim" kolonundan değil, o günün kalan
> gün/km sayısından türetiliyor. İkinci çağrı aynı bildirimi tekrar gönderir.
> (İş emri tarafı idempotenttir — tekrar çağırmak ikinci emir açmaz.)
>
> Saat **06:15** öneriliyor: belge uyarısı 06:00'da koşuyor, iki iş aynı
> dakikaya binmesin.

| Kod | Anlamı | Ne yapmalı |
|-----|--------|------------|
| 200 | Hesap yapıldı (`esikte`, `isEmriAcilan`, `bildirilen`, `kmOlculemeyen`, `kalemler`) | — |
| 401 | Sır yanlış/tanımsız | Vercel env'i kontrol et |
| 503 | migration **081** çalıştırılmamış | Bakım o kiracıda kapalı demektir; ya SQL'i çalıştır ya kaydı kurma |

**Kurmadan önce kuru koşum** — ne yazılacağını ve kimin bildirim alacağını
**yazmadan ve göndermeden** gösterir:

```
GET https://<alan-adı>/api/cron/bakim-alerts?secret=<CRON_SECRET>&kuru=1
```

Gövdedeki **`kmOlculemeyen`** alanına bak: odometresi 72 saattir okunamayan
araç sayısıdır. O araçlarda km eşiği hesaplanmaz (uydurulmaz) ve plan yalnız
süre ekseninden tetiklenir — sayı beklediğinden büyükse cihaz tarafında bir
sorun var demektir, bakım tarafında değil.

Pano kalemi bu işten **bağımsızdır**: yaklaşan/gecikmiş bakım Dikkat
listesinde her gün durur. Kaçan bir gün kalemi kaybettirmez.

> **Plan yoksa iş boştur.** Bakım kuralları `/admin/bakim` ekranından kurulur;
> hiç plan yoksa uç 200 döner ve `esikte: 0` der. Kaydı bugünden kurmak
> zararsızdır.

## ~~6 · Vardiya bekçisi — KALDIRILDI~~

`/api/cron/shift-watchdog` **artık yok**. Telegram katmanının tamamı
20.08.2026'da söküldü (kod + şema); bekçi de o gün silindi, çünkü tek işi
uzun süredir açık kalan vardiyayı şoföre **Telegram'dan** sormaktı.

**Yapılacak:** cron-job.org (ya da hangi zamanlayıcı kullanılıyorsa) üzerindeki
`shift-watchdog` kaydını **sil**. Kayıt duruyorsa saatte bir 404 alıyor ve
zamanlayıcı sonunda "iş sürekli başarısız" diye kapatabilir — o gürültü gerçek
bir arızayı gölgeler.

Vardiya kapatma kuralı bugün şöyle: **vardiyayı yalnız personel kapatır.**
Otomatik kapanış kaldırıldı; kapanmamış vardiyalar Dikkat panosundaki
"Kapanmamış Vardiyalar" kartında görünür.

---

## 6 · Haftalık aksiyon — HAFTADA TAM BİR KEZ

```
POST https://<alan-adi>/api/cron/haftalik-aksiyon?secret=<CRON_SECRET>
```

**Sıklık: Pazartesi 06:30.** Neden Pazartesi sabahı: tur GEÇEN HAFTAYI yorumluyor
ve yöneticinin haftaya "bu hafta ne yapacağım" listesiyle başlaması gerekiyor.
06:30, belge (06:00) ve bakım (06:15) uyarılarından SONRA — o iki cron aynı
sabah iş emri açabiliyor ve haftalık tarama onları görebilsin.

**HAFTADA TAM 1 — ikinci tetikleme zararsız.** `hafta_basi` tekil; ikinci koşum
hiçbir şey yazmaz ve `{"zatenVardi": true}` döner. Kapatılmış kalemler geri
gelmez. (Bakım cron'undaki "günde tam 1" deseninin haftalık karşılığı.)

**Kuru koşum** — canlıya satır yazmadan "kurallar ne çıkarıyor" sorusunu
cevaplar. Yeni kiracıda eşikleri görmek için:

```
POST /api/cron/haftalik-aksiyon?secret=<CRON_SECRET>&kuru=1
```

### Yanıt kodları

| Kod | Anlamı | Ne yapmalı |
|---|---|---|
| 200 | Tur üretildi (`aksiyon`, `elenen`, `tarama`, `bildirim`, `kalemler`) | — |
| 200 + `zatenVardi` | Bu haftanın turu zaten var; hiçbir şey yazılmadı | — |
| 401 | Sır yanlış/tanımsız | Vercel env'i kontrol et |
| 503 | migration **084** çalıştırılmamış | Haftalık panel o kiracıda kapalı; ya SQL'i çalıştır ya kaydı kurma |
| 500 | Üretim sırasında hata — gövdede sebep | Gövdeye bak; tur YAZILMAMIŞTIR (yarım hafta bırakılmaz) |

### Yanıtın okunması

`tarama` alanı kural başına `{aday, gecen, esik}` taşır ve **"kural çalışmadı"
ile "kural çalıştı, eşiği geçen yok" ayrımının tek kaynağıdır**. Bir kuralda
`atlandi` görürseniz o sinyal okunamamıştır (migration yok, RPC yok) — 0 kalem
sessiz bir arıza değil, kayda geçmiş bir eksikliktir.

`bildirim` alanı `{alici, jeton, hata}` döner. `jeton: 0` **hata değildir**:
yöneticilerin kayıtlı mobil cihazı yoksa bildirim hiçbir yere gitmez ve panel
bunu açıkça yazar ("N yönetici — kayıtlı cihaz yok"). HAK61'de 25.08.2026
itibarıyla push jetonu **sıfır** — ölçüldü.

Panelde bildirim **üç durumludur** ve ayrımı bu cron belirler:

| Turdaki değer | Panelde | Anlamı |
|---|---|---|
| `bildirim_alici = NULL` | "Bildirim denenmedi" | Turu bu cron ÜRETMEDİ; gönderim hiç çağrılmadı |
| `alici > 0`, `jeton = 0` | "N yönetici — kayıtlı cihaz yok" | Denendi, alıcı var, kayıtlı cihaz yok |
| `jeton > 0` | "N yöneticiye · M cihaza" | Gitti |

Yani panelde **"Bildirim denenmedi"** görüyorsanız tur bu uçtan geçmemiştir —
zamanlayıcı kaydını kontrol edin.

⚠️ **Bu cron kurulmazsa** panel boş kalır ama sessizce değil: ekran "bu hafta
için tur üretilmemiş" der ve zamanlayıcı kaydının eksik olduğunu söyler.

---

## 7 · Mevzuat erken uyarı — 15 DAKİKADA BİR

```
POST https://<alan-adi>/api/cron/mevzuat-tarama?secret=<CRON_SECRET>
```

**Sıklık: 15 dakika.** Bu modülün tek vaadi "ihlal OLMADAN ÖNCE haber ver".
En dar kademe 15 dakika; tarama daha seyrek koşarsa o kademe hiç yakalanmaz
ve ürün kendi vaadini tutamaz.

**SIK KOŞMAK SPAM ÜRETMEZ.** `mevzuat_uyari_tekil` indeksi
`(worker_id, gun, kural, kademe)` tekil: kademe koşulu 15 dakika boyunca
sağlanmaya devam etse de ikinci insert 23505 ile reddedilir ve **gönderim
yapılmaz**. Yanıttaki `tekrar` sayacı kaç tetiklemenin böyle engellendiğini
söyler — sıfır olması gerekmez, sağlıklı bir turda pozitiftir.

**Kuru koşum** — kimin hangi kademede olduğunu yazmadan ve bildirmeden gösterir:

```
POST /api/cron/mevzuat-tarama?secret=<CRON_SECRET>&kuru=1
```

### Yanıt kodları

| Kod | Anlamı | Ne yapmalı |
|---|---|---|
| 200 | Tur tamam (`taranan`, `aday`, `yazilan`, `tekrar`, `gonderilenler`) | — |
| 401 | Sır yanlış/tanımsız | Vercel env'i kontrol et |
| 503 | migration **086** çalıştırılmamış | Canlı katman o kiracıda kapalı; ya SQL'i çalıştır ya kaydı kurma |
| 500 | Tur sırasında hata — gövdede sebep | Gövdeye bak |

### Yanıtın okunması

`taranan` AÇIK vardiya sayısıdır; kapanmış vardiya bu turun konusu değildir.
`aday` kademe koşulunu sağlayan (şoför, kural) çifti; `yazilan` gerçekten
gönderilen uyarı; `tekrar` tekil indekse takılan (yani spam engellenen)
tetikleme.

⚠️ **24 saatten uzun süredir açık kayıtlar taranır ama uyarı ÜRETMEZ.** Bunlar
kapanmamış vardiyalardır, 37 saattir çalışan insanlar değil — HAK61'de 9 açık
vardiyanın 7'si böyleydi (ölçüldü 25.08.2026). Ayrıntı
`docs/MEVZUAT-ERKEN-UYARI.md` § 6.

⚠️ **Bu modül yasal uyum garantisi vermez.** Takograf yok; çalışma süresi
ölçülür, sürüş süresi yalnız tahmin edilir. Konumlandırma "erken uyarı".

---

## 8 · Dönem skoru + rozet — HAFTADA BİR

```
POST https://<alan-adi>/api/cron/skor-donem?secret=<CRON_SECRET>
```

**Sıklık: haftada 1.** Dönem 30 günlük **kayan** pencere; haftada bir yazmak
sıralamayı makul tazelikte tutar. Aylık koşsaydı şoför üç hafta boyunca eski
sırayı görürdü.

**NEDEN CRON:** `buildPerformanceReport` 30 günlük olay + telemetri + vardiya
taraması yapıyor ve liderlik tablosu HER ŞOFÖRÜN telefonunda açılıyor. Her
açılışta bu raporu koşturmak hem yavaş hem gereksiz.

**TEKRAR KOŞMAK ZARARSIZ:** dönem `(worker_id, donem_bas)` tekil ve yazma
**upsert** — ikinci koşum aynı satırı günceller, yenisini yazmaz (aksi hâlde
"üst üste 3 dönem" sayımı tekrarlarla şişerdi). Rozet tarafında
`(worker_id, rozet, donem_bas)` tekil; ikinci koşum 23505 alır ve `tekrar`
sayacına düşer.

**Geriye dönük doldurma** — yeni kurulumda geçmişi bir kerede üretir:

```
POST /api/cron/skor-donem?secret=<CRON_SECRET>&geri=5
```

Her dönem kendi kalibrasyon damgasını alır; cihaz eşiği değişiminden önce
başlayan dönemler `epok_oncesi=true` işaretlenir ve seri rozetine **sayılmaz**.

### Yanıt kodları

| Kod | Anlamı | Ne yapmalı |
|---|---|---|
| 200 | Dönemler yazıldı (`donemler`, `rozet`) | — |
| 401 | Sır yanlış/tanımsız | Vercel env'i kontrol et |
| 503 | migration **088** çalıştırılmamış | Ödül katmanı o kiracıda kapalı |
| 500 | Hata — gövdede sebep | Gövdeye bak |

### Yanıtın okunması

`rozet.seriKazanilabilir` **false** ise sebep temiz dönem azlığıdır: cihaz
alarm eşikleri 23.07.2026'da değişti ve o sınırdan öncesi karşılaştırılamaz.
`rozet.temizDonem` kaç dönemin sınırdan sonra başladığını söyler.

⚠️ **İsim görünürlüğü ayarı bu cron'la ilgili değildir** ve varsayılanı
KAPALIDIR: isimli liderlik tablosu § 87 Abs. 1 Nr. 6 BetrVG anlamında
performans izlemeye elverişli bir düzenektir (bkz. `docs/SOFOR-ODUL.md` § 6).

---

## Yeni kiracıda kurulum sırası

1. Kurulum SQL'ini çalıştır (`db/install/<musteri>-full.sql`) — şema 001→088.
2. Vercel env'leri gir: `FLESPI_SYNC_SECRET`, `CRON_SECRET`, `FLESPI_TOKEN`.
3. **1 numaralı** kaydı kur (flespi) — telemetri akmadan hiçbir şey çalışmaz.
4. `device_telemetry`ye satır düştüğünü doğrula:
   `select count(*) from device_telemetry where recorded_at > now() - interval '1 hour';`
5. **2** ve **3** numaralı kayıtları kur; ilk çağrılarının **200** döndüğünü gör
   (503 alıyorsan ilgili migration çalışmamıştır).
6. Bakım planı kuracaksan **5**'i de kur (kuru koşumla doğrula).
7. Haftalık paneli istiyorsan **6**'yı kur — önce `&kuru=1` ile koştur ve
   `tarama` çıktısına bak: kaç kural gerçekten veri buluyor?
8. Canlı mevzuat katmanını istiyorsan **7**'yi kur — önce `&kuru=1` ile
   koştur ve kaç kişinin hangi kademede olduğuna bak.
9. Ödül/liderlik istiyorsan **8**'i kur — önce `&geri=5` ile bir kez
   koştur ki geçmiş dönemler dolsun.
10. Demo değilse **4**'ü kurma. `shift-watchdog` diye bir iş **yok**.

---

## 9 · Saklama UYARISI — GÜNDE BİR, GECE · 🔴 HİÇBİR ŞEY SİLMEZ

**Migration 090.** Ayrıntılı gerekçe: [`docs/SAKLAMA-POLITIKASI.md`](SAKLAMA-POLITIKASI.md).

```
GET https://<dağıtım>/api/cron/saklama?secret=<CRON_SECRET>
```

Sıklık: **günde 1**, gece (03:00 önerilir).

### 🔴 BU UÇ SİLME YAPMAZ

İki iş yapar:

1. **Cihaz ömür izini tazeler** — aracın ilk/son telemetri anı ham akıştan
   bağımsız yaşasın (yoksa silme sonrası "sessiz araç" uyarısı kaybolur).
2. **Uyarı üretir** — "uyarı eşiğini geçen X satır ham konum veriniz var".

Silme kararı ve zamanı **veri sorumlusunundur** (müşteri); Galzura veri
işleyendir. Silme yalnız `/admin/saklama` ekranından, yönetici aralığı seçip
çift onay vererek yapılır ve `saklama_silme_izi`ne yazılır.

Gövdede **`silmeYapildi: false`** alanı bilerek vardır — gövdeyi okuyan
yanılmasın.

⚠️ **Yasal çıpa uydurulmaz.** `saklama_esikleri` tablosu bugün BOŞ; uyarı
`yasalEsikGun: null` taşır ve ekran hiçbir sayı basmaz.

### Kuru mod

```
GET https://<dağıtım>/api/cron/saklama?secret=<CRON_SECRET>&kuru=1
```

Ömür izini bile **yazmaz**, yalnız okur.

| Kod | Anlamı | Ne yapmalı |
|-----|--------|------------|
| 200 | Tur tamam | Gövdede `uyariSayisi` · `uyarilar[]` · `silmeYapildi:false` |
| 401 | Sır yanlış/tanımsız | Vercel env'i kontrol et |
| 503 | migration **090** çalıştırılmamış | SQL'i çalıştır; tekrar denemek işe yaramaz |

### ⚠️ 4. iş ile karıştırmayın

`/api/cron/demo-retention` **yalnız galzura-demo**'da çalışır, 14 gün tutar,
tenant kilitlidir ve **GERÇEKTEN SİLER**; işi "demoda disk şişmesin". Bu iş bir
**uyarı üreticisidir** ve hiçbir şey silmez. İkisi ayrı kayıtlardır.

---

## 10 · Aylık metrik — GÜNDE BİR, GECE (S4)

**Migration 090** (tablo zaten kurulu, yeni migration YOK).
Ayrıntı: [`docs/AYLIK-METRIK.md`](AYLIK-METRIK.md).

```
GET https://<dağıtım>/api/cron/aylik-metrik?secret=<CRON_SECRET>
```

Sıklık: **günde 1**, gece **03:30** (saklama 03:00'te koşuyor, aynı dakikaya
binmesin).

### Ne yapar

`vehicle_month_metrics` tablosuna **KAPANMIŞ** ayların araç × ay özetini yazar
(litre, km, ölçülemedi sebebi). CO₂ panosunun aylık serisi artık o tablodan
okuyor; eskiden altı ayı da canlı hesaplıyordu — **ölçüldü: 1.112 sorgu /
23,58 sn, ve altı ayın DÖRDÜ tamamen boştu.**

### 🔴 Açık ayı YAZMAZ

İçinde bulunulan ay her gün değişir; gece yazılan satır sabaha bayat olur.
Açık ay okuma anında **canlı** hesaplanır. Gövdedeki `acikAyYazilmadi` alanı
hangi ayın atlandığını söyler.

### Geç gelen telemetri

Bir ay kapandığı gece YAZILMAZ; `?gecikme=` gün beklenir (varsayılan **2**).
flespi kesinti sonrası geriye yazabiliyor (28.08'de 11.455 satır). O ay
bu arada canlı yoldan okunur, yani bekleme hiçbir ekranı geciktirmez.

| Parametre | Varsayılan | Ne yapar |
|---|---|---|
| `geri` | 6 | Kaç kapanmış ay kapsansın (1–24) |
| `gecikme` | 2 | Ay kapandıktan sonra kaç gün beklensin (0–30) |
| `tazele=1` | — | Satırı olan ayları da yeniden yaz (geç veri geldiyse) |
| `kuru=1` | — | HİÇBİR ŞEY YAZMAZ, ne yapacağını söyler |

### Yanıt kodları

| Kod | Anlamı | Ne yapmalı |
|-----|--------|------------|
| 200 | Tur tamam (`yazilan`, `aylar[]`, `acikAyYazilmadi`) | ⚠️ aşağıya bak |
| 401 | Sır yanlış/tanımsız | Vercel env'i kontrol et |
| 503 | migration **090** çalıştırılmamış — **ya da** geçici DB hatası | Gövdedeki `detay` alanını oku; 090 gerçekten yoksa SQL'i çalıştır |

🔴 **200 tek başına "yazdı" demek DEĞİLDİR.** Ay bazındaki başarısızlık HTTP
kodunu değiştirmiyor: bir ay hata alırsa `aylar[]` içinde
`durum:"hata", sebep:"…"` görünür ama yanıt yine `200 / ok:true` döner.
**Kaydı kurduktan sonra ilk çağrının gövdesine bak**, koda değil: `yazilan`
sıfırdan büyük mü, `aylar[]` içinde `"hata"` var mı.

**İDEMPOTENT:** ikinci çağrı `tazele` verilmedikçe yazılmış ayları atlar ve
`yazilan: 0` döner. Atlama kararı **yalnız o ayın satırı var mı** diye
bakıyor; kısmi yazılmış bir ayı (ör. 29 aracın 3'ü) `atlandi_var` sayıp
geçer — düzeltmenin tek yolu `?tazele=1`.

### Hangi kiracıda kurulabilir — 31.08.2026 ÖLÇÜMÜ

Bu iş migration **090**'a bağlı. 090'ın koşup koşmadığı kiracı kiracı
**ölçüldü** (PostgREST, salt okuma: altı tablo + beş RPC envanteri):

| Kiracı | Dağıtım | 090 | Uç canlıda | Karar |
|---|---|---|---|---|
| **HAK61** | `hak-transport-takip.vercel.app` | ✅ 6/6 tablo · 5/5 RPC | ✅ 401 (404 değil) | **KURULABİLİR** |
| **Sendigo** | `sendigo-delta.vercel.app` | ✅ 6/6 tablo · 5/5 RPC | ✅ 401 (404 değil) | **KURULABİLİR** |
| **galzura-demo** | *repoda yazılı değil* | ⬜ `ÖLÇÜLEMEDİ` — service key yok | ⬜ ölçülemedi | **ÖNCE ÖLÇ** |

`vehicle_month_metrics` her iki ölçülen kiracıda da **0 satır** — yani cron
hiç koşmamış ve ilk tur temiz bir tabloya yazacak.

🔑 **galzura-demo'yu ölçmenin yolu, anahtar istemeden:** kuru mod hiçbir şey
yazmaz, yalnız okur.

```
GET https://<galzura-dağıtımı>/api/cron/aylik-metrik?secret=<CRON_SECRET>&kuru=1
```

- **200** → 090 var, kayıt kurulabilir
- **503** → `detay` alanını oku; gerçekten `migration_090_yok` ise önce
  `db/migrations/090_saklama_politikasi.sql` çalıştırılmalı
- **401** → o kiracının `CRON_SECRET`'i tanımsız ya da yanlış

### 31.08.2026 — kayıt kurulmadan önce düzeltilen iki kusur

Bu uç kurulmadan yapılan ölçümde **hiçbir şey yazamayacak** durumdaydı:
cron ayı `"2026-07"` biçiminde geçiriyordu ama `vehicle_month_metrics.ay`
bir `date` kolonu → PostgREST **22007** döndürüyordu, üstelik uç yine
`200 / ok:true` diyordu. İkincisi: `gecikme` parametresi verilmediğinde
varsayılan 2 yerine **0** oluyordu (`Number(null) === 0`), yani geç gelen
telemetri beklemesi fiilen kapalıydı. İkisi de düzeltildi; ayrıntı ve canlı
ölçüm: [`docs/AYLIK-METRIK.md`](AYLIK-METRIK.md) § 6.2b.

⚠️ **Bu kayıt kurulmazsa ekran bozulmaz**, yalnız yavaş kalır: aylık seri
canlı yola düşer (bugünkü davranış) ve satırı olmayan ay "hesaplanmadı"
gösterilir — **"0" DEĞİL.**
