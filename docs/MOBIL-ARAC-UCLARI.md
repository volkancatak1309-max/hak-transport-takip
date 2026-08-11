# Mobil araç uçları (U1–U6) — sözleşme + canlı ölçüm

> Dal: `feat/mobil-arac-uclari` · Ölçüm anı: **11.08.2026 02:0x Viyana** (10.08.2026 ~00:0x UTC)
> Kaynak: canlı HAK61 (service-role, **salt okuma**). Ölçülemeyene **ÖLÇÜLMEDİ** yazıyor.
> Gizlilik: plakalar maskeli, koordinatlar nötr başlangıca taşınmış — sayı ilişkileri aynı.

Beş yeni GET ucu + bir alan. Hepsinin kapısı **`requireMobileAdmin`** — kardeş uç
`GET /api/mobile/vehicles/[id]` ile aynı katman; filo şefi panelde `/admin/araclar`a
giremediği için burada da **403 `admin_required`** alır (bilinçli parite).

Ortak kurallar:

| | |
|---|---|
| Gün ekseni | `tarih=YYYY-MM-DD` **kiracı takvim günü**dür. Sınır `lib/tz.ts` → `lib/format.ts`, DST-güvenli. Verilmezse bugünün kiracı günü; verilip geçersizse `400 invalid_date`. |
| Saat dilimi | Her yanıt `saatDilimi` taşır (`"Europe/Vienna"`). Uçta sabit YOK. |
| Araç yok | `404 not_found` |
| Ölçülemeyen sayı | `null` — **asla 0**. Sebebi ayrı alanda yazar. |
| Kırpma / seyreltme | Sessiz değil: `toplamNokta` / `nokta` / `orneklendi` ile söylenir. |

---

## U1 · `GET /api/mobile/vehicles/[id]/gunler?n=14`

Rota ekranının **gün hapları**. "Veri olan gün" = o kiracı gününde **en az bir**
telemetri noktası. Noktası sıfır olan gün **listeye girmez**.

`n` 1..14 arasına kırpılır; yanıt baktığı pencereyi `pencere.gun` + `pencere.enFazla`
ile söyler.

**Neden gün gün sayıyor:** keşif belgesi 5b — aynı sayımın **filo geneli** hâli
1,07 M satırlık tabloda `57014 statement timeout` verdi. Bu uçta her sorguda
`vehicle_id` eşitliği var; `(vehicle_id, recorded_at)` indeksi taranıyor.
Gün başına 2 sorgu (`count` + en erken satır, sonra en geç satır), eşzamanlılık
`mapBounded(6)`.

**ÖLÇÜLDÜ** — 14 gün, tek araç: **634 ms**, 14/14 günde veri, 0 zaman aşımı.
İkinci araçta 747 ms, verisiz araçta (`DO-***GS`, son 14 günde 0 nokta) 302 ms
ve `gunler: []`.

```json
{
  "ok": true, "aracId": "…", "plaka": "DO-***GR", "saatDilimi": "Europe/Vienna",
  "pencere": { "gun": 14, "enFazla": 14, "ilkGun": "2026-07-29", "sonGun": "2026-08-11" },
  "gunler": [
    { "tarih": "2026-08-11", "nokta": 2,    "ilk": "2026-08-10T22:50:45+00:00", "son": "2026-08-10T23:50:45+00:00" },
    { "tarih": "2026-08-10", "nokta": 2243, "ilk": "2026-08-09T22:49:31+00:00", "son": "2026-08-10T21:50:45+00:00" },
    { "tarih": "2026-08-09", "nokta": 24,   "ilk": "2026-08-08T22:49:31+00:00", "son": "2026-08-09T21:49:31+00:00" },
    { "tarih": "2026-08-08", "nokta": 2142, "ilk": "2026-08-07T22:47:21+00:00", "son": "2026-08-08T21:49:31+00:00" }
  ],
  "olculemeyen": []
}
```

⚠️ **24 noktalık gün "sürüş günü" değildir.** Cihaz park hâlindeyken saatlik nabza
düşüyor; o gün "veri olan gün"dür ama rotası boştur. Uç gün eleme kararı VERMEZ —
`nokta` taşınır, ayrımı ekran yapar (ör. hapı silik çiz).

`olculemeyen[]`: sorgusu düşen gün listeden **sessizce düşmez**, adıyla ve
sebebiyle (`zaman_asimi` / `hata`) burada durur. Canlıda 0 kayıt görüldü.

