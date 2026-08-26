# Veri saklama — uyarı + elle silme

**Migration 090 · `/admin/saklama` · `lib/saklama.ts` + `lib/saklama-db.ts`**

> Bu belge **müşteriye ve denetime gösterilmek üzere** yazılmıştır.
> Almanca ve İngilizce özetler §11 ve §12'de.
>
> Sayılar 26.08.2026'da HAK61 canlı verisinde ölçüldü.

---

## 1 · 🔴 Sistem otomatik silmez

| | |
|---|---|
| **Otomatik silme** | **YOK.** Ne cron, ne anahtar, ne zamanlayıcı. |
| **Gece koşan iş** | yalnız **hesaplar ve uyarır** |
| **Silme** | **yönetici** yapar: aralığı seçer, kuru modda sayıyı görür, çift onayla siler |
| **Her silme** | denetim izine yazılır — kim, ne zaman, hangi aralık, kaç satır, hangi sebeple |

### Sözleşme metnine girecek cümle

> **Galzura veri işleyendir. Saklama süresi ve silme kararı veri
> sorumlusundadır (müşteri).**

Bu, kodun kendisiyle tutarlıdır: üründe gün sayısına göre silen bir fonksiyon
**yoktur**. `purge_telemetry_range` **aralık** alır ve yalnız `/admin/saklama`
ekranından, denetim izi yazılarak çağrılır.

---

## 2 · Veri kategorilendirmesi

Her tablo üç kategoriden birine düşer (`veri_kategorileri`):

| Kategori | Ne olur |
|---|---|
| **kişisel veri** | uyarı çıkar · **elle silinebilir** |
| **araç verisi** | uyarı çıkmaz · elle silinebilir |
| **yasal zorunlu** | 🔒 **SİLİNEMEZ** — arayüz silme seçeneğini **hiç göstermez** |

### 🔑 Hukuki dayanak — ayrım "araç mı şoför mü" DEĞİL

**GPS izi hukuken şoförün kişisel verisidir, aracın değil.** Aracın firmaya
ait olması bunu değiştirmez. Doğru soru **"o an araçta kim vardı"**: bir konum
dizisi, o dizideki kişinin nerede olduğunu, ne zaman durduğunu, ne kadar
çalıştığını anlatır.

### Bugünkü sınıflandırma

| Tablo | Kategori | Gerekçe |
|---|---|---|
| `device_telemetry` | **kişisel** | ham GPS izi — yukarıdaki dayanak |
| `driver_locations` | **kişisel** | telefon GPS kalıntısı; artık yazılmıyor ama içerik aynı kategoride |
| `idle_episodes` | **kişisel** | konum + süre: kim nerede ne kadar bekledi |
| `zone_visits` | **kişisel** | kimin nerede olduğu; ham izden türetilmiş ama aynı bilgi |
| `vehicles` | araç | plaka, filo, yakıt türü — kişi belirtmez |
| `vehicle_month_metrics` | araç | aylık araç toplamı; kişi ekseni ve gün kırılımı yok |
| `vehicle_telemetry_lifetime` | araç | iki zaman damgası; konum içermez |
| `time_entries` | 🔒 **yasal zorunlu** | AZG/ArbZG çalışma süresi kaydı |
| `teslimat_kanitlari` | 🔒 **yasal zorunlu** | ePOD — HK080 ile değişmez |
| `shift_edit_log` | 🔒 **yasal zorunlu** | vardiya düzeltme denetim izi |
| `security_log` | 🔒 **yasal zorunlu** | oturum/eylem izi |
| `saklama_silme_izi` | 🔒 **yasal zorunlu** | silme izinin **kendisi** |

⚠️ **FAIL-CLOSED:** sınıflandırılmamış bir tablo `yasal_zorunlu` sayılır. Bir
tabloyu sınıflandırmayı unutmak, onu yanlışlıkla silinebilir yapamaz.

⚠️ **Arayüz reddetmez, GÖSTERMEZ.** `yasal_zorunlu` tablolar silme seçicisine
`<option>` olarak **hiç konmaz** (sunucuda süzülür). Reddetmek bir hatadır ve
hata mesajı okunmayabilir; göstermemek bir tasarımdır.

---

## 3 · 🔴 Ülke bazlı yasal eşikler — tablo BOŞ

`saklama_esikleri` tablosu kuruldu ve **bilerek boş bırakıldı**:

