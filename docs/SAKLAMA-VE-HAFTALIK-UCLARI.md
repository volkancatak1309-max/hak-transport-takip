# Faz D-2/D-3 — Saklama + Haftalık aksiyon mobil uçları

Dal: `feat/saklama-ve-haftalik-uclari` · Ölçüm: **22.09.2026**
Taban: `main 097702c` (üç kiracıda da READY)

---

## 1 · Dört uç

| uç | kapı | çekirdek |
|---|---|---|
| `GET /api/mobile/saklama` | **yönetici** | `saklamaAyari` · `kategoriler` · `uyarilar` · `yasalEsik` · `silmeIzi` |
| `PATCH /api/mobile/saklama` | **yönetici** | `ayarDenetle` + `saklamaAyariYaz` |
| `POST /api/mobile/saklama/on-izleme` | **yönetici** | `manuelSil({kuru:true})` + `hazirlikDurumu` |
| `GET /api/mobile/haftalik` | **fleetView** | `getTur` · `listTurlar` · `kalemKapsamda` |
| `POST /api/mobile/haftalik/[id]/kapat` | **fleetView** | `aksiyonKapat` |

**`araligiSil` mobile AÇILMADI** ve muhafız bunu koruyor (§4).

---

## 2 · 🔴 Görevin üç varsayımı üründe yok — ölçüldü

### 2.1 Kategori başına saklama süresi diye bir alan YOK

Görev "15 veri kategorisi: ad, **saklama süresi** …" ve "`PATCH {kategori, gun}`"
istiyordu. 090'ın gerçek modeli başka:

| görevdeki | üründeki |
|---|---|
| kategori başına gün | **kiracının TEK eşiği**: `tenant_saklama.uyari_gun` (+ `ulke_kodu`) |
| 15 kategori = 15 süre | `veri_kategorileri` bir **sınıflandırma katalogu**: `{tablo_adi, kolon_adi, kategori, gerekce}` — gün alanı taşımaz |
| "silinecek satır tahmini" kategoride | uyarı ve sayım **tablo** ekseninde, ve yalnız `HAM_TABLOLAR = ["device_telemetry","driver_locations"]` için |

Bu yüzden `PATCH` gerçek alanları alıyor: `uyariGun` · `ulkeKodu` · `gerekce`.
`{kategori, gun}` gönderen istemci **400** + `sebep: "kategori_bazli_sure_yok"`
alır — sessizce yutulup "kaydettim" sanmasın.

### 2.2 "Mevzuat tabanı altına inilemez" diye bir kapı YOK

Ayarı doğrulayan tek fonksiyon `ayarDenetle` ve yalnız iki şeye bakar:
**1 ≤ gün ≤ 3650** ve ülke kodu iki büyük harf. `yasalEsik` **bilgidir**, kapı
değil (`esikGosterilebilir`: sayı varsa dayanağı ve kaynağı da olmak zorunda).

Olmayan bir reddi uydurmak, **panelde kabul edilen bir değeri telefonda
reddetmek** olurdu. Uç bunun yerine yanıtta `yasalCipaAltinda` ve
`yasalEsikGun` taşıyor: istemci uyarı gösterebilir, kayıt reddedilmez.

### 2.3 Ön izleme KATEGORİ değil TABLO + ARALIK ekseninde

`manuelSil({tablo, aralik})`. Silme bir zaman aralığına uygulanır
("Ağustos'un ham konumunu sil"), bir sınıfa değil. `{kategori}` alsaydık
**aralığı biz seçmiş olurduk** — kullanıcının göreceği sayı, onaylamadığı bir
pencereden çıkardı.

---

## 3 · Haftalıkta kapsam GERÇEKTEN uygulanıyor

Rapor uçlarında (`speed.csv` vd.) kapı `requireMobileAdmin` kalmıştı, çünkü
rapor kurucuları filo kapsamı almıyordu. **Burada durum farklı ve kapı
`requireMobileFleetView`:** kalemin öznesi (şoför ya da araç) şefin filosunda
değilse satır gövdeye **hiç girmiyor**.