---

## U2 · `GET /api/mobile/vehicles/[id]/rota?tarih=…&eslesme=0|1`

Trip replay'in ana ucu. Veri: `getVehicleDeviceRoute` — **panelin rota sayfasının
okuduğu fonksiyonun aynısı**, 900 nokta tavanı ve "ilk+son korunur" seyreltmesiyle.

**Bu turda düzelen kusur:** `listVehicleTrack` `speed_kmh` ve `ignition_on`u hep
seçiyordu; `getVehicleDeviceRoute` ikisini de `.map()` içinde **atıyordu**
(`lib/route-history.ts:156`). Alt şeritteki km/h ve durum çipi bunlara bağlı.
Düzeltme additive: panelin `RouteReplay`'i iki alanı da okumuyor, o ekran değişmedi.
**ÖLÇÜLDÜ:** 900/900 noktada `hizKmh` ve `kontak` dolu.

**OSRM varsayılan olarak KAPALI.** Yol eşlemesi 6 sn'lik dış bağımlılıktır;
`eslesme=1` denmedikçe `geometri: null` döner ve istemci `noktalar`ı çizer.
`eslesme=1`de eşleme denenir, başarısızsa `eslendi:false` + ham çizgi (uç hata vermez).

**ÖLÇÜLDÜ** — yoğun bir gün: 4113 ham nokta → 900 çizilen, `orneklendi:true`, ~3,0 sn.

```json
{
  "ok": true, "plaka": "DO-***HF", "tarih": "2026-08-07", "saatDilimi": "Europe/Vienna",
  "toplamNokta": 4113, "nokta": 900, "orneklendi": true, "yonlu": true,
  "eslesmeIstendi": false, "eslendi": false, "geometri": null,
  "baslangic": { "lat": 47.5000, "lng": 9.7000, "an": "2026-08-06T22:05:20+00:00", "hizKmh": 0, "yon": 0, "kontak": false },
  "bitis":     { "lat": 47.4999, "lng": 9.7005, "an": "2026-08-07T21:11:58+00:00", "hizKmh": 0, "yon": 0, "kontak": false },
  "noktalar": [ { "lat": 47.4997, "lng": 9.6998, "an": "…", "hizKmh": 9, "yon": 131, "kontak": true } ]
}
```

### ✅ Pencere düzeltildi (11.08.2026, onaylandı)

`getVehicleDeviceRoute` günü artık **kesin kiracı-gün penceresinde** okuyor
(`gunPenceresi(date)`); eskiden ±1 günlük UTC parantezinde okuyup `viennaDayKey`
ile süzüyordu — yani üç günün satırlarını çekip ikisini atıyordu. **Panelin rota
sayfası da bu fonksiyonu çağırıyor**, o yüzden denklik dizi düzeyinde ölçüldü.

**ÖLÇÜLDÜ** — gerçek `getVehicleDeviceRoute` Node'da çağrıldı (sorgu yolu taklit
edilmedi), 5 araç-gün, her biri 3 tur; karşılaştırma nokta **dizisi** üzerinden
(an · konum · hız · kontak · yön, elemanı elemanına):

| araç | gün | nokta önce/sonra | küme | süre (medyan) |
|---|---|---|---|---|
| DO-***HF | 2026-08-07 | 4113 / 4113 | **AYNI** | 2.180 → **686 ms** (3,2×) |
| DO-***GR | 2026-07-31 | 3055 / 3055 | **AYNI** | 1.641 → **542 ms** (3,0×) |
| DO-***GS | 2026-08-01 | 3085 / 3085 | **AYNI** | 669 → **542 ms** (1,2×) |
| DO-***HF | 2026-08-11 | 2 / 2 | **AYNI** | 120 → **89 ms** |
| DO-***GS | 2026-08-10 | 0 / 0 | **AYNI** | 123 → 127 ms |

Okunan satır (yoğun gün): **10.954 → 4.113**. `viennaDayKey` süzgeci kaldırıldı —
artık hiçbir şeyi elemiyor ve satır başına bir `Intl` çağrısıydı.

Yan kazanç: ayrıştırılamayan tarih artık **boş gün** döndürüyor. Eskiden
`new Date("çöp").toISOString()` `RangeError` atıyor ve `?date=` elle düzenlenince
panel sayfası komple düşüyordu.