```
ulke_kodu · veri_turu · esik_gun · yasal_dayanak · kaynak_url · dogrulanma_tarihi
```

**`esik_gun = NULL` bir eksiklik değil, bir BEYANDIR:** "bu ülke/veri türü
için doğrulanmış bir çıpamız yok". Ekran bu durumda **hiçbir sayı basmaz**:

> *"AT için yasal çıpa HENÜZ DOĞRULANMADI — bu satırda bilerek sayı
> yazmıyoruz."*

Yasal eşikler **ayrı bir araştırma turuyla**, her satır için kaynak linki ve
doğrulanma tarihiyle doldurulacak. Uydurma bir gün sayısı DACH müşterisine
giderse sorumluluk doğar.

⚠️ **Veritabanı bunu zorluyor:** `CHECK saklama_esikleri_kaynakli` — bir sayı
yazıldıysa `yasal_dayanak`, `kaynak_url` ve `dogrulanma_tarihi` de dolu olmak
zorunda. Kaynaksız eşik **yazılamaz** (QA'da doğrulandı).

`dogrulanma_tarihi` şart, çünkü mevzuat değişir ve denetimde sorulacak soru
"ne zaman bakıldı"dır.

---

## 4 · Uyarı eşiği — kiracının kendi çıpası

`tenant_saklama.uyari_gun`, varsayılan **90**. ⚠️ Adı bilinçli `uyari_gun`:
**hiçbir şey silmez.**

### Neden 90

- **CMR Md. 32** — uluslararası taşımada 1 yıllık zamanaşımı. Ama bir teslimat
  anlaşmazlığının **kanıtı ePOD'dur** (imza, fotoğraf, an ve yer damgası,
  migration 080) ve o kayıt **değişmezdir ve silinmez**. Ham iz, o kaydın ara
  ürünüdür. Anlaşmazlık pratikte ilk haftalarda çıkar; çeyrek yıl operasyonel
  olarak yeter.
- **CNIL (Fransa)** ham konum verisi için **2 ay**.
- **Garante (İtalya)**, Ocak 2025: **50.000 €** — 50 çekicide GPS mola
  sırasında açık kalmış ve konum **180 gün** saklanmış (Md. 5, 13, 88).
- **Almanya**: **400** ve **150 gün** orantısız bulundu.

90 gün bu bandın alt yarısında. Kıyas için rakiplerin **varsayılanı**:
**Geotab 2 yıl** · **Verizon Connect 13 ay** · **Samsara "müşteri olduğun
sürece"** (ayrıntı: [`docs/RAKIP-GDPR.md`](RAKIP-GDPR.md)).

> ⚠️ Bu 90, **yasal bir çıpa değildir**. Yasal çıpa §3'teki tabloda durur ve
> bugün boştur.

---

## 5 · Ham veri ≠ türetilmiş veri

Ham iz silinse bile şunlar **yaşar**: vardiya (`time_entries`), alarm
(`vehicle_events`), rölanti (`idle_episodes`), bölge ziyareti (`zone_visits`),
sefer, ePOD, ve **aylık özet** (`vehicle_month_metrics`).

### ⚠️ AZG çalışma süresi kaydı 24 ay saklanır — ama o GPS izi değildir

Avusturya iş mevzuatının istediği kayıt **`time_entries` satırıdır**: kim, ne
zaman başladı, ne zaman bitirdi, kaç dakika mola. **Konum dizisi değil.**

Ham izi silmek AZG yükümlülüğünü **etkilemez** — o kayıt ayrı tabloda ve
`yasal_zorunlu` kategoride, yani **silinemez**. İkisini karıştırmak "iş hukuku
gereği GPS izini iki yıl tutmalıyım" gibi **yanlış** bir sonuca götürürdü.

---

## 6 · Katmanlı saklama ve ⚠️ özet neden AYLIK

```
ham iz  ──── elle silinene kadar ────►
   │
   └─► AYLIK ÖZET (araç × ay: km, litre, dolum, kapsama) ── süresiz
```

`buildFuelReport`'un 28 günlük gerçek cevabı **2.602,6 L**. Aynı pencere
parçalanıp toplandığında (HAK61 canlı):

| parça | toplam L | sapma |
|---|---|---|
| **1 gün** | 3.009,9 | **+%15,6** |
| 7 gün | 2.714,0 | +%4,3 |
| **28 gün** | 2.602,5 | **−%0,0** |

