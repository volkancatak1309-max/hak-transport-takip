# Ham telemetri saklama politikası — 90 gün

**Migration 090 · `/admin/saklama` · `lib/saklama.ts` + `lib/saklama-db.ts`**

> Bu belge **müşteriye ve denetime gösterilmek üzere** yazılmıştır.
> Almanca ve İngilizce özetler §9 ve §10'da.
>
> Sayılar 26.08.2026'da HAK61 canlı verisinde ölçüldü.

---

## 1 · Karar

| | |
|---|---|
| **Ham GPS izi** (`device_telemetry`, `driver_locations`) | **90 gün** |
| **Türetilmiş kayıtlar** (vardiya, alarm, rölanti, bölge ziyareti, sefer, iş emri, belge) | **etkilenmez** — kendi hukuki süreleri geçerli |
| **Aylık özet** (`vehicle_month_metrics`) | ham silindikten sonra da yaşar |
| **Varsayılan silme anahtarı** | 🔴 **KAPALI** — açmak bilinçli bir insan eylemidir |

Süre **kiracı ayarıdır**: alt sınır 30, üst sınır 400 gün.
**90 günün üstü yazılı gerekçe ister** ve gerekçe ürünün içinde saklanır.

---

## 2 · Neden 90 gün

### 2.1 · Operasyonel ihtiyaç — CMR Md. 32

Uluslararası karayolu taşımasında (CMR sözleşmesi) **zamanaşımı 1 yıldır**
(kasıt hâlinde 3 yıl). Yani bir teslimat anlaşmazlığı teorik olarak bir yıl
sonra da gündeme gelebilir.

Ama **ham GPS izi** o tartışmanın kanıtı değildir. Kanıt olan şey
**teslimat kaydıdır**: ePOD imzası, fotoğraf, an ve yer damgası (migration
080) — ve o kayıt **değişmezdir** (HK080 tetikleyicisi) ve **silinmez**.
Ham iz, o kaydın nasıl üretildiğinin ara ürünüdür.

Pratikte anlaşmazlık **ilk haftalarda** çıkar. **Bir çeyrek yıllık pay**,
"geçen ay şu teslimatta ne oldu" sorusunu ham izle cevaplamaya fazlasıyla
yeter.

### 2.2 · Denetim otoritelerinin çizdiği çerçeve

| Otorite | Süre | Sonuç |
|---|---|---|
| **Fransa — CNIL** | ham konum verisi için **2 ay** | rehber ilkesi |
| **İtalya — Garante** (Ocak 2025) | **180 gün** | 🔴 **50.000 € ceza** (Autotrasporti Cuccu Riccardo S.r.l.; GPS mola sırasında da açıktı, Md. 5, 13, 88 ihlali) |
| **Almanya** | **400 gün** ve **150 gün** | orantısız bulundu |

**90 gün bu bandın alt yarısındadır**: CNIL'in 2 ayının bir ay üstünde,
cezalandırılmış 180 günün yarısı, orantısız bulunan 150 ve 400 günün çok
altında.

> ⚠️ **90 > 60 olduğu için gerekçe yazılıdır.** CNIL çıtasını aşan her gün
> savunulmak zorundadır ve bu belge o savunmadır.

### 2.3 · Rakiplerin varsayılanı — ayrıştığımız nokta

| Sağlayıcı | Varsayılan | Çıtaya göre |
|---|---|---|
| **Geotab** | **2 yıl** (tavan 8 yıl) | CNIL'in **12 katı** |
| **Verizon Connect** | **13 ay** | Almanya'nın orantısız bulduğu 400 güne eşit |
| **Samsara** | **"müşteri olduğun sürece"** | üst sınır yok |
| **Webfleet** | *"sözleşme sahibi karar verir"* | varsayılan yayımlanmamış |
| **HAK61** | **90 gün** | CNIL + 30 gün |

Ayrıntılı inceleme: [`docs/RAKIP-GDPR.md`](RAKIP-GDPR.md).