🔑 **Kapsam kuralı tek kaynağa taşındı.** `kapsamda` yordamı
`app/actions/haftalik-aksiyon.ts` içinde **özel** bir fonksiyondu; mobil uç
aynı kuralı uygulamak zorunda ve `"use server"` bir modülden senkron fonksiyon
dışa aktarılamıyor (o dosyanın her export'u async olmak ZORUNDA). Kural
`lib/haftalik-aksiyon-db.ts` → **`kalemKapsamda`** olarak taşındı; panel
action'ı da artık oradan okuyor. Kopyalasaydık iki yüzey zamanla ayrışırdı —
şefin panelde göremediği bir plakayı telefonunda görmesi tam da bunun adı olurdu.

Sıra da denetleniyor: **süzgeç, isim/plaka sorgusundan ÖNCE**. Şefin
göremeyeceği şoförün adı hiç çözülmüyor.

### `durum` neden var — görevde yalnız `{not?}` istenmişti

Çekirdek iki kapanış biliyor ve fark KALICI:

- `yapildi` → kalem kapanır, biter.
- `ilgisiz` → kalem kapanır **ve o kural+özne çifti 28 gün SUSTURULUR**.

Yalnız `{not}` alıp içeride birini seçseydik, kullanıcı "kapattım" derken
farkında olmadan bir kuralı bir aylığına susturabilirdi. Alan **açık**;
verilmezse **`yapildi`** (susturmayan), yani `{not:"…"}` tek başına da çalışır.

### "Cron kurulu mu" alanı YOK — ve olmayacak

Turu üreten zamanlayıcı **dışarıda** (cron-job.org). Uygulamanın o kaydı
görebileceği hiçbir yol yok. Gövde yalnız tablodan okunabileni söyler:
`sonUretim` · `sonHaftaBasi` · `turSayisi` · `istenenHaftaVar` · `tabloYok`.
Uydurma bir "cron çalışmıyor" alanı, kurulu ama o hafta zaten üretmiş bir
cron'u bozuk gösterirdi.

---

## 4 · Muhafız — `npm run lint:saklama-haftalik`

`verify` zincirine eklendi. **Arıza enjeksiyonuyla sınandı, dördün dördünü de
yakalıyor:**

| enjeksiyon | sonuç |
|---|---|
| `kuru: true` → `kuru: false` (ön izleme gerçek silmeye döner) | ✓ yakalandı |
| kapsam süzgeci kaldırıldı (`kalemKapsamda(...)` → `true`) | ✓ yakalandı |
| saklama kapısı şefe açıldı | ✓ yakalandı |
| `DURUMLAR`dan `ilgisiz` kısıldı | ✓ yakalandı |
| `kalemKapsamda` export'u kaldırıldı (tek kaynak bozuldu) | ✓ yakalandı |
| `kapat` kapsam kapısı kaldırıldı | ✓ yakalandı |

⚠️ İlk turda iki kontrol **kaçırdı** ve sebebi öğreticiydi: (1) enjeksiyon
yorumdaki `kuru: true`yu değiştirmişti, kodu değil — betik doğruydu, testim
yanlıştı; (2) `ilgisiz` kelimesi gövdenin başka bir yerinde de geçtiği için
`/ilgisiz/` testi tatmin oluyordu. İkincisi gerçek bir zayıflıktı: kontrol
artık **diziyi** arıyor (`DURUMLAR = ["yapildi", "ilgisiz"]`).

---

## 5 · Haftalık aksiyon cron'u — üç kiracının gerçek durumu

`docs/CRON-KAYITLARI.md` 6. iş. Sır **başlıkla** gönderilir; `?secret=`
biçimi kodda teşhis için duruyor ama **yeni kayıt kurarken kullanılmaz**
(sorgu dizesi erişim kayıtlarına düz metin düşer ve aynı `CRON_SECRET` sekiz
ucun tamamını açar).

| kiracı | kayıt alan adı | durum (ölçüldü 22.09.2026) |
|---|---|---|
| HAK61 | `hak-transport-takip.vercel.app` | ✅ **KURULU VE ÇALIŞIYOR** |
| Sendigo | `sendigo-delta.vercel.app` | ❌ kurulu değil — **0 tur** |
| galzura-demo | `demo.galzura.com` | ❌ kurulu değil — **0 tur** |

**HAK61 kanıtı `haftalik_aksiyon_turlari`nden:** son dört tur Pazartesi
`03:30 UTC` = **06:30 Europe/Vienna**'da üretilmiş — belgedeki zamanlamayla
birebir.

| hafta | üretildi (UTC) | kalem | bildirim alıcı |
|---|---|---|---|
| 2026-09-21 | Pzt 03:30 | 5 | 6 |
| 2026-09-14 | Pzt 03:30 | 5 | 6 |
| 2026-09-07 | Pzt 03:30 | 5 | 6 |
| 2026-08-31 | Pzt 03:30 | 5 | 6 |
| 2026-08-24 | 25.08 15:45 | 5 | 6 | ← ilk/elle koşum |

### Kurulacak kayıt — Sendigo

```
POST https://sendigo-delta.vercel.app/api/cron/haftalik-aksiyon
Authorization: Bearer <Sendigo projesinin CRON_SECRET'ı>
Zamanlama: her Pazartesi 06:30 Europe/Vienna
```

### Kurulacak kayıt — galzura-demo

```
POST https://demo.galzura.com/api/cron/haftalik-aksiyon
Authorization: Bearer <galzura-demo projesinin CRON_SECRET'ı>
Zamanlama: her Pazartesi 06:30 Europe/Vienna
```

⚠️ **Takım URL'si (`*-volkancatak1309-maxs-projects.vercel.app`) ÇALIŞMAZ** —
Deployment Protection 302 ile SSO'ya döndürür, zamanlayıcı ucu hiç görmez.
Yalnız yukarıdaki alan adları.

⚠️ Kurmadan önce `&kuru=1` ile bir kez koştur: canlıya satır yazmadan
kuralların ne çıkardığını gösterir. Kurduktan sonra **ilk çağrının 200
döndüğünü doğrula** — sır tanımsızsa uç fail-closed 401 döner ve zamanlayıcıda
bu sessiz bir başarısızlıktır.

⚠️ 084 tabloları **üç kiracıda da kurulu** (22.09 ölçümü), yani kayıt kurmak
migration beklemiyor. Sendigo ve demo'da kayıt kurulduğu an ilk Pazartesi turu
üretilir ve mobil uç dolu döner.


---

## 6 · Canlı kanıt — demo.galzura.com, gerçek giriş (22.09.2026)

Dağıtım `29bcdf9`, üç kiracıda da **READY**. **37/37 iddia geçti.**

| adım | rol | kod | not |
|---|---|---|---|
| üç uç | jetonsuz | **401** | `missing_token` |
| `POST /auth/login` | yönetici | **200** | telefon + PIN |
| `GET /saklama` | yönetici | **200** | **15 kategori** · 518 ms |
| `PATCH {uyariGun: 91}` | yönetici | **200** | `once 90 → sonra 91` |
| `GET /saklama` (doğrulama) | yönetici | **200** | `uyariGun: 91` |
| `PATCH {uyariGun: 90}` (geri al) | yönetici | **200** | `91 → 90`, DB'den doğrulandı |
| `PATCH {uyariGun: 0}` / `3651` | yönetici | **400** | `alan: uyariGun, min 1, max 3650` |
| `PATCH {ulkeKodu: "at"}` | yönetici | **400** | `alan: ulkeKodu` |
| `PATCH {kategori, gun}` | yönetici | **400** | `sebep: kategori_bazli_sure_yok` |
| `POST /saklama/on-izleme` | yönetici | **200** | `yazmaYapildi:false` · 635 ms |
| `POST on-izleme {kategori}` | yönetici | **400** | `sebep: kategori_ekseni_yok` |
| `GET /haftalik` | yönetici | **200** | 0 kalem, `tur: null` |
| `GET ?hafta=2026-W39` | yönetici | **200** | ISO hafta → `2026-09-21` (Pazartesi) |
| `GET ?hafta=2026-W99` | yönetici | **400** | `alan: hafta` |
| `POST /haftalik/{olmayan}/kapat` | yönetici | **404** | `not_found` |
| beş ucun beşi | **şoför** | **403** | saklama `admin_required` · haftalık `fleet_view_required` |

### Ölçülen gövde

**Saklama panosu (demo):** `uyariGun 90` · ülke `AT` · 15 kategori
(**yasal_zorunlu 8 · kisisel 4 · arac 3**) · silinebilir tablolar
`device_telemetry(kisisel)` ve `driver_locations(kisisel)` · yasal çıpa
`gosterilebilir: false` (demo'da doğrulanmış dayanak yok — ürün sayı basmıyor).

**Ön izleme, 2026-07 ayı:** `satir: 0` ve `kapi: {izin:false, engel:"km_donmadi"}`,
`hazirlik: {omurIzi:28, eksikAylar:[], kmDonmamis:23}`. Yani çekirdek
"silme yapılamaz, önce 23 aracın km'si dondurulmalı" diyor — **0 satır burada
"veri yok" değil "kapı kapalı" demektir** ve sebebi gövdede yazılı. Panelde de
aynı çekirdek, aynı cevap.

🔑 **Yazma kanıtı ölçümle:** ön izleme öncesi ve sonrası
`device_telemetry` = **1.302.750 → 1.302.750**. Tek satır silinmedi.

**Haftalık (demo):** `200` + boş liste + `uretim: {sonUretim:null,
sonHaftaBasi:null, turSayisi:0, istenenHaftaVar:false}`. 404 ya da 503 DEĞİL —
uç da tablo da çalışıyor, o kiracıda zamanlayıcı kaydı yok (§5). Gövdede
"cron" hakkında tek bir alan geçmiyor; sabitler taşınıyor
(`tavan: 5`, `susturmaGun: 28`).

**Kalıcı etki: yok.** Tek yazma `uyari_gun` 90→91→90 idi ve DB'den geri
alındığı doğrulandı; 403 için açılan geçici şoför hesabı silindi.