İkinci ölçüm (14 günlük pencere): gerçek **1.194,98 L**, günlük parça toplamı
**1.540,1 L** = **+%28,9**.

**Sebep:** yakıt motoru (027 + 052) ardışık okuma **dizisi** üzerinde çalışıyor
— 30 satırlık de-glitch penceresi, 15 dakikalık seri birleştirme. Gün sınırı
diziyi kesiyor; gece yarısını aşan dolum iki kez sayılıyor.

> 🔑 Özet **raporun kendi cevabının dondurulmuş hâlidir**: ay tek pencere
> olarak `buildFuelReport`e verilir ve çıktısı yazılır. İkinci bir hesap yok.
> QA'da fark **0,00 L** ölçüldü.

---

## 7 · Ne kurtarılır, ne kurtarılmaz

Silmenin etkisi **10 yüzeyde tek tek ölçüldü**.

| Yüzey | Ham silinince | Kurtaran |
|---|---|---|
| Mevzuat erken uyarı | ✅ etkilenmez | — |
| Bölge ziyaretleri | ✅ etkilenmez (`zone_visits` kalıcı) | — |
| €/km maliyet | ✅ payda `time_entries`ten | km dondurma |
| Skor — ceza payı | ✅ `vehicle_events` durur | — |
| Skor — km paydası | ⚠️ ham odometreden | km dondurma |
| Yakıt · CO₂ | ⚠️ ham diziden | ✅ aylık özet |
| Sefer kârlılığı | ⚠️ ham odometre uçlarından | ay granülerliğinde |
| Haftalık K3 "sessiz araç" | 🔴 araç listeden **düşerdi** | ✅ ömür izi |
| **Rota geçmişi** | 🔴 **boşalır** | ❌ **KURTARILAMAZ** |

### 🔴 Rota geçmişi bilinçli olarak kurtarılmıyor

Bir ayın konum dizisini özet tablosunda saklamak, **"ham izi sakla" demenin
başka bir yolu** olurdu. Rota, ham silindiğinde **gerçekten kaybolur**; ürünün
borcu onu kurtarmak değil, **kaybolduğunu söylemek**.

### 🔴 Sessiz araç uyarısı — silmenin en ters sonucu

Haftalık kural K3 ve "sessiz cihaz" alarmı aracın **son ham satırının yaşına**
bakıyor. Uzun süre susmuş bir aracın satırları silinince o araç uyarı
listesinden **sessizce düşerdi** — **en çok ilgilenilmesi gereken araç görünmez
olurdu**. `vehicle_telemetry_lifetime` ilk/son anı ham akıştan **bağımsız**
tutar ve o tablo yazılmadan silme **reddedilir**.

---

## 8 · 🔴 Silmeden önce düzeltilen kusur

Ham veri **olmayan** bir pencerede bugünkü davranış ölçüldü
(01.03→01.04.2026, HAK61 canlı):

```
buildFuelReport → available:true · totalConsumedLiters:0 · 29 araç · hasData 0
buildCostReport → totalEur:0 · fuelEur:0
co2Panosu       → kg:null · 29 plaka "ölçülemedi"        ← DOĞRU olan bu
```

Yakıt ve maliyet raporu **ölçülmemiş bir dönemi "0 L · 0,00 €" diye olgu gibi
basıyordu.** Silme yapıldığında bu kusur, **gerçek veriyi uydurma sıfıra
çeviren bir makineye** dönüşür.

**Düzeltildi:** ölçülen araç 0 iken KPI **"—" + "ölçülemedi"** yazıyor ·
maliyete geçen litre `measured > 0` kapısından geçiyor · PDF'te *"nicht
messbar"* · pencere elde bulunan verinin başlangıcından öncesine uzanıyorsa
**kapsam şeridi** çıkıyor.

⚠️ Kapsam şeridinin çıpası **uyarı eşiği değil, verinin gerçek başlangıcıdır**:
otomatik silme olmadığı için "90 günden eski veri yok" varsayımı yanlış olurdu.

---

## 9 · Elle silme nasıl çalışır

```
1 · ARALIK SEÇ     hafta · ay · iki tarih arası
2 · KURU MOD       "şu kadar satır silinecek" — hiçbir şey silinmez
3 · HAZIRLIK       ömür izi + aylık özet + km dondurma (eksikse)
4 · SEBEP          zorunlu, en az 10 karakter
5 · ÇİFT ONAY      kutuya elle "SIL" yazılır
6 · SİL            önce denetim izi yazılır, sonra silinir
```