⚠️ Teorik tek fark: sorgu `.lte(gün sonu)` ile kapanıyor, gün sonu milisaniye
çözünürlüğünde. `23:59:59.9991`–`.9999` bandındaki bir satır eskiden gelirdi.
`device_telemetry` damgaları santisaniye çözünürlüğünde (`"04:50:08.01"`) — o
bantta satır üretilemez. Beş araç-günün beşinde de fark 0.

**ÖLÇÜLMEDİ:** DST gününde denklik. `device_telemetry`'nin en eskisi 13.07.2026,
en yakın geçişler 29.03 (geçmiş, veri yok) ve 25.10 (gelecek). DST sınırı
`scripts/check-arac-uclari.mjs` içinde 23/24/25 saatlik pencerelerle sınanıyor.

---

## U3 · `GET /api/mobile/vehicles/[id]/olaylar?tarih=…`

Nokta olayları (`vehicle_events`) + rölanti epizodları (`idle_episodes`) **tek listede,
saate göre**. Dönüşüm `/api/mobile/shifts/[id]`in alarm bloğuyla birebir aynı
(`lib/vehicle-day.ts` `gunOlaylari`) — tek fark pencerenin vardiya değil gün olması.

🔴 **HIZ LİMİTİ ALANI YOK ve üretilmeyecek.** Depoda hız limiti ne kolon, ne sabit,
ne cihazdan okunabilen bir eşik. `kalemler[].hizKmh` **aracın o andaki hızıdır**.
**ÖLÇÜLDÜ:** `overspeeding` satırlarında `speed_kmh` kolonu ile `event_value.speed`
**birebir aynı** sayı (60/60 satır, son 7 gün). Referans tasarımdaki "limit 100"
çipi bu veriyle çizilemez.

Rölanti süresi = `(ended_at ?? last_seen_at) − started_at` **+ `IDLE_TRIGGER_S`**
(300 sn): cihaz bayrağı fiziksel duruştan o kadar sonra kalkıyor.

**ÖLÇÜLDÜ** — 104 olay / 0 epizod, 93 ms.

```json
{
  "ok": true, "plaka": "DO-***HF", "tarih": "2026-08-07",
  "pencere": { "baslangic": "2026-08-06T22:00:00.000Z", "bitis": "2026-08-07T21:59:59.999Z" },
  "adet": 104, "kritikAdet": 1,
  "turDagilim": { "harsh_acceleration": 91, "harsh_cornering": 8, "harsh_braking": 4, "overspeeding": 1 },
  "kalemler": [
    { "id": "…", "tur": "overspeeding", "an": "2026-08-07T04:50:08.01+00:00",
      "konum": { "lat": 47.3906, "lng": 9.6474 }, "hizKmh": 137, "deger": { "speed": 137 },
      "sureMs": null, "devamEdiyor": false, "siddet": "warning", "kademe": "kritik" }
  ]
}
```

`kademe` tek kaynaktan gelir (`lib/event-ui.ts` `ALARM_KADEME`): `overspeeding`
**kritik**, sert sürüş **uyarı**, rölanti **rutin**. App'teki kopya buna uymalı.

---

## U4 · `GET /api/mobile/vehicles/[id]/duraklar?tarih=…`

Haritadaki **P işareti**. `lib/metrics-trips.ts` `computeTripsAndStops` depoda
yazılıydı ama **hiçbir yerden çağrılmıyordu**; bu uç onun ilk tüketicisi.

Eşikler **yanıtta** taşınır (`esikler`), istemciye kopyalanacak sabit değil:
hareket < 3 km/h, en az duruş 3 dk, yarıçap 40 m, veri boşluğu 15 dk.

**ÖLÇÜLDÜ** — 4113 nokta → 14 durak, 15 sefer, 109,05 km; hesap 3 ms.

```json
{
  "ok": true, "plaka": "DO-***HF", "tarih": "2026-08-07",
  "noktaSayisi": 4113, "belirsiz": true, "bosluk": 16, "toplamSeferKm": 109.05,
  "esikler": { "hareketHizKmh": 3, "enAzDurusMs": 180000, "yaricapM": 40, "enFazlaBoslukMs": 900000 },
  "duraklar": [
    { "baslangic": "2026-08-07T08:00:36+00:00", "bitis": "2026-08-07T08:04:08+00:00",
      "sureMs": 212000, "lat": 47.2846, "lng": 9.5899 }
  ],
  "seferler": [
    { "baslangic": "2026-08-06T22:05:20+00:00", "bitis": "2026-08-07T08:00:36+00:00",
      "sureMs": 35716000, "km": 33.31, "baslangicLat": 47.4985, "baslangicLng": 9.7323,
      "bitisLat": 47.2847, "bitisLng": 9.5899 }
  ]
}
```