Rakiplerin hepsi **işleyen** (processor) sıfatıyla süreyi müşteriye
bırakıyor. Bu hukuken savunulabilir (GDPR Md. 28) **ama uzun varsayılan,
hiçbir şey yapmayan müşteriyi doğrudan ihlale sokuyor** — İtalyan davasında
ceza yiyen taraf tam olarak buydu: cihazı satan değil, **cihazı kullanan**.

**Kararımız: uyumlu varsayılanla başlamak.** Uzatmak mümkün, ama sebepsiz
değil.

---

## 3 · Ham veri ≠ türetilmiş veri

Bu ayrım politikanın belkemiğidir ve şemada **zaten kurulu**.

| Kayıt | Ne | Süre |
|---|---|---|
| `device_telemetry` | ham cihaz akışı — saniyeler aralıklı konum, hız, yakıt, odometre | **90 gün** |
| `driver_locations` | telefon GPS kalıntısı (artık yazılmıyor) | **90 gün** |
| `time_entries` | vardiya: başlangıç, bitiş, mola, km | kendi süresi |
| `vehicle_events` | alarm/olay | kendi süresi |
| `idle_episodes` · `zone_visits` | rölanti epizodu · bölge ziyareti | kendi süresi |
| `seferler` · `teslimat_kanitlari` | sefer · ePOD (**değişmez**) | kendi süresi |
| `vehicle_month_metrics` | **aylık özet** (090) | ham silindikten sonra da yaşar |

### ⚠️ AZG çalışma süresi kaydı 24 ay saklanır — ama o GPS izi değildir

Avusturya iş mevzuatı çalışma süresi kayıtlarının saklanmasını istiyor.
Bu, **`time_entries`** satırıdır: kim, ne zaman başladı, ne zaman bitirdi,
kaç dakika mola verdi. **Konum dizisi değil.**

Ham izi silmek AZG yükümlülüğünü **etkilemez** — çünkü yükümlülüğün konusu
olan kayıt ayrı bir tabloda duruyor ve silinmiyor. İkisini karıştırmak,
"iş hukuku gereği GPS izini iki yıl tutmalıyım" gibi **yanlış** bir sonuca
götürürdü.

---

## 4 · Katmanlı saklama modeli

```
  0 ─────────────── 90 gün ─────────────────────────────►  süresiz
  │                    │
  │  HAM İZ            │  AYLIK ÖZET + TÜRETİLMİŞ KAYITLAR
  │  konum dizisi      │  araç × ay: km, litre, dolum, kapsama
  │  saniye çözünürlük │  vardiya, alarm, bölge, sefer, ePOD
  │                    │
  └── silinir ─────────┘
```

### ⚠️ Özet granülerliği **AY** — ölçümle seçildi

`buildFuelReport`'un 28 günlük gerçek cevabı **2.602,6 L**. Aynı pencere
parçalanıp toplandığında (HAK61 canlı, 26.08.2026):

| parça | toplam L | sapma |
|---|---|---|
| **1 gün** | 3.009,9 | **+%15,6** |
| 2 gün | 2.986,0 | +%14,7 |
| 7 gün | 2.714,0 | +%4,3 |
| 14 gün | 2.591,9 | −%0,4 |
| **28 gün** | 2.602,5 | **−%0,0** |

İkinci ölçüm (14 günlük pencere): gerçek **1.194,98 L**, günlük parça
toplamı **1.540,1 L** = **+%28,9**.

**Sebep:** yakıt motoru (migration 027 + 052) ardışık okuma **dizisi**
üzerinde çalışıyor — 30 satırlık de-glitch penceresi, 15 dakikalık seri
birleştirme, dolum tespiti. Gün sınırı bu diziyi kesiyor; gece yarısını aşan
dolum iki kez sayılıyor.

> 🔑 Bu yüzden özet **günlük değil aylık**, ve değerler **raporun kendi
> motorundan** alınıyor: ay tek pencere olarak `buildFuelReport`e veriliyor
> ve çıktısı olduğu gibi yazılıyor. Özet, raporun kendi cevabının
> dondurulmuş hâlidir — ikinci bir hesap değil.

---

## 5 · Ne kurtarılır, ne kurtarılmaz — dürüst liste

Silmeden önce **10 yüzey tek tek ölçüldü**.