### Altı kapı — hepsi geçilmeden silme olmaz

| Kapı | Neyi korur |
|---|---|
| kategori silinebilir mi | yasal zorunlu veriyi |
| aralık geçerli mi | geleceğe uzanan / 400 günden uzun aralığı |
| onay metni "SIL" mi | kazara tıklamayı |
| sebep yeterli mi | izsiz silmeyi |
| ömür izi yazıldı mı | sessiz araç uyarısını |
| aralığın ayları özetlendi mi | yakıt / CO₂ / kârlılık raporlarını |
| aralığın vardiyaları donduruldu mu | km yargısını |

### ⚠️ Sıra tartışma dışı

`km_dondu` adımı silmeden **önce** yapılmalıdır. Sonra yapılırsa ham zaten
gitmiş olur ve dondurma her sıfır-farklı vardiyaya sessizce "ölçülemedi"
yazar — **düzeltmek istediği hatayı kalıcılaştırır.** Ve o bayrak yöneticinin
seçtiği aralıktaki Excel ve Almanca PDF çıktısına kadar gider.

### ⚠️ İz ÖNCE yazılır

Silme geri alınamaz; denetim izi yazılamıyorsa silme de olmaz. Tersi sıra,
izsiz bir silme bırakabilirdi.

---

## 10 · Bugünkü durum (26.08.2026, HAK61)

| | |
|---|---|
| `device_telemetry` | **1.611.074 satır** |
| En eski kayıt | **13.07.2026 = 44 gün** |
| Uyarı eşiğini (90 gün) geçen satır | **0** |
| Otomatik silme | **yok — mimaride de yok** |

Bugün uyarı çıkmıyor. Önceki durum: görünürlük **yoktu** — 44 gün CNIL
çıtasının altındaydı ama bu bir politika değil bir **tesadüftü** ve kimse
haberdar olmuyordu.

---

## 11 · Zusammenfassung (Deutsch)

**Das System löscht nichts automatisch.**

**Galzura ist Auftragsverarbeiter. Aufbewahrungsfrist und Löschentscheidung
liegen beim Verantwortlichen (Kunde).** Der nächtliche Lauf **rechnet und
warnt nur**; gelöscht wird ausschließlich manuell über `/admin/saklama`, mit
selbst gewähltem Zeitraum, Trockenlauf, Pflichtbegründung, doppelter
Bestätigung und vollständigem Prüfprotokoll.

**Datenkategorien.** Jede Tabelle fällt in eine von drei Kategorien:
*personenbezogen* (Warnung, löschbar), *Fahrzeugdaten* (frei),
*gesetzlich vorgeschrieben* (**nicht löschbar — die Oberfläche bietet keine
Option**). Rechtliche Grundlage: **die GPS-Spur ist rechtlich das
personenbezogene Datum der fahrenden Person, nicht des Fahrzeugs.** Dass das
Fahrzeug der Firma gehört, ändert daran nichts; entscheidend ist, **wer zu
diesem Zeitpunkt im Fahrzeug saß**.

**Gesetzliche Anker: Tabelle bewusst LEER.** `saklama_esikleri` wird angelegt,
aber ohne Werte. `esik_gun = NULL` bedeutet: *für dieses Land liegt kein
verifizierter Anker vor* — die Oberfläche nennt dann **keine Zahl**. Die Werte
werden in einer eigenen Recherche mit Quelle und Prüfdatum ergänzt; eine
erfundene Zahl würde Haftung auslösen.

**Warnschwelle 90 Tage (löscht nichts).** Begründung: CMR Art. 32 (Beweis ist
der unveränderliche Liefernachweis, nicht die Rohspur) · CNIL: 2 Monate ·
Garante (Italien) 01/2025: 50.000 € bei 180 Tagen Aufbewahrung · Deutschland:
400 und 150 Tage unverhältnismäßig. Zum Vergleich: Geotab 2 Jahre, Verizon
Connect 13 Monate, Samsara „solange Sie Kunde sind".

**Gestufte Aufbewahrung:** Rohdaten → **monatliche Zusammenfassung**
unbefristet. Monatlich, weil eine tagesweise Aggregation den
Kraftstoffverbrauch messbar um **15,6–28,9 %** überschätzt.

