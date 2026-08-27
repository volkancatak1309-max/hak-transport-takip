# Takograf okuyucu servisi — kurulum ve kanıt

**26.08.2026 · FAZ 3 ADIM 1 · panel kodu / migration / ekran YOK**

| İşaret | Anlamı |
|---|---|
| **[DOĞRULANDI]** | Bu turda çalıştırıldı, çıktısı aşağıda |
| **[VARSAYIM]** | Çıkarım — ölçüm değil |
| **[BİLMİYORUM]** | Cevabı yok |

---

## 0 · GÜNCELLEME — 27.08.2026

Bu belge 26.08'de yazıldı ve **iki yerde yanlıştı**. İkisi de düzeltildi; ne
yazdığı ve neden yanlış olduğu aşağıda duruyor, çünkü ikisi de tekrar
edilebilecek cinsten hatalar.

| Belge ne diyordu | Gerçek | Kanıt |
|---|---|---|
| Panel env anahtarı `TAKOGRAF_SERVIS_URL` | **`TAKOGRAF_URL`** | `lib/takograf-servis.ts:33,51,114` — kod bu adı okuyor, ötekini hiç aramıyor |
| Adres `takograf.proofcan.com` | **`takograf.galzura.com`** | 27.08 ölçümü: galzura `/health → 200 "ok"`, proofcan **cevap yok (HTTP 000)** |

🔴 **İkincisi yalnız bir yazım hatası değil, ÜRÜN SINIRI İHLALİydi.** Belgenin
§2'si "Proofcan'ın **mevcut** tüneline ikinci bir hostname ekle" diye
öneriyordu. Fleet işi `galzura.com` altına, Proofcan işi `proofcan.com` altına
kurulur; ürünler ayrı kalır. Doğrusu uygulandı: servis **`galzura-fleet` adlı
AYRI bir Cloudflare tünelinde**, Proofcan'ın `3357fbee-…` tünelinde DEĞİL.

Bu iki kusurun bedeli somuttu: Vercel env'i bu belgeye göre girilseydi
`servisYapilandirildi()` **false** dönerdi ve her `.ddd` arşive girip **hiç
ayrıştırılmazdı** — faaliyet tablosu boş, zaman sütunları boş, mühür
"denenmedi". Env üç kiracıda da doğru girilmiş [Volkan, 27.08].

**Ayrıca bu tarih itibarıyla:** panel kodu, migration 091 ve iki ekran CANLIDA
(main `e026967`, üç kiracıda da dağıtıldı). Okuyucunun faaliyet-zamanı
düzeltmesi sunucuda: yeni ikili 07:01'de devrede, eskisi
`takograf-okuyucu.eski-2026-08-27` olarak yedekli [Volkan, 27.08].
Düzeltmenin gerekçesi ve ölçümü: `docs/TAKOGRAF-OKUYUCU-DUZELTME.md`.

---

## 1 · Servis nerede

| | |
|---|---|
| **Sunucu** | `178.104.143.207` · Hetzner · **Ubuntu 24.04.4 LTS** · x86_64 [DOĞRULANDI] |
| **Adres** | 🔴 **`127.0.0.1:8790` — YALNIZ localhost** |
| **Kullanıcı** | `galzura` |
| **Dizin** | `~/takograf/` (`bin/` + `etc/`) |
| **Servis** | `systemctl --user takograf-okuyucu.service` · `enabled` · `Restart=always` |
| **Sır** | `~/takograf/etc/takograf.env` · `chmod 600` · **sunucuda üretildi, dışarı çıkmadı** |
| **İkili** | 14 MB, statik (CGO kapalı), `-trimpath -s -w` |
| **Ayrıştırıcı** | `tachograph-go@95ca680` (yanıtta `ayristirici_surum` alanında) |

### ⚠️ "Ayrı kullanıcı" tam sağlanamadı — gerekçe

İstenen: *ayrı kullanıcı, ayrı dizin, ayrı port*. **İkisi sağlandı, biri
sağlanamadı.**

`galzura` hesabında **parolasız sudo yok** [DOĞRULANDI: `sudo: a password is
required`]. Yeni sistem kullanıcısı açmak root ister. Bunun yerine:

- **ayrı dizin** ✅ `~/takograf` — `/opt/proofkit` ile hiç kesişmiyor
- **ayrı port** ✅ 8790 (proofkit 8000'de)
- **ayrı servis** ✅ `systemctl --user`, proofkit'in system birimlerinden ayrı
- **ayrı kullanıcı** ❌ `galzura` altında koşuyor, `proofkit` altında değil

`systemctl --user` kullanılabildi çünkü **`Linger=yes` zaten açıktı**
[DOĞRULANDI]. Böylece sudo'suz, kalıcı, otomatik yeniden başlayan bir servis
kuruldu.

> **Volkan'ın işi:** istenirse `takograf` adında ayrı bir sistem kullanıcısı
> açılıp servis oraya taşınabilir (§6).

**Proofcan'a dokunulmadı** [DOĞRULANDI]: `proofkit-engine.service → active`.

---

## 2 · Panel bu servise nasıl erişecek — **AYRI TÜNEL**

> ### Fleet'in kendi Cloudflare tüneli: `galzura-fleet` → `takograf.galzura.com`

### 🔴 Bu bölüm 26.08'de YANLIŞ öneriyordu

Belge burada *"Proofcan'ın **mevcut** tüneline ikinci bir hostname ekle
(`takograf.proofcan.com`)"* diyordu. Gerekçesi teknikti ve teknik olarak
doğruydu — cloudflared zaten kurulu, yeni port açılmıyor, sertifika Cloudflare
uçta. **Ama yanlış eksende karar veriyordu.**

Sunucuda paylaşılan bir şey olması, ürünlerin paylaşılması demek değildir:

- **Fleet işi `galzura.com` altına, Proofcan işi `proofcan.com` altına kurulur.**
  Takograf okuyucu bir FLEET bileşenidir; Proofcan alan adının altında
  görünmesi onu Proofcan'ın parçası gibi gösterirdi.
- Tek tünelde toplamak iki ürünü **tek arıza noktasına** bağlardı:
  `systemctl restart cloudflared` Proofcan'ı da düşürürdü.
- Müşteriye/denetime gösterilen adres ürünün kimliğidir; sonradan taşımak
  DNS + env + belge üçlüsünü birden kirletir.

### Uygulanan çözüm

`galzura-fleet` adında **AYRI bir Cloudflare tüneli**, Proofcan'ın
`3357fbee-…` tünelinden bağımsız:

| | Proofcan tüneli | **Fleet tüneli** |
|---|---|---|
| Tünel | `3357fbee-97a5-4215-b9da-14dfa7bebce2` | **`galzura-fleet`** |
| Hostname | `engine.proofcan.com` | **`takograf.galzura.com`** |
| Yerel hedef | `http://localhost:8000` | **`http://localhost:8790`** |
| Yeniden başlatma etkisi | Proofcan | **yalnız takograf** |

Ölçüm [DOĞRULANDI, 27.08.2026]:

```
https://takograf.galzura.com/health  → HTTP 200, gövde "ok"
https://takograf.proofcan.com/health → cevap YOK (HTTP 000) — böyle bir uç yok
```

| | Cloudflare Tunnel | Ters vekil + TLS (Caddy/nginx) |
|---|---|---|
| Açık gelen port | **yok** (giden bağlantı) | 443 açılmalı |
| TLS sertifikası | Cloudflare uçta | Let's Encrypt kurulmalı |
| DNS | Cloudflare kaydı | A kaydı sunucuya |
| Sunucuda yeni yazılım | **yok** — cloudflared kurulu | yeni servis |
| "Port yalnız localhost" kuralı | **birebir korunur** | korunur |

Tünel her eksende üstün **ve zaten kanıtlanmış altyapı**. Ters vekil önermek,
çalışan bir çözümün yanına ikinci bir yüzey açmak olurdu.

### Yapılandırma — Proofcan'ın `config.yml`'ine DOKUNULMAZ

Fleet tüneli kendi yapılandırmasıyla koşar; Proofcan'ın ingress'i olduğu gibi
kalır:

```yaml
# galzura-fleet tüneli — YALNIZ fleet
ingress:
  - hostname: takograf.galzura.com
    service: http://localhost:8790
  - service: http_status:404
```

DNS: Cloudflare'de `galzura.com` bölgesi → `takograf` için tünel CNAME kaydı.

⚠️ Kurulum root + Cloudflare hesabı ister; **Volkan uyguladı** (27.08 itibarıyla
`/health` ayakta — §0).

### Kimlik doğrulama — iki katman

1. **Cloudflare uçta**: yalnız `takograf.galzura.com` yönlendirilir; başka her
   şey 404.
2. **Serviste**: `Authorization: Bearer <TAKOGRAF_SECRET>`, sabit süreli
   karşılaştırma. **Sır tanımsızsa servis her isteği 401 döner** (fail-closed).
   Ölçüldü [DOĞRULANDI, 27.08]: yanlış sırla `/parse` → `401 {"hata":"yetkisiz"}`.

### 🔴 Panel tarafı — env anahtarının ADI

```
TAKOGRAF_URL=https://takograf.galzura.com
TAKOGRAF_SECRET=<sunucuda üretilen sır>
```

⚠️ Anahtarın adı **`TAKOGRAF_URL`**'dir, `TAKOGRAF_SERVIS_URL` DEĞİL. Kod tek
bu adı okur (`lib/takograf-servis.ts:33,51,114`) ve yanlış adla girildiğinde
**sessizce** kapanır: `servisYapilandirildi()` false döner, dosya arşive girer
ama hiç ayrıştırılmaz. Ne hata çıkar ne uyarı — yalnız her satır "denenmedi"
kalır. İkisi de `.env.example`'da kayıtlıdır; oradan kopyalayın.

İstemci **asla** doğrudan servise gitmez — dosya önce bizim sunucumuzdan geçer.

---

## 3 · Dört kural — kodda nerede karşılığı var

| Kural | Karşılığı | Kanıt |
|---|---|---|
| **1. AB'de koşar** | Hetzner Almanya | §1 |
| **2. Gövde loglanmaz** | `kayit()` yalnız `istek/yol/durum/bayt/sure` yazar; panik yakalanır ki yığın izi de düşmesin | §4-h |
| **3. Diske yazmaz** | `io.ReadAll` bellek; `os.CreateTemp`/`os.WriteFile` **hiç çağrılmıyor**; systemd `ProtectSystem=strict` + `ProtectHome=read-only` + `PrivateTmp=true` | §4-i |
| **4. Saklama sıfır** | Servis durum tutmaz; istek bitince referans bırakılmaz | §4-i |

`MemoryMax=256M`, `NoNewPrivileges=true`, `LimitNOFILE=1024`.

---

## 4 · Dokuz kanıt

### a) Sırsız istek → 401

```
HTTP 401  gövde: {"hata":"yetkisiz"}
```

### b) Yanlış sırla → 401

```
HTTP 401  gövde: {"hata":"yetkisiz"}
```

`/health` sır istemez ve **veri döndürmez**:
```
HTTP 200  gövde: ok
```

### c) Altı `.ddd` dosyasının HEPSİ ayrıştı

| Dosya | HTTP | nesil | tür | mühür | faaliyet | olay | atlanan hız bloğu |
|---|---|---|---|---|---|---|---|
| `card-000-gen1.ddd` | **200** | GEN1 | kart | dogrulanamadi | 0 | 120 | 0 |
| `card-003-dual.ddd` | **200** | KARMA | kart | dogrulanamadi | 0 | 300 | 0 |
| `vu-000-gen1.ddd` | **200** | GEN1 | vu | dogrulanamadi | 473 | 38 | 1 |
| `vu-003-gen2v2.ddd` | **200** | GEN2_V2 | vu | dogrulanamadi | **3.430** | 27 | 1 |
| `vu-004-full.ddd` | **200** | GEN2_V2 | vu | dogrulanamadi | 155 | 27 | 1 |
| `vu-004-nospeed.ddd` | **200** | GEN2_V2 | vu | dogrulanamadi | 155 | 27 | 0 |

🔑 **`vu-004-full` ve `vu-004-nospeed` BİREBİR AYNI çıktıyı verdi** (155 faaliyet,
27 olay). Detaylı hızı atmak **hiçbir şey kaybettirmiyor** — Volkan'ın 4.
kararının canlı kanıtı.

⚠️ **Kartlarda `faaliyet = 0` bir servis kusuru DEĞİL, TEST VERİSİ eksikliği:**
anonim kart kayıtlarında `EF_DRIVER_ACTIVITY_DATA` bloğu **hiç yok**
[DOĞRULANDI — kayıt dosya listesi]. Kartın olayları/arızaları geliyor (120 ve
300). Gerçek bir kart dosyasında faaliyet bloğu bulunur [VARSAYIM].

### d) Mührü doğrulanamayan dosya → ayrıştırma **yine başarılı**

```
HTTP 200 · ayrıştırma BAŞARILI
muhur_durumu : dogrulanamadi
muhur_sebep  : failed to extract Gen2 certificates: expected exactly 1 MSCA certificate, got 0 …
faaliyet     : 3430          ← mühür bozuk ama VERİ TAM
donem        : 2025-11-28T00:00:00Z -> 2026-03-10T22:40:00Z
plaka        : '*************'   vin: '*****************'
```

Sıra **önce `Parse`, sonra `Authenticate`**; kimlik hatası yutulup damgaya
çevriliyor. Volkan'ın 2. kararı birebir uygulandı.

### e) Bozuk / rastgele bayt → temiz hata, servis ayakta

| Girdi | Sonuç |
|---|---|
| rastgele 4 KB | `422 {"hata":"ayristirilamadi","sebep":"okunamadi: unknown or unsupported file type"}` |
| `0x76` + çöp | `422 {"hata":"ayristirilamadi","sebep":"okunamadi: dosya yapisi bozuk"}` |
| kart öneki + çöp | `422 {"hata":"ayristirilamadi","sebep":"okunamadi: unexpected EOF"}` |
| boş gövde | `400 {"hata":"bos_govde"}` |
| **servis durumu** | **active** |

#### 🔴 Bu kanıtın yakaladığı gerçek kusur

İlk koşumda `0x76 + çöp` **HTTP 000** döndü — hiç cevap yok. Sebep, günlükte:

```
http: panic serving 127.0.0.1:34326: runtime error: slice bounds out of range [1962983138:500]
  github.com/way-platform/tachograph-go/internal/vu/overview.go:19
  → sizeOfTransferValue → UnmarshalRawVehicleUnitFile
```

**Kütüphane bozuk girdide PANİK veriyor.** `net/http` paniği bağlantı başına
yakalayıp bağlantıyı **sessizce kapatıyor**: istemci cevapsız kalıyor, servis
ayakta görünüyor. Üstelik varsayılan davranış **yığın izini loga basıyor**.

Serviste `recover()` eklendi. İki kazanç:
1. İstemci temiz **422** görüyor
2. **2. kural**: yığın izi artık loga düşmüyor

Düzeltme sonrası panik satırı: **0** [DOĞRULANDI].

### f) 5 MB üstü → reddediliyor

```
gönderilen: 6.291.456 bayt (6 MB)
→ HTTP 413 {"hata":"cok_buyuk","sebep":"en fazla 5242880 bayt"}
```

Sınır gövde **okunmadan önce** uygulanıyor (`http.MaxBytesReader`).

### g) `systemctl restart` sonrası ayakta

```
durum      : active
etkin mi   : enabled
başlangıç  : Wed 2026-08-26 11:34:16 UTC
/health    : HTTP 200
/parse     : HTTP 200
```

### h) Günlükte dosya içeriği **YOK**

Servisin **şimdiye kadar yazdığı TÜM satır biçimleri** [DOĞRULANDI]:

```
  9 istek=<N> yol=/parse durum=200 bayt=<N> sure=<N>ms
  4 istek=<N> yol=/parse durum=401 bayt=<N> sure=<N>ms
  4 istek=<N> yol=/parse durum=422 bayt=<N> sure=<N>ms
  1 istek=<N> yol=/parse durum=400 bayt=<N> sure=<N>ms
  1 istek=<N> yol=/parse durum=413 bayt=<N> sure=<N>ms
  3 takograf-okuyucu dinliyor 127.0.0.1:8790 surum=tachograph-go@95ca680
  1 http: panic serving … slice bounds out of range   ← DÜZELTME ÖNCESİ, tek satır
```

Hassas kelime taraması — **tüm günlük geçmişi**:

| Aranan | Eşleşme |
|---|---|
| `TESTVIN` | **0** |
| `PORTUGAL` | **0** |
| `activityChanges` | **0** |
| `downloadablePeriod` | **0** |
| `cardNumber` | **0** |
| `vehicleRegistration` | **0** |
| `kart_no` · `faaliyet` · `muhur_sebep` | **0** |

⚠️ **Dürüst not:** düzeltme öncesi tek bir panik satırı günlükte duruyor. İçinde
dosya içeriği yok — yalnız bir dilim indeksi (`[1962983138:500]`) ve Go yığın
çerçeveleri. Yine de temizlenmesi tercih edilir; `journalctl --vacuum` root
ister (§6).

### i) Geçici dosya bırakılmıyor

**Açık dosya tanıtıcıları — istek ÖNCESİ ve SONRASI birebir aynı:**

```
1 anon_inode:[eventfd]     1 anon_inode:[eventpoll]
1 /dev/null                2 socket:[37043076]        1 socket:[37043086]
```

**Düzenli dosya (soket/boru dışı) açık: YOK** [DOĞRULANDI].

systemd yalıtımı [DOĞRULANDI]:
```
ProtectSystem = strict
ProtectHome   = read-only
PrivateTmp    = yes   → /tmp/systemd-private-…-takograf-okuyucu.service-orlEcV
ReadWritePaths= (boş)
```

Sunucuda kalan **tüm** dosyalar:
```
~/takograf/etc/takograf.env      (sır, 600)
~/takograf/bin/takograf-okuyucu  (ikili)
```

Test `.ddd` dosyaları `shred -u` ile silindi; `~/takograf/test` dizini yok.

### 🔴 Ek kanıt: dışarıdan erişilemiyor

Kendi makinemden [DOĞRULANDI]:
```
http://178.104.143.207:8790/health → HTTP 000   (erişilemez)
http://178.104.143.207:8790/parse  → HTTP 000   (erişilemez)
```
Sunucuda bind adresi: `127.0.0.1:8790`.

---

## 5 · Uçtan uca süre (HTTP dâhil, sunucuda ölçüldü)

| Dosya | 5 tur | Giriş → Çıkış |
|---|---|---|
| `vu-003-gen2v2.ddd` | 124 · 144 · 126 · 128 · **121 ms** | 155.187 B → 203.062 B |
| `card-003-dual.ddd` | 62 · 58 · 53 · 60 · **61 ms** | 35.820 B → 8.541 B |

⚠️ **Saf ayrıştırma 5,5 ms ölçülmüştü** (`docs/TAKOGRAF-OLCUM.md`). Aradaki
~120 ms **protojson + JSON ağaç gezme + kodlama**. Yani darboğaz ayrıştırma
değil, **çeviri katmanı**.

**Senkron kararı rahatça ayakta**: 121 ms bir HTTP isteği için sorun değil.
Ama ilerideki bir hızlandırma kaleminin nerede olduğu belli: protojson yerine
tipli erişim [VARSAYIM].

---

## 6 · Volkan'ın yapması gerekenler

1. ✅ **YAPILDI (27.08)** — **AYRI tünel** `galzura-fleet`:
   `takograf.galzura.com → http://localhost:8790`, Cloudflare'de CNAME.
   Proofcan'ın tüneline dokunulmadı. (§2) · Kanıt: `/health → 200 "ok"`.

2. ✅ **YAPILDI (27.08)** — sır Vercel'e girildi (üç kiracıda da, `Secret`
   tipinde). Sunucuda üretildi, **ben görmedim/yazmadım**. Gerekirse oku:
   ```
   ssh galzura@178.104.143.207 'grep TAKOGRAF_SECRET ~/takograf/etc/takograf.env'
   ```
   Vercel env — **adlar birebir**:
   `TAKOGRAF_SECRET` ve `TAKOGRAF_URL=https://takograf.galzura.com`
   (⚠️ `TAKOGRAF_SERVIS_URL` DEĞİL — §2'deki kutuya bakın.)

3. **Ayrı sistem kullanıcısı isteniyor mu?** Bugün `galzura` altında koşuyor
   (§1). İstenirse `takograf` kullanıcısı açılır ve birim system servisine
   taşınır — root gerekir.

4. **Eski panik satırını temizle** (isteğe bağlı):
   `sudo journalctl --user-unit takograf-okuyucu --vacuum-time=1s` (§4-h)

5. **Gerçek, sertifikalı bir `.ddd`** — imza doğrulamasının GERÇEKTEN çalışıp
   çalışmadığı hâlâ **kanıtlanamadı**; elimizdeki anonim veride sertifika yok.

---

## 7 · Açık kalanlar

| Konu | Durum |
|---|---|
| Gerçek dosyada `muhur_durumu = dogrulandi` görmek | **[BİLMİYORUM]** — sertifikalı dosya yok |
| Kart dosyasında faaliyet ayrıştırma | test verisinde blok yok; **kod yolu denenmedi** |
| Tünel üzerinden uçtan uca çağrı | ✅ **AÇILDI** — `takograf.galzura.com/health → 200 "ok"` [DOĞRULANDI 27.08]; sırla `/parse` panelden koşuyor |
| Panelden gerçek `.ddd` ile uçtan uca kanıt | **galzura-demo kiracısında** yapılır — HAK61/Sendigo CANLI MÜŞTERİ ve 091 dosya silmeyi REDDEDER (HK091), test dosyası oraya girerse kalıcı olur |
| 365 günlük dosyada süre/bellek | elimizde yok (en büyük 96 gün) |
| Ayrı sistem kullanıcısı | sudo yok — **yapılmadı** |
| Kütüphanenin panik kusuru yukarı bildirimi | **yapılmadı** — `way-platform/tachograph-go`'ya issue açılabilir |
| Servisin eşzamanlı yük altındaki davranışı | **ölçülmedi** — tek istek ölçüldü |