| Yüzey | Ham silinince | Özet kurtarır mı |
|---|---|---|
| Mevzuat erken uyarı | ✅ etkilenmez (yalnız açık vardiyaya bakıyor) | gerekmez |
| Bölge ziyaretleri | ✅ etkilenmez (`zone_visits` **kalıcı** yazılıyor) | gerekmez |
| €/km maliyet | ✅ payda `time_entries`ten (km kapısı hariç) | km dondurma ile |
| Güvenlik skoru — ceza payı | ✅ `vehicle_events` + `idle_episodes` durur | gerekmez |
| Güvenlik skoru — km paydası | ⚠️ ham odometreden | km dondurma ile |
| Yakıt raporu | ⚠️ ham diziden | ✅ aylık özet |
| CO₂ panosu | ⚠️ yakıttan besleniyor | ✅ aylık özet |
| Sefer kârlılığı | ⚠️ ham odometre uçlarından | ay granülerliğinde |
| Haftalık aksiyon K3 "sessiz araç" | 🔴 araç listeden **düşerdi** | ✅ ömür izi |
| **Rota geçmişi / oynatma** | 🔴 **boşalır** | ❌ **KURTARILAMAZ** |

### 🔴 Rota geçmişi bilinçli olarak kurtarılmıyor

Bir ayın konum dizisini özet tablosunda saklamak, **"ham izi sakla" demenin
başka bir yolu** olurdu ve politikanın kendisini boşa çıkarırdı.

Rota, saklama süresi dolduğunda **gerçekten kaybolur.** Ürünün borcu onu
kurtarmak değil, **kaybolduğunu söylemek**: ekran "bu tarih saklama
süresinin dışında" der, boş harita göstermez.

### 🔴 Sessiz araç uyarısı — silmenin en ters sonucu

Haftalık aksiyon kuralı K3 ve panodaki "sessiz cihaz" alarmı, aracın **son
ham satırının yaşına** bakıyor. 90 günden uzun susmuş bir aracın tüm
satırları silinince o araç uyarı listesinden **sessizce düşerdi** — yani
**en çok ilgilenilmesi gereken araç görünmez olurdu**.

`vehicle_telemetry_lifetime` tablosu (090) ilk/son telemetri anını ham
akıştan **bağımsız** tutar. Silme, bu tablo yazılmadan **başlamaz**.

---

## 6 · 🔴 Silmeden önce düzeltilen kusur

Ham veri **olmayan** bir pencerede bugünkü davranış ölçüldü
(01.03→01.04.2026, HAK61 canlı):

```
buildFuelReport → available:true · totalConsumedLiters:0 · 29 araç · hasData 0
buildCostReport → totalEur:0 · fuelEur:0
co2Panosu       → kg:null · 29 plaka "ölçülemedi"        ← DOĞRU olan bu
```

Yakıt ve maliyet raporu, **ölçülmemiş bir dönemi "0 L · 0,00 €" diye olgu
gibi basıyordu.** Silme açılsaydı bu kusur, **gerçek veriyi uydurma sıfıra
çeviren bir makineye** dönüşürdü.

**Düzeltildi (090):**
- Ölçülen araç 0 iken KPI bandı **"—" + "ölçülemedi"** yazıyor, 0 L değil.
- Maliyet raporuna geçen litre `measured > 0` kapısından geçiyor.
- PDF'te `totalLiters: null` → *"Gesamtverbrauch: nicht messbar"*.
- İstenen pencere kesimi aşıyorsa **kapsam şeridi** görünüyor ve kaç günün
  dışarıda kaldığını yazıyor.

---

## 7 · Silme nasıl çalışır — dört kapı

```
1 · ÖMÜR İZİ    aracın ilk/son telemetri anını yaz
2 · AYLIK ÖZET  kesimin gerisindeki her ay için raporun cevabını dondur
3 · KM DONDUR   vardiya km yargısını sabitle
──── ancak bundan SONRA ────
4 · SİL         ve yalnız kesimin TAMAMEN gerisindeki aylar için
```

**Dördü de sağlanmazsa silme reddedilir ve sebebi ekranda yazar.**

### ⚠️ Sıra tartışma dışı