**Nicht wiederherstellbar:** die **Streckenwiedergabe** — bewusst, denn eine
Monatsspur der Positionen zu speichern hieße, die Rohspur unter anderem Namen
aufzubewahren.

---

## 12 · Summary (English)

**The system never deletes anything automatically.**

**Galzura is the processor. The retention period and the decision to delete
belong to the controller (the customer).** The nightly job only **calculates
and warns**; deletion happens solely through `/admin/saklama` — a
user-selected range, a dry run, a mandatory reason, a typed second
confirmation, and a full audit trail.

**Data categories.** Every table falls into one of three: *personal data*
(warned, deletable), *vehicle data* (free), *legally required* (**not
deletable — the interface does not even offer the option**). Legal basis: **a
GPS trail is legally the personal data of the person driving, not of the
vehicle.** The vehicle belonging to the company does not change that; the
deciding question is **who was in the vehicle at the time**.

**Legal anchors: table deliberately EMPTY.** `saklama_esikleri` is created
without values. `esik_gun = NULL` means *no verified anchor exists for this
country* — and the interface then states **no figure at all**. The values will
be filled in a dedicated research round with a source and a verification date;
an invented number would create liability.

**Warning threshold: 90 days (deletes nothing).** Rationale: CMR Art. 32 (the
evidence is the immutable proof of delivery, not the raw trail) · CNIL: 2
months · Garante (Italy) 01/2025: €50,000 over a 180-day retention · Germany:
400 and 150 days disproportionate. For comparison: Geotab 2 years, Verizon
Connect 13 months, Samsara "as long as you are a customer".

**Tiered retention:** raw data → **monthly summary** kept indefinitely.
Monthly, because daily aggregation overstates fuel consumption by a measured
**15.6–28.9 %**.

**Not recoverable:** **route replay** — deliberately, since storing a month of
positions would be keeping the raw trail under another name.

---

## 13 · Kapılar

| İşlem | Kapı |
|---|---|
| Ekranı görmek | `requireAdmin` — **filo şefine kapalı** |
| Uyarı eşiğini değiştirmek | `requireAdmin` + denetim izi (eski→yeni) |
| Hazırlığı yürütmek | `requireAdmin` — **hiçbir satır silmez** |
| **Silmek** | `requireAdmin` + altı kapı + çift onay + `saklama_silme_izi` |
| Cron | `CRON_SECRET` — **ve o uç zaten silmiyor** |

---

## 14 · Cron kaydı

`docs/CRON-KAYITLARI.md` 9. iş. Günde bir kez, gece.

```
GET https://<dağıtım>/api/cron/saklama?secret=<CRON_SECRET>
```

**Bu uç hiçbir şey silmez.** İki iş yapar: cihaz ömür izini tazeler ve uyarı
üretir. Gövdede `silmeYapildi: false` alanı bilerek vardır — gövdeyi okuyan
yanılmasın.

`?kuru=1` ömür izini bile yazmaz, yalnız okur.

---