⚠️ **GECE PARKI DURAK OLARAK ÇIKMAZ.** Cihaz park hâlindeyken saatlik nabza
düştüğü için ardışık duruş noktaları arasındaki fark 15 dk'lık boşluk eşiğini
aşıyor; küme oluşmuyor. Sonuç yukarıda görülüyor: ilk "sefer" 9,9 saat sürüyor
ama yalnız 33 km taşıyor (boşluklar köprülenmediği için km doğru, **süre
yanıltıcı**). `belirsiz:true` ve `bosluk:16` bunu söylüyor — ekran gün-içi
duraklara güvenmeli, gece boşluğunu "hareket" diye okumamalı.
Eşik değiştirmek `lib/metrics-trips.ts`in işi; bu turda **dokunulmadı**.

---

## U5 · `GET /api/mobile/vehicles/[id]/metrikler?tarih=…`

"Bugün" kutularının mobilde eksik üçü. Panelin araç detayında **yan yana çağrılan**
üç fonksiyon, tek iz üzerinden: `computeEngineHours` · `computeDistanceKm` ·
`computeIdleTime`.

**Hesaplanamayan sıfır değildir.** Kapılar:

| durum | motorDk | gpsKm | rolantiDk | sebep |
|---|---|---|---|---|
| nokta < 2 | `null` | `null` | `null` | `veri_yok` |
| hiç `ignition_on` yok | `null` | ölçülür | `null` | `kontak_yok` |
| hiç `speed_kmh` yok | ölçülür | ölçülür | `null` | `hiz_yok` |
| park (kontak var, kapalı) | **0** | **0** | **0** | `var` — sıfır GERÇEK |

**ÖLÇÜLDÜ** — dolu gün ve verisiz araç:

```json
{ "ok": true, "plaka": "DO-***HF", "tarih": "2026-08-07",
  "noktaSayisi": 4113, "belirsiz": true,
  "motorDk": 87, "motorMs": 5247920, "gpsKm": 107.96,
  "rolantiDk": 0, "rolantiMs": 0, "rolantiOlay": 0,
  "sebep": { "motor": "var", "gps": "var", "rolanti": "var" },
  "ayrinti": { "bosluk": 17, "kirpilanKontak": 0, "sicrama": 52, "titresim": 2076, "rolantiBosluk": 22 } }
```

```json
{ "ok": true, "plaka": "DO-***GS", "tarih": "2026-08-10",
  "noktaSayisi": 0, "belirsiz": false,
  "motorDk": null, "motorMs": null, "gpsKm": null,
  "rolantiDk": null, "rolantiMs": null, "rolantiOlay": null,
  "sebep": { "motor": "veri_yok", "gps": "veri_yok", "rolanti": "veri_yok" },
  "ayrinti": { "bosluk": 0, "kirpilanKontak": 0, "sicrama": 0, "titresim": 0, "rolantiBosluk": 0 } }
```

⚠️ **`gpsKm` ≠ `bugun.km`.** `/api/mobile/vehicles/[id]` içindeki `bugun.km`
ŞOFÖRÜN girdiği sayaçtan gelir ve açık vardiyada `null`dur; buradaki `gpsKm`
cihazın konum serisinden türer. Aynı gün için farklı sayı verebilirler ve bu
hata DEĞİLDİR — aynı kutuya yazılmamalı.

⚠️ **`motorDk` sistematik olarak EKSİK sayıyor.** Cihaz hareket hâlindeyken de
`ignition_on: false` bildirebiliyor. **ÖLÇÜLDÜ** (son 7 gün, filo geneli): hızı
20 km/h üstündeki 88.935 satırın **6.624'ünde (%7,4)** kontak kapalı görünüyor.
`computeEngineHours` bu aralıkları saymıyor. Panelde de aynı sayı çıkıyor (aynı
fonksiyon) — bu turda **düzeltilmedi**; düzeltme bir sezgisel kural icat etmek
demek olurdu ve o ayrı bir karardır.