`km_dondu` adımı silmeden **önce** yapılmalıdır. Sonra yapılırsa ham zaten
gitmiş olur ve dondurma her sıfır-farklı vardiyaya sessizce "ölçülemedi"
yazar — **düzeltmek istediği hatayı kalıcılaştırır.** Ve o bayrak
yöneticinin seçtiği aralıktaki Excel ve Almanca PDF çıktısına kadar gider.

### ⚠️ Kesimi ortadan bölen ay silinmez

Yarısı silinip yarısı kalan bir ay, ne özetiyle ne ham verisiyle tutarlı
olurdu. Yalnız **tamamen** kesimin gerisinde kalan aylar silinir.

### 🔴 Fail-closed

`tenant_saklama.silme_acik` varsayılanı **false**. Migration çalıştırılsa,
cron kaydı girilse, doğru sırla çağrılsa bile **kapalıyken tek satır
silinmez**. Ekranda "Sil" düğmesi **yoktur** — silme geri alınamaz ve bir
düğmenin arkasına konulamaz.

---

## 8 · Bugünkü durum (26.08.2026, HAK61)

| | |
|---|---|
| `device_telemetry` | **1.611.074 satır** |
| En eski kayıt | **13.07.2026 = 44 gün** |
| 90 günden eski satır | **0** |
| Silme anahtarı | **KAPALI** |

**Bugün silinecek bir şey yok** — entegrasyon 13.07'de başladı. Mekanizma,
veri 90 günü aştığında hazır olsun diye şimdi kuruluyor.

Önceki durum: politika **yoktu**. 44 gün CNIL çıtasının altındaydı ama bu
bir politika değil bir **tesadüftü**; hiçbir şey 400 güne gitmesini
engellemiyordu.

---

## 9 · Zusammenfassung (Deutsch)

**Aufbewahrungsfrist für GPS-Rohdaten: 90 Tage.**

Die GPS-Rohspur (`device_telemetry`, `driver_locations`) wird nach **90
Tagen gelöscht**. **Abgeleitete Datensätze sind nicht betroffen**:
Arbeitszeiten (`time_entries`), Alarme, Zonenbesuche, Fahrten und
Liefernachweise (ePOD) bleiben nach ihren eigenen gesetzlichen Fristen
erhalten.

**Begründung der 90 Tage:**
- **CMR Art. 32** sieht für den internationalen Straßengüterverkehr eine
  Verjährung von einem Jahr vor. Der Beweis einer Lieferung ist jedoch der
  **unveränderliche Liefernachweis** (ePOD mit Unterschrift, Foto, Zeit- und
  Ortstempel), nicht die GPS-Rohspur. Streitigkeiten treten in der Praxis in
  den ersten Wochen auf; ein Quartal genügt operativ.
- **CNIL (Frankreich)** nennt für Rohstandortdaten **2 Monate**.
- **Garante (Italien)** verhängte im Januar 2025 **50.000 €** unter anderem
  wegen **180 Tagen** Aufbewahrung.
- **Deutschland** hielt **400** und **150 Tage** für unverhältnismäßig.

90 Tage liegen in der unteren Hälfte dieses Rahmens. Zum Vergleich:
**Geotab 2 Jahre**, **Verizon Connect 13 Monate**, **Samsara „solange Sie
Kunde sind"**.

**Gestufte Aufbewahrung:** Rohdaten 90 Tage → **monatliche Zusammenfassung**
(Fahrzeug × Monat: km, Liter, Betankungen, Abdeckung) unbefristet.
Die Granularität ist **monatlich**, weil eine tagesweise Aggregation den
Kraftstoffverbrauch messbar um **15,6–28,9 %** überschätzt.

**Was nicht wiederherstellbar ist:** die **Streckenwiedergabe**. Das ist
bewusst so — eine Monatsspur der Positionen zu speichern hieße, die Rohspur
unter anderem Namen aufzubewahren. Der Bildschirm sagt dann ausdrücklich,
dass der Zeitraum außerhalb der Aufbewahrungsfrist liegt.

**Die automatische Löschung ist standardmäßig AUS** und beginnt erst, wenn
Lebensspur, Monatszusammenfassung und eingefrorene km-Bewertung vollständig
sind.

---

## 10 · Summary (English)