## 15 · Prova (QA harness) — 165 iddia

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
npm run verify:saklama                   # 128 iddia — motor
npm run build && npx next start -p 3300 &
node scripts/verify-saklama-ekran.mjs    # 37 iddia — ekran
```

### 🔴 Cron hiçbir şey silmiyor — ölçüldü

| Tur | Sonuç | Satır |
|---|---|---|
| sırsız | HTTP 401 | 1.000 |
| `?kuru=1` | `silmeYapildi:false` · uyarı: 600 satır / 147 gün / **çıpa null** | 1.000 |
| gerçek tur 1 | `silmeYapildi:false` · ömür izi 2 araç yazıldı | **1.000** |
| gerçek tur 2 | aynı | **1.000** |
| gerçek tur 3 | aynı | **1.000** |

### 🔑 Elle silme ÖNCE/SONRA

Tohum: 2 cihazlı + 1 cihazsız araç · **1.000 ham satır** (600 nisan, 400
ağustos) · 3 vardiya.

| Ölçüm | ÖNCE | SONRA | Karar |
|---|---|---|---|
| Ham satır — nisan | 600 | **0** | seçilen aralık silindi |
| Ham satır — ağustos | 400 | **400** | dokunulmadı |
| Yakıt raporu — ağustos | 146,4 L | **146,4 L** | ✅ değişmedi |
| Yakıt raporu — nisan | 207,6 L | **`null` · ölçülen 0** | ✅ **"ölçülemedi"**, 0 L DEĞİL |
| **Aylık özet** — nisan | 207,6 L | **207,6 L** | ✅ ham gittikten sonra ayakta |
| Vardiya km (fark var) | — | **ölçüldü** | ✅ donduruldu |
| Vardiya km (fark yok + hareket var) | — | **ölçülemedi** | ✅ ham olmadan üretilemezdi |
| Ömür izi — nisan | — | **biliniyor** | ✅ sessiz araç uyarısı yaşıyor |
| Türetilmiş kayıtlar | 3 | **3** | ✅ silinmedi |

Özet ile raporun cevabı arasındaki fark **0,00 L**.

### Çift onay ve kapı kanıtı

| Deneme | Sonuç | Silinen |
|---|---|---|
| ön koşullar eksik | `engel: omur_izi_yok` | **0** |
| kuru mod | "600 satır silinecek" | **0** |
| onay metni `"evet sil"` | `engel: onay_yanlis` | **0** |
| sebep `"kisa"` | `engel: sebep_kisa` | **0** |
| aralık geleceğe uzanıyor | `engel: aralik_gecersiz` | **0** |
| reddedilen denemeler | denetim izine **yazılmadı** (0 kayıt) | — |
| altı kapı da açık + `"SIL"` | ✅ | **600** |

Denetim izinde: **kim** (QA Sofor Bir) · **ne zaman** · **hangi tablo** ·
**kategori** · **aralık** (01.04 → 01.05) · **kaç satır** (600) · **sebep**.

### Kategori kanıtı

- `device_telemetry` → **kişisel** · `time_entries` → **yasal zorunlu**
- Sınıflandırılmamış tablo → **fail-closed `yasal_zorunlu`**
- Silme seçicisinde `time_entries`, `teslimat_kanitlari`, `saklama_silme_izi`
  **`<option>` olarak hiç yok** (HTML'de doğrulandı)

### Yasal çıpa kanıtı

- Tablo **boş** → ekran *"HENÜZ DOĞRULANMADI — bilerek sayı yazmıyoruz"*
- Kaynaklı satır yazılınca → **"60 gün"** + dayanak görünüyor
- **Kaynaksız eşik veritabanınca reddedildi** (`CHECK saklama_esikleri_kaynakli`)

### Bu provanın yakaladığı kusurlar

1. **🔴 SIFIR satırlı tablo uyarı olarak basılıyordu.** `uyarilar()` kişisel
   kategorideki her ham tabloyu döndürüyor; `driver_locations` bugün 0 satır
   ve ekran *"0 satır ham konum veriniz eşiği geçti"* diye kendi içinde
   çelişkili bir uyarı üretiyordu. `uyariVarMi` süzgeci eklendi.
2. **`"use server"` dosyasının her export'u async olmalı** — `araligiCoz`
   build'i düşürdü; saf katmana taşındı (zaten oraya aitti).
3. **`driver_locations.created_at` yok** — kolon adı `recorded_at`. Canlı
   şemaya sorularak düzeltildi; yazıldığı gibi kalsaydı **42703** ile düşerdi.
4. **`start_source` CHECK'i** — tohum `'manual'` yazıyordu; izinli küme
   `self|auto|admin|chief`.
5. **`mapBounded` argüman sırası** `(items, fn, limit)`.
6. **🔴 `NEXT_PUBLIC_*` derleme anında gömülür** — üretim env'iyle derlenmiş
   `next start`, QA anahtarını **gerçek Supabase'e** gönderdi ve *"Invalid API
   key"* aldı. QA yığınına bakan sunucu için **QA env'iyle yeniden derlemek**
   şart.
7. **Ölü sunucu portu tutuyordu** — `EADDRINUSE` sessizce logda kalmış, eski
   süreç cevap veriyordu; "düzeltme işe yaramadı" yanılgısı oradan çıktı.
8. **İki yanlış-negatif iddia:** `"400 satır"` metni `"0 satır"`ı alt dizi
   olarak içeriyor (sayı sınırı eklendi); ve şerit regex'i `href`in `class`tan
   önce geldiğini varsayıyordu (Next tersini basıyor).
9. **🔴 Python kaçışı `\b`'yi gerçek backspace karakterine çevirdi** — regex
   hiç eşleşmedi ve kod yanlış sanıldı. Tüm 090 dosyaları kontrol karakterine
   karşı tarandı, temiz.