**`kontak_yok` / `hiz_yok` yolları canlı veriyle ÖLÇÜLEMEDİ:** son 7 günün
287.789 satırında `ignition_on` null **0**, `speed_kmh` null **0**. İki yol da
`scripts/check-arac-uclari.mjs` içinde sentetik girdiyle sınanıyor.

---

## U6 · `cihaz.ad` — `GET /api/mobile/vehicles/[id]`

Künyedeki "Takip cihazı" satırı.

**ÖLÇÜLDÜ (11.08.2026, ikinci tur): `vehicles.device_model` kolonu artık CANLIDA
VAR** — migration 055 çalıştırılmış. Doluluk **0/30**. Uçtan uca doğrulandı:
gerçek `getVehicleDetail` çağrıldı, `device_model` anahtarı çıktıda **var**,
değeri `null` → `cihaz.ad: null`. Yani hat açık, veri bekliyor.
(İlk turda kolon yoktu — `42703` — ve uç yine `null` döndürüyordu; iki durumda da
çökme yok, çünkü `getVehicleDetail` `select("*")` yapıyor.)

DDL:

```sql
alter table public.vehicles
  add column if not exists device_model text;
```

Doldurma **elle**: filodaki 29 cihazın hepsinin FMC003 olduğu doğrulanmadı, ve
doğrulamadan toplu yazmak uydurmayı veriye çevirmek olurdu.

---

## U7 · `POST /api/mobile/vehicles/[id]/ariza-bildir`

Elle arıza bildirimi — mobilin auth dışı **ikinci yazma ucu** (birincisi şoför
paket girişi). Tablo: `vehicle_fault_reports`, **migration 056** (11.08.2026'da
Volkan tarafından çalıştırıldı, canlıda).

**Neden `vehicle_dtc`'ye yazmıyor:** o tablo cihazın gerçeğidir ve flespi akışı
her anlık görüntüde onu uzlaştırır (`saveDtc` + `reconcileDtc`). Elle girilen
satır bir sonraki senkron turunda `cleared_at` ile kapanır ya da kaybolur —
bildirim **sessizce yok olurdu**. İki kaynak aynı ekranda yan yana
gösterilebilir; aynı satırda değil.

**Yazma anahtarlı:** `vehicle_id` **yoldan**, `reported_by` **oturumdan** gelir.
Gövdenin tek alanı `aciklama`. `durum` gövdeden alınmaz — yeni bildirim tanım
gereği `acik`tır. Yani "başkası adına, başka araca bildirim" isteği
**kurulamaz**; alanları yok. **ÖLÇÜLDÜ:** gövdeye `durum:"kapali"`,
`vehicle_id:"baska"`, `reported_by:"baska"` konarak istek atıldı — üçü de yok
sayıldı, satır yoldan/oturumdan doldu.

```jsonc
// istek
POST /api/mobile/vehicles/<uuid>/ariza-bildir
{ "aciklama": "Rölantide titreşim ve şanzımandan ses geliyor." }

// 201
{ "ok": true,
  "bildirim": {
    "id": "70309a4b-…", "aracId": "0d0d8175-…", "plaka": "TEST-001",
    "bildirenId": "a8e793e9-…",
    "aciklama": "Rölantide titreşim ve şanzımandan ses geliyor.",
    "durum": "acik", "olusturma": "2026-08-11T01:10:28.807324+00:00" } }
```

| ret | kod | not |
|---|---|---|
| token yok / bozuk | `401 missing_token` · `401 invalid_token` | |
| yönetici değil | `403 admin_required` | kardeş araç uçlarıyla aynı kapı |
| araç yok | `404 not_found` | FK hatasının 503'e düşmesini önler |
| gövde JSON değil | `400 invalid_json` | |
| `aciklama` alanı yok | `400 missing_fields` | |
| string değil | `400 invalid` + `sebep:"tip"` | |
| trim sonrası boş | `400 invalid` + `sebep:"bos"` | `"   "` boş bildirimdir |
| 2000 karakterden uzun | `400 too_long` + `enFazla` + `uzunluk` | **kesilmez, reddedilir** |
| tablo yok (056 uygulanmamış) | `503 db_error` + `sebep:"tablo_yok"` | `yazma_hatasi`'ndan ayrı |