**Raw GPS retention: 90 days.**

The raw GPS trail (`device_telemetry`, `driver_locations`) is deleted after
**90 days**. **Derived records are unaffected**: working-time records
(`time_entries`), alarms, zone visits, trips and proof-of-delivery records
(ePOD) are kept under their own statutory periods.

**Why 90 days:**
- **CMR Art. 32** sets a one-year limitation period for international road
  carriage. But the evidence in a delivery dispute is the **immutable proof
  of delivery** (signature, photo, time and place stamp), not the raw GPS
  trail. Disputes surface within the first weeks; a quarter is operationally
  sufficient.
- **CNIL (France)** states **2 months** for raw location data.
- **Garante (Italy)** fined **€50,000** in January 2025, in part for a
  **180-day** retention.
- **Germany** found **400** and **150 days** disproportionate.

90 days sits in the lower half of that band. For comparison: **Geotab 2
years**, **Verizon Connect 13 months**, **Samsara "as long as you are a
customer"**.

**Tiered retention:** raw for 90 days → **monthly summary** (vehicle ×
month: km, litres, refuels, coverage) kept indefinitely. Granularity is
**monthly** because daily aggregation overstates fuel consumption by a
measured **15.6–28.9 %**.

**What cannot be recovered:** **route replay**. This is deliberate — storing
a month of positions would be keeping the raw trail under another name. The
screen states explicitly that the date falls outside the retention window.

**Automatic deletion is OFF by default** and starts only once the lifetime
trail, monthly summaries and frozen km verdicts are all complete.

---

## 11 · Kapılar

| İşlem | Kapı |
|---|---|
| Politikayı görmek | `requireAdmin` — **filo şefine kapalı** |
| Süreyi/anahtarı değiştirmek | `requireAdmin` + denetim izi (eski→yeni) |
| Hazırlığı yürütmek | `requireAdmin` — **hiçbir satır silmez** |
| **Silmek** | **YALNIZ cron** + `CRON_SECRET` + `silme_acik` + dört kapı |

---

## 12 · Cron kaydı

`docs/CRON-KAYITLARI.md` 9. iş. Günde bir kez, gece.

```
GET https://<dağıtım>/api/cron/saklama?secret=<CRON_SECRET>
```

Kuru mod (hiçbir şey yazmaz/silmez):

```
GET https://<dağıtım>/api/cron/saklama?secret=<CRON_SECRET>&kuru=1
```

| Kod | Anlamı |
|---|---|
| 200 | Tur tamam — gövdede `silme.izin`, `silme.engel`, `ozet`, `km` |
| 401 | Sır yanlış ya da `CRON_SECRET` tanımsız |
| 503 | Migration **090** çalıştırılmamış |
| 500 | Tur sırasında hata — gövdede sebep |

---

## 13 · Prova (QA harness) — 83 iddia

Üretim veritabanında silme provası yapılmaz; harness ayrı.

```bash
# Postgres + şema + 090
docker run -d --name hak-qa -e POSTGRES_PASSWORD=qa -e POSTGRES_DB=hak -p 55432:5432 postgres:16
docker exec hak-qa psql -U postgres -d hak -c \
  "create role service_role; create role anon; create role authenticated;"
docker exec -i hak-qa psql -U postgres -d hak -q -v ON_ERROR_STOP=1 < <şim>.sql
MSYS_NO_PATHCONV=1 docker cp db/install/hak61-full.sql hak-qa:/tmp/full.sql
MSYS_NO_PATHCONV=1 docker exec hak-qa psql -U postgres -d hak -q -v ON_ERROR_STOP=1 -f /tmp/full.sql
MSYS_NO_PATHCONV=1 docker cp db/migrations/090_saklama_politikasi.sql hak-qa:/tmp/090.sql
MSYS_NO_PATHCONV=1 docker exec hak-qa psql -U postgres -d hak -v ON_ERROR_STOP=1 -f /tmp/090.sql
docker exec hak-qa psql -U postgres -d hak -c "
  grant all privileges on all tables in schema public to service_role;
  grant execute on all functions in schema public to service_role;
  alter role service_role bypassrls;"

# PostgREST + proxy + tohum, sonra:
set -a; . <qa env>; set +a
npm run verify:saklama            # 63 iddia — motor
npm run build && npx next start -p 3300 &
node scripts/verify-saklama-ekran.mjs   # 20 iddia — ekran
```

### 🔑 Silme ÖNCE/SONRA — ölçülen tablo

Tohum: 2 cihazlı + 1 cihazsız araç · **1.000 ham satır** (600 nisan, 400
ağustos) · 3 vardiya. Kesim **28.05.2026**, yani nisan tamamen gerisinde.

| Ölçüm | ÖNCE | SONRA | Karar |
|---|---|---|---|
| Ham satır — **nisan** | 600 | **0** | silindi |
| Ham satır — **ağustos** | 400 | **400** | dokunulmadı |
| Yakıt raporu — ağustos | 146,4 L | **146,4 L** | ✅ değişmedi |
| Yakıt raporu — nisan | 207,6 L | **`null` · ölçülen 0** | ✅ **"ölçülemedi"**, 0 L DEĞİL |
| **Aylık özet** — nisan | 207,6 L | **207,6 L** | ✅ ham gittikten sonra da ayakta |
| Vardiya km yargısı (A: fark var) | — | **ölçüldü** | ✅ donduruldu |
| Vardiya km yargısı (B: fark yok + hareket var) | — | **ölçülemedi** | ✅ ham olmadan üretilemezdi |
| Ömür izi — nisan başlangıcı | — | **biliniyor** | ✅ sessiz araç uyarısı yaşıyor |
| Türetilmiş kayıtlar (vardiya) | 3 | **3** | ✅ silinmedi |

**Özet, silmeden önceki raporun cevabıyla birebir aynı:** 207,6 vs 207,6
(fark **0,00 L**). Çünkü özet ikinci bir hesap değil, raporun kendi cevabının
dondurulmuş hâli.

### Fail-closed kanıtı

| Durum | Sonuç | Silinen |
|---|---|---|
| Ayar KAPALI, cron çalıştı | `izin:false · engel:ayar_kapali · uygulandi:false` | **0** |
| Ayar AÇIK ama ömür izi yok | `izin:false · engel:omur_izi_yok` | **0** |
| Kuru mod (`?kuru=1`) | `600 satır silinirdi` | **0** |
| Dört kapı da açık | `izin:true · uygulandi:true` | **600** |
| İkinci tur (idempotent) | `izin:true · uygulandi:true` | **0** |

### Ay granülerliği kanıtı (tohum verisinde de)

Aynı nisan penceresi: **aylık tek pencere 207,6 L** · **günlük parça toplamı
256,8 L** → **+%23,7**. Canlı ölçümdeki yönün (+%15,6 / +%28,9) tohumda da
görünmesi, sapmanın veriye değil **yapıya** ait olduğunu doğruluyor.

### Bu provanın yakaladığı kusurlar

1. **`mapBounded` argüman sırası** — `(items, limit, fn)` sanılmıştı, doğrusu
   `(items, fn, limit)`. Tip kontrolü yakaladı.
2. **`DateRange` anahtarları** — `{bas, bit}` yazılmıştı, `buildFuelReport`
   `{start, end}` istiyor. İlk koşuda çöktü.
3. **`driver_locations.created_at` yok** — kolon adı `recorded_at`. Migration
   canlı şemaya sorularak düzeltildi; yazıldığı gibi kalsaydı silme fonksiyonu
   **42703** ile düşerdi.
4. **`start_source` CHECK'i** — tohum `'manual'` yazıyordu; izinli küme
   `self|auto|admin|chief`.
5. **🔴 `NEXT_PUBLIC_*` derleme anında gömülür** — üretim env'iyle derlenmiş
   `next start`, QA anahtarını **gerçek Supabase'e** gönderdi ve
   *"Invalid API key"* aldı. QA yığınına bakan bir sunucu için **QA env'iyle
   yeniden derlemek** şart. (Aynı ders 084'te de yazılı.)
6. **Ölü sunucu portu tutuyordu** — `EADDRINUSE` sessizce logda kalmıştı ve
   eski süreç cevap veriyordu; "düzeltme işe yaramadı" yanılgısı buradan
   çıktı.