Sınır **şemada değil uçta** (`lib/fault-reports.ts` `ARIZA_ACIKLAMA_MAX`): bir
ürün kararıdır, her fikir değişikliğinde migration gerektirmemeli. Karakterle
sayılır, baytla değil — Türkçe bir bildirim İngilizcesinden erken reddedilmez.

**ÖLÇÜLDÜ (canlı HAK61, `TEST-001`):** 22 iddia, gerçek `POST` işleyicisi
çağrılarak (kapı dahil uçtan uca). Yazma 310 ms. Reddedilen 6 istek tabloya
**hiçbir** satır yazmadı (0 → 0). 3 QA satırı yazıldı, DB'den geri okundu,
**silindi** ve tablonun 0'a döndüğü ölçüldü.

### 🔴 U7'nin AÇIK yanı: okuma yüzeyi YOK

Bugün bu bildirimleri gösteren **hiçbir ekran ve hiçbir okuma ucu yok** — ne
panelde, ne mobilde. Yazılan satır tabloda durur ama kimse görmez; kapatacak
(`durum='kapali'`) bir yüzey de yok. İki eksik de bu turun kapsamı dışındaydı.
En küçük kapatma: `GET /api/mobile/vehicles/[id]` yanıtına
`arizaBildirimleri[]` eklemek — "Arıza Bildir" düğmesinin bulunduğu ekran zaten
o ucu çağırıyor. Karar Volkan'ın.

⚠️ **Hız sınırı (rate limit) yok** — paket ucuyla aynı durum. Kapı yönetici
kimliği olduğu için yüzey dar, ama bu bir sınır değil bir eksiktir.

---

## Doğrulama

| betik | ne yapar | çalıştır |
|---|---|---|
| `scripts/check-arac-uclari.mjs` | **ağ yok.** Uçların saf çekirdeğini (`lib/vehicle-day.ts`) ölçülmüş girdiyle çalıştırır + kaynak denetimi (kapı, saat dilimi sabiti, uydurma alan, kesin pencere). **103 denetim.** | `npm run lint:arac-uclari` (`verify` zincirinde) |
| `scripts/verify-arac-uclari.mjs` | **canlı, salt okuma.** Beş ucun sorgu yolunu birebir tekrarlar, gövdeleri basar, iddiaları ölçer. | `npm run verify:arac-uclari -- <PLAKA> <YYYY-MM-DD>` |
| `scripts/check-ariza-bildir.mjs` | **ağ yok.** U7'nin girdi ayıklamasını (`lib/fault-reports.ts`) çalıştırır + kaynak ve DDL denetimi. **51 denetim.** | `npm run lint:ariza-bildir` (`verify` zincirinde) |
| `scripts/verify-ariza-bildir.mjs` | **canlı, YAZAR ve TEMİZLER.** Gerçek `POST` işleyicisini çağırır (token deponun `issueTokens`'ıyla mühürlenir), test aracına yazar, DB'den okur, siler ve sildiğini ölçer. | `npm run verify:ariza-bildir` |

Sunucu modüllerini Node'da çalıştırmak `scripts/ts-server.mjs` ile: `server-only`
Next'in derleme-anı takma adıdır (node_modules'da yok) → boş modüle yönlendirilir,
`.env.local` `process.env`e yüklenir. **Muhafızların yükleyicisi
(`ts-alias.mjs`) bunu BİLEREK yapmaz:** `check-*` betikleri saf katmana mahkûm
kalmalı; saf katmana bir DB çağrısı sızarsa muhafız çalışmaz olur ve bunu hemen
görürüz.

Muhafızların boş olmadığı **arıza enjeksiyonuyla** kanıtlandı. U1–U5: `motorDk`ın
null kapısı kaldırılınca 3 denetim, `speed: r.speed_kmh` satırı silinince 1
denetim düştü. U7: boş-metin kapısı kaldırılıp kapı `requireMobileWorker`a
gevşetilip `durum` gövdeden okunacak şekilde bozulunca **9 denetim** düştü.
Geri alınınca hepsi geçti. (Enjeksiyon `durum` denetiminin desenini de
düzeltti — dar regex `(body as {...}).durum` sarmalını kaçırıyordu.)

Canlı betiğin U2 bölümü artık **dizi eşitliği** sınıyor: eski ±1 gün parantezi
yolu yeniden kurulup yeni kesin pencereyle elemanı elemanına karşılaştırılıyor.
Sayı eşitliği "aynı küme" demek değildir.
