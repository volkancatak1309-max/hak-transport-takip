# Faz D-5 — Güvenlik / erişim mobil uçları

Dal: `feat/guvenlik-uclari` · Ölçüm: **22.09.2026**
Taban: `main 4fa41c7` · **yeni migration YOK** (045-048 gerekiyor, üçünde de şema hazır)

---

## 1 · Sekiz route, altı uç

| uç | yöntem | kapı | çekirdek |
|---|---|---|---|
| `/api/mobile/guvenlik` | GET | **patron** | `getKillSwitchState` · `listPendingDevices/Countries` · `sayacSonSaat` · `listSecurityWorkers` |
| `/guvenlik/oturumlar` | GET | patron | `sessionSayfasi` |
| `/guvenlik/oturumlar/[id]/kes` | POST | patron | `oturumlariKes` |
| `/guvenlik/onaylar` | GET | patron | `listPendingDevices` · `listPendingCountries` |
| `/guvenlik/onaylar/[id]` | POST | patron | `onayKarari` |
| `/guvenlik/erisim/[workerId]` | GET · PATCH | patron | `accessRuleTek` · `saatleriDenetle` + `saatleriYaz` · `muafiyetYaz` |
| `/guvenlik/kill-switch` | POST | patron | `anahtarCek` · `anahtarGeriAl` |
| `/guvenlik/denetim` | GET | patron | `auditSayfasi` |

---

## 2 · Yeni kapı: `requireMobileOwner`

`requireOwner()`ın JSON dönen ikizi. **Sıra kuralın kendisi:**

| adım | sonuç |
|---|---|
| jeton yok | **401** |
| yönetici değil | **403 `admin_required`** — şoför katman durumunu bile öğrenmez |
| `SECURITY_LAYER_ENABLED` kapalı | **200 `{katman:"kapali", veri:null}`** |
| `is_owner` değil | **403 `owner_required`** |
| patron | `{katman:"acik"}` + veri |

**Katman kapalıyken neden 403 değil:** HAK61 ve Sendigo'da bayrak tanımsız. Orada
patron kapısını uygulasaydık uç kalıcı olarak 403 döner ve istemci *"yetkim yok"*
ile *"bu kurulumda böyle bir şey yok"*u ayırt edemezdi. 3. adım bir VERİ sızıntısı
değil bir KURULUM gerçeğidir — hiçbir oturum, iz ya da onay satırı dönmez.

`isOwnerWorker` bilerek `SECURITY_LAYER_ENABLED` denetlemiyor (lib/owner-scope.ts:
kapılar açık + katman kapalı bir kurulumda patron kendi sisteminden kilitlenirdi);
bayrak denetimi **kapıda**, patron denetiminden önce.

---

## 3 · 🔴 Sessiz boş liste yasağı — ve neden bu tek koruyucusu var

`lib/security-read.ts` ve `lib/access-read.ts` bayrak kapalıyken **boş dizi**
döner. Panel için doğru davranış (ekran "kayıt yok" der, kırılmaz); **API için
yalan**: istemci *"hiç oturum yok"* ile *"bu kiracıda güvenlik katmanı hiç
açılmamış"*ı ayırt edemez. Birinde beklenir, diğerinde kurulum yapılır.

Her uç çekirdeği **çağırmadan önce** bayrağa bakıyor. Emsal `servisYapilandirildi`
(091, takograf): "arıza" ile "hiç kurulmamış" ayrı şeylerdir.

### İki bayrak bağımsız, iki ayrı cevap

| bayrak | kapsadığı | kapalıyken |
|---|---|---|
| `SECURITY_LAYER_ENABLED` | oturumlar · denetim izi · patron kademesi (045) | `{katman:"kapali"}` — altı ucun altısı |
| `ACCESS_GATES_ENABLED` | onaylar · erişim kuralları · anahtar (046/048) | `{kapilar:"kapali"}` — dört uç |

Tek bayrağa indirgemek, açık olan yarıyı da kapalı göstermek olurdu.

---

## 4 · 🔴 Tek oturum kesilemez — ölçüldü, uç bunu SÖYLÜYOR

Görev `POST /oturumlar/[id]/kes` istiyordu. Ürünün gerçeği başka:

| yol | iptal nereye bakıyor |
|---|---|
| web | `isSessionRevoked(workerId, cookieVersion)` → yalnız `workers.session_version`. `login_sessions` satırına **hiç bakmaz**. |
| mobil | `token_version` de `workers` üzerinde; mobil token bir **satır id'si taşımıyor** (`closeSessionsBySource`). |

Yani tek bir satırı kapatmak **kimseyi çıkarmaz**: satır "bitti" görünür, kişi
çalışmaya devam eder. Böyle bir uç güvenlik ekranında **yalan söyleyen bir
düğme** olurdu.

Uç bu yüzden satırın **sahibini** bulup o kişinin bütün oturumlarını düşürüyor —
ve istemci kapsamı **açıkça kabul etmek zorunda**:

```
POST /guvenlik/oturumlar/<id>/kes  { "kapsam": "bu_oturum" }
→ 400 { sebep: "tek_oturum_kesilemez", aciklama: "…kişi ekseninde…" }

POST /guvenlik/oturumlar/<id>/kes  { "kapsam": "hepsi" }
→ 200 { acikOturum: {once, sonra}, sessionVersion, mobilKesildi: true }
```

Sessizce genişletmek, *"bir cihazı attım"* sanan patronun o kişinin **bütün**
cihazlarını düşürmesiyle biterdi. Aynı desen `haftalik/[id]/kapat`ın `durum`
alanında da var: kalıcı sonucu olan bir seçim istemciden AÇIKÇA alınır.

---

## 5 · 🔴 Kelime uyarısı — `islem:"ac"` sistemi AÇMAZ, KAPATIR

Panelin ekran dili ile gövde dili ters okunabiliyor:

| gövde | çekirdek | sonuç | panelde adı |
|---|---|---|---|
| `islem:"ac"` | `activateKillSwitch` | 🔴 **SİSTEM KAPANIR** — patron hariç herkesin web+mobil oturumu düşer | "Sistemi kapat" |
| `islem:"kapa"` | `deactivateKillSwitch` | sistem eski hâline döner | "anahtarı aç" |

Yani **"ac" sistemi açmaz, ANAHTARI açar.** Yanıt her iki durumda da ayrı bir
`sistemDurumu` alanı taşıyor (`"acik"` / `"kapali"`) — istemci kelimeye değil o
alana bakmalı. Geçersiz `islem` de bu açıklamayla 400 döner.

### İki aşamalı doğrulama aynen

Panel iki ayrı düğmeyle ilerliyor (önce `ONAYLIYORUM`, sonra gizli soru); mobil
ikisini tek gövdede alıyor ama **sırayı ve iz yazımını aynen** uyguluyor —
çünkü ikisi de `anahtarCek` çekirdeğini çağırıyor:

1. onay metni yanlış → `confirm_mismatch`, **gizli soru hiç denenmez, hak yanmaz**
2. **önce kilit**, sonra cevap — tersi olsaydı kilitli anahtarda da cevap
   denenebilir, yani kilit deneme sayısını sınırlamamış olurdu
3. her durumda `kill_switch_attempts`e satır yazılır

**Geri alma gizli soru istemez** (046 kararı): kapatmak yıkıcı, açmak onarıcı.
Geri almayı da kilitleseydik, sistemi yanlışlıkla kapatan patron kendi
anahtarının arkasında kalırdı.

---

## 6 · "İzinli ülkeler" YAZILAMAZ — üründe yazma yolu yok

`workers.allowed_countries` üç yerde **okunuyor** ve **hiçbir yerde
yazılmıyor**: panelde action yok, form alanı yok; kolon SQL'le dolduruluyor.

Mobilde bir yazıcı uydursaydık panelde olmayan bir yetenek açmış olurduk ve
kural (*geçerli ülke kodu nedir, boş dizi kısıt mı kaldırma mı*) ilk kez
**burada** tanımlanırdı — yani kopya değil, **tekil** bir kaynak olurdu ve panel
ondan habersiz kalırdı.

```
PATCH /guvenlik/erisim/<id>  { "ulkeler": ["TR"] }
→ 400 { sebep: "ulke_yazma_yolu_yok" }
```

GET tarafında alan **okunabilir** ve gövde `yazilabilir: false` diyor.

---

## 7 · Denetim izi: yalnız `audit_log` — ve bu SÖYLENİYOR

Panelin `listActionTimeline`i **beş** tabloyu birleştiriyor ama **sayfalanamaz**:
her tablodan kendi payını çekip bellekte sıralıyor, yani "3. sayfa" diye tutarlı
bir kavram yok (ikinci sayfada bir tablo tükenip diğeri devam ederse satırlar
kayar).

Uç tek tabloyu sayfalıyor ve gövdede bunu söylüyor:

```jsonc
"birlesikDegil": true,
"disaridaKalanKaynaklar": ["worker_admin_log","shift_edit_log","leave_edit_log","login_unlock_log"]
```

Sessizce eksik göstermek, izin **tamamı** sanılmasına yol açardı — bir denetim
ekranında en pahalı hata bu olurdu.

---

## 8 · Kopya kural yok: `lib/guvenlik-eylem.ts`

Bu kuralların hepsi `app/actions/security.ts` ve `app/actions/access.ts` içinde
**özel** fonksiyonlardı. Mobil uçlar aynı kuralı uygulamak zorunda ve
`"use server"` bir modülden senkron export alınamıyor — üstelik action'lar
`requireOwner()` çağırıyor, o da `redirect()` atıyor ve bir route handler'ında
redirect bir istisnaya dönüşür.

Taşınanlar: `oturumlariKes` · `hesabiGeriAc` · `onayKarari` · `saatAyikla` +
`saatleriDenetle` + `saatleriYaz` · `muafiyetYaz` · `anahtarCek` ·
`anahtarGeriAl` · `ANAHTAR_ONAY_METNI` · `ANAHTAR_SORUSU`.

**Panel action'ları artık kapı + bayrak + tazeleme**; işin kendisi çekirdekte ve
mobil uçlar AYNI fonksiyonları çağırıyor. Aynı karar `kalemKapsamda` (084) ve
`kademeDenetle` (086) için de verilmişti.

Ek olarak okuma tarafında iki sarmalayıcı: `listSessions` → `sessionSayfasi`,
`listAudit` → `auditSayfasi`. Satır çevirisi, "canlı" hesabı ve `metaDegisim`
maskelemesi tek yerde kaldı.

### Panelde değişen tek davranış: `not_pending`

`onayKarari` artık "0 satır etkilendi"yi ayrı bir sonuç olarak döndürüyor.
**Panel bunu eskisi gibi sessizce yutuyor** (iki sekme açıkken doğru davranış);
mobil uç aynı durumu **409 `zaten_karara_baglandi`** ile ayırt ediyor. Kural
çekirdekte, ayrım çağıranda.

---

## 9 · Muhafız — `npm run lint:guvenlik-uclari`

`verify` zincirine eklendi. **Arıza enjeksiyonuyla sınandı: 17/17 yakalandı.**

| enjeksiyon | sonuç |
|---|---|
| durum ucunda katman denetimi kaldırıldı (sessiz boş liste) | ✓ |
| denetim ucunda katman denetimi kaldırıldı | ✓ |
| onaylar ucunda kapılar denetimi kaldırıldı | ✓ |
| oturumlar kapısı şefe açıldı | ✓ |
| kapı sırası bozuldu (katman, yöneticiden önce) | ✓ |
| kes ucu kapsam onayını kaldırdı | ✓ |
| kes ucu tek satır kapatmaya döndü | ✓ |
| kes ucu sayacı elle artırıyor | ✓ |
| anahtar ucu `activateKillSwitch`i doğrudan çağırıyor | ✓ |
| çekirdekte kilit denetimi cevaptan sonraya alındı | ✓ |
| geri alma gizli soru istemeye başladı | ✓ |
| erişim ucu ülke yazmaya başladı | ✓ |
| erişim ucu kendi saat regex'ini yazdı | ✓ |
| panel action'ı çekirdeği bırakıp kopya yazdı | ✓ |
| `listSessions` sarmalayıcı olmaktan çıktı | ✓ |
| denetim ucu "eksik kaynak" uyarısını kaldırdı | ✓ |
| onaylar ucu 100 tavanı uyarısını kaldırdı | ✓ |

🔑 **İlk turda iki kontrol KAÇTI, ikisi de öğreticiydi:**

1. *"kilit denetimi cevaptan önce"* kontrolü dosyanın **tamamında** sıraya
   bakıyordu; `verifySecret` en üstteki **import** satırında da geçtiği için
   sıra hep "doğru" çıkıyordu. Artık yalnız `anahtarCek` **gövdesi** okunuyor.
2. *"100 tavanı gövdede"* kontrolü `kirpildi` **alt dizesini** arıyordu ve
   enjeksiyon alanı `kirpildiKaldirildi` yaptığı için tatmin oluyordu. Artık
   tam anahtar (`\bkirpildi\s*:`) aranıyor.

Ayrıca iki kontrol önce **açıklama dizelerine** takılıyordu (`kodu()` dize
sabitlerini bilerek koruyor): kolon adını anlatan bir metin, kolonu yazıyormuş
gibi okunuyordu. İkisi de **yazma anahtarı** (`kolon\s*:`) arayacak şekilde
daraltıldı — 086 turundaki aynı tuzağın tekrarı.

---

## 10 · Standart doğrulama

| adım | sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| ESLint | **43 problem (28 hata, 15 uyarı)** — taban ile birebir, artış yok |
| `lint:test-filters` | tek bulgu `lib/auto-shift.ts:825` — taban, değişmedi |
| 25 muhafız | **hepsi yeşil**, yeni muhafız dâhil |
| `npm run build` (yerel) | **1 hata — taban da aynı**: Google font indirilemiyor. Gerçek build kanıtı Vercel dağıtımlarıdır. |

---

## 11 · Canlı kanıt — galzura-demo, gerçek giriş (22.09.2026)

Betik iki modda koşuyor ve modu **bayraktan** türetiyor.

### 11.1 KAPALI KATMAN provası — **19/19**

`ENV_FILE=.env.galzura-demo npm run verify:guvenlik-uclari`
(yerel env'de bayrak yok → `SECURITY_LAYER_ENABLED=false`)

Bu, **HAK61/Sendigo'daki gerçek hâlin birebir provası**.

| adım | sonuç |
|---|---|
| altı uç · jetonsuz | **401** `missing_token` |
| `POST /auth/login` | **200** · rol=admin · `is_owner=true` |
| ŞOFÖR → `GET /guvenlik` | **403** `admin_required` — katman durumunu bile öğrenmez |
| YÖNETİCİ (owner değil) | **200 `{katman:"kapali"}`** — 403 DEĞİL |
| **sekiz route** (GET+POST) | **200 `{katman:"kapali", veri:null, bayrak:"SECURITY_LAYER_ENABLED"}`** |
| `satirlar` alanı | **hiç yok** — boş liste dönmüyor |

### 11.2 AÇIK KATMAN tam turu — **62/62** (+ anahtar ölçümü ilk koşumdan)

`SECURITY_LAYER_ENABLED=true ACCESS_GATES_ENABLED=true ENV_FILE=.env.galzura-demo …`
— gerçek demo veritabanı, gerçek rota fonksiyonları.

⚠️ **Bu, üretimdeki demo ayarının aynısı DEĞİL.** Canlı host turu ölçtü:
demo üretiminde `SECURITY_LAYER_ENABLED` **açık**, `ACCESS_GATES_ENABLED`
**kapalı** (§14). Buradaki koşum kapıları ELLE açarak kapı yollarını da
kanıtlıyor; üretimin gerçek hâli §14'te.

**Durum panosu (ölçülen):**

```
katman acik · kapilar acik
kapılar  saat 07:00–21:00 (Europe/Istanbul) · ülke ["TR","AT"] · patron muaf
anahtar  aktif=false · kalanHak=3 · sirVar=true · sirVarsayilan=TRUE
bekleyen cihaz 0 · ülke 0
son 24sa giriş 92 · iz satırı 179
kadro    37 kişi · patron 1 · yönetici 5 · donmuş 0
oturum   509 satır · 5 açık
denetim  1209 satır
```

| adım | kod | ölçüm |
|---|---|---|
| ŞOFÖR → `GET /guvenlik` | **403** | `gate_hours` — §12.1 |
| YÖNETİCİ (owner değil) | **403** | `owner_required` |
| `GET /oturumlar?sayfa=1&limit=5` | **200** | 5 satır · toplam **509** · sonSayfa 102 |
| `?sayfa=2` | **200** | farklı satır (offset 5) |
| `?acik=1` | **200** | 5 açık, hepsi `acik:true` |
| `?sayfa` + `?offset` birlikte | **400** | `sayfa_ve_offset_birlikte` |
| `POST …/kes {kapsam:"bu_oturum"}` | **400** | `tek_oturum_kesilemez` |
| `POST …/kes {kapsam:"hepsi"}` | **200** | açık **1 → 0** · `session_version` **0→1** · `token_version` **0→1** · satır `revoked` |
| olmayan oturum | **404** | `not_found` |
| geçici cihaz onayı → listede | **200** | cihaz 0 → **1** |
| `POST /onaylar/<id> {karar:"ret"}` | **200** | tür **otomatik** çözüldü (`cihaz`) · DB `denied` + `decided_by` |
| aynı onaya ikinci karar | **409** | `zaten_karara_baglandi` |
| `GET /erisim/<id>` | **200** | `07:00–21:00 (varsayılan)` · `["TR","AT"]` · muaf=false |
| `PATCH {saatler:{08:00,18:00}, muaf:true}` | **200** | `varsayılan → 08:00–18:00` · muaf `false → true` |
| `PATCH {saatler:{bas}}` (tek uç) | **400** | `tek_uc` |
| `PATCH {bas:"25:00"}` | **400** | `bicim` |
| `PATCH {ulkeler:["TR"]}` | **400** | `ulke_yazma_yolu_yok` |
| `PATCH {saatler:null, muaf:false}` (geri al) | **200** | varsayılana döndü |
| `POST /kill-switch {islem:"kapa"}` | **409** | `zaten_kapali` · `sistemDurumu:"acik"` |
| `{islem:"ac", onay:"ONAYLIYORUM"}` (cevapsız) | **400** | soru `"Apolet no?"` · **hak yakılmaz** |
| `{islem:"ac", onay:"olur", cevap:"x"}` | **403** | `confirm_mismatch` · hak **3 → 3** |
| `{islem:"ac", onay:doğru, cevap:YANLIŞ}` | **403** | `wrong_answer` · hak **3 → 2** |
| `GET /denetim?sayfa=1&limit=5` | **200** | toplam **1209** · `birlesikDegil:true` |
| `?islem=access_deny` | **200** | **1 satır** — bu turun kararı ize düştü |
| `?islem=Access%20Deny` | **400** | biçim |

### 🔑 Yazma kanıtı ölçümle

- Geçici cihaz onayı **silindi** (0 satır kaldı), geçici oturum satırı **silindi**.
- Test Şoför sayaçları **tur öncesi hâlinde**: `sv=0 tv=0`.
- Erişim kuralı **tur öncesi hâlinde**: `saat=null-null · muaf=false`.
- 🔴 **Anahtar ÇEKİLMEDİ**: `kill_switch` tablosunda açık kayıt **0**, `aktif=false`.
- `audit_log` satırları **KALDI** ve kalmalı: gerçekleşmiş bir eylemin izi silinemez.

⚠️ **Kalıcı tek etki: `kalanHak` 3 → 2.** Yanlış cevap denemesi bir hakkı yakar
ve bu geri alınamaz (iz silinemez). İlk doğru cevapta seri sıfırlanır. Betik
artık denemeyi **yalnız hak tamken (3)** yapıyor — bir QA koşumu üretimdeki
kilidi tetikleyemesin.

---

## 12 · Turda çıkan üç ölçüm

### 12.1 Kapılar açıkken reddi **auth katmanı** verir

Şoför `403 admin_required` yerine **`403 gate_hours`** aldı: `verifyMobileRequest`
her mobil istekte dört kapıyı değerlendiriyor ve saat penceresi
(07:00–21:00 Europe/Istanbul) dışındaki şoförü daha bizim kapımıza gelmeden
reddediyor. İkisi de 403, ikisinde de veri yok — ürünün kendi tasarımı, kusur
değil. (Mobilde "beklet" hâli yok: token vermek tüm uçları açmak demek.)

### 12.2 🔴 Demo'nun anahtar sırrı HÂLÂ FABRİKA CEVABI

`sirVarsayilan: true` → `kill_switch_secret.answer_hash`, `db/migrations/046`in
**tohum** değeriyle birebir aynı. [[kiraci-hizalama]]'da "AÇIK KALAN İŞ" diye
not düşülen madde artık **ölçüldü ve doğrulandı**.

Uç bunu her durum çağrısında söylüyor (`anahtar.sirVarsayilan`). Karşılaştırma
hash'e hash olarak yapılıyor; cevap hiçbir yere yazılmıyor/dönmüyor.

**Yapılacak:** demo (ve açılacak her kiracı) için `kill_switch_secret` kendi
cevabıyla güncellenmeli.

### 12.3 HAK61'de 045-048 şeması ARTIK VAR — not bayatlamış

[[kiraci-hizalama]] (21.09) *"HAK61'de 045/046/047/048 HİÇ KOŞMAMIŞ — 8 tablo +
7 kolon eksik"* diyordu. **22.09 ölçümü:**

| kiracı | 045-048 tabloları | `workers.is_owner` | satır | patron |
|---|---|---|---|---|
| galzura-demo | ✅ var | ✅ var | 509 oturum · 1209 iz | **1** |
| Sendigo | ✅ var | ✅ var | **0** · **0** | **0** |
| HAK61 | ✅ **var** | ✅ **var** | **0** · **0** | **0** |

Yani şema üç kiracıda da hazır; ayıran şey **bayrak**. HAK61 ve Sendigo'da
katman kapalı ve **patron atanmamış** — bayrak bir gün açılsa bile
`requireMobileOwner` herkesi 403 ile çevirir (fail-closed). Uçları açmak için
migration gerekmiyor.

---

## 13 · Bu turda AÇILMAYANLAR

- **Hesap dondurma ucu ayrı değil**: `kes` gövdesinde `dondur: true` ile
  yapılıyor (panelin `revokeSessionsAction(workerId, freeze)` deseninin aynısı).
  Geri açma (`hesabiGeriAc`) çekirdeği taşındı ama **mobil uç açılmadı** —
  görevde yoktu.
- **Gün oynatıcı ve PDF parmak izi sorgusu** (`getDayReplayAction`,
  `lookupFingerprintAction`) mobile açılmadı — görevde yoktu.
- **`audit_log` yazma ucu yok ve olmayacak**: iz ürünün kendi eylemlerinden
  doğar; dışarıdan satır yazılabilen bir iz, iz değildir.

---

## 14 · Canlı HOST turu — gerçek HTTP (22.09.2026)

Dağıtım **`573e469`**, üç kiracıda da **READY**. **28/28 iddia geçti.**

§11 uçları *yerel rota + canlı DB* ile ölçüyordu; bu tur **dağıtılmış uca
gerçek HTTP** atıyor.

### 🔑 ÜRETİMİN GERÇEK HÂLİ: katman AÇIK, kapılar KAPALI

```
GET https://demo.galzura.com/api/mobile/guvenlik
→ 200  { katman: "acik", kapilar: "kapali", … }
```

Bu turun en değerli bulgusu ve **tam da tasarımın sınandığı yer**: iki bayrak
bağımsız ve uç bunu ayrı ayrı söylüyor.

| blok | demo üretiminde |
|---|---|
| `oturum` · `kadro` · `son24Saat` · `/oturumlar` · `/denetim` | **DOLU** (katman açık) |
| `kapilar_detay` · `anahtar` · `bekleyen` | **`null`** (kapılar kapalı) |
| `/onaylar` · `/onaylar/[id]` · `/erisim/[id]` · `/kill-switch` | **`{kapilar:"kapali", veri:null, bayrak:"ACCESS_GATES_ENABLED"}`** |

`null` ile `0` arasındaki fark burada bütün mesele: *"0 bekleyen onay"* ile
*"onay mekanizması hiç çalışmıyor"* aynı ekrana aynı şekilde yazılamaz.

⚠️ **Bayrak kapısı parametre doğrulamasından ÖNCE.** Kapılar kapalıyken
geçersiz bir gövde bile 400 değil **200 + `kapilar:"kapali"`** alıyor —
`speed.csv`in `feature_disabled` sırasının aynısı ve bilinçli.

⚠️ **Kapılar kapalıyken PATCH hiçbir şey yazmıyor** (`veri: null`), ve katmana
bağlı uçlar bundan **etkilenmiyor** (oturumlar hâlâ 200). İkisi de ölçüldü.

### Tur tablosu

| adım | hedef | kod | ölçüm |
|---|---|---|---|
| beş uç · jetonsuz | **üç kiracı** | **401** | `missing_token` ×5, üçünde de |
| `POST /auth/login` | demo | **200** | rol=admin |
| `GET /guvenlik` | demo | **200** | **334 ms** · katman açık / kapılar kapalı |
| — kapı blokları | demo | — | `kapilar_detay` · `anahtar` · `bekleyen` = **null** |
| — katman blokları | demo | — | oturum.açık **4** · kadro **37** · son 24 sa giriş **98** / iz **191** |
| `GET /oturumlar?sayfa=1&limit=5` | demo | **200** | 5 satır · toplam **515** · sonSayfa 103 · **202 ms** |
| — örnek satır | demo | — | `Volkan Çatak · mobile · DE/Frankfurt am Main · açık=true canlı=true` |
| `?sayfa=2` | demo | **200** | farklı satır (offset 5) |
| `?acik=1` | demo | **200** | 4 açık, hepsi `acik:true` |
| `?sayfa` + `?offset` | demo | **400** | `sayfa_ve_offset_birlikte` |
| `?sofor=abc` | demo | **400** | `alan: sofor` |
| `GET /onaylar` | demo | **200** | `kapilar:"kapali"` |
| `POST /onaylar/<id>` | demo | **200** | `kapilar:"kapali"` (400/404'ten ÖNCE) |
| `GET` · `PATCH /erisim/<id>` | demo | **200** | `kapilar:"kapali"` · **yazma yok** |
| `POST /kill-switch` | demo | **200** | `kapilar:"kapali"` |
| `GET /denetim?sayfa=1&limit=5` | demo | **200** | toplam **1215** · `birlesikDegil:true` · **173 ms** |
| `?islem=page_view` | demo | **200** | **1047** satır, hepsi `page_view` |
| `?islem=Page%20View` | demo | **400** | biçim |

### 🔴 Kapılar kapalı olduğu için üretimde ÖLÇÜLEMEYENLER

Aşağıdakiler yalnız **§11.2'deki yerel açık-kapı turunda** ölçüldü (gerçek demo
veritabanı, gerçek rota fonksiyonları, bayraklar elle açık):

- onay ret → **409** ikinci karar · tür otomatik çözümü
- erişim yaması ve geri alma · `tek_uc` · `bicim` · `ulke_yazma_yolu_yok`
- anahtar: `confirm_mismatch` · `wrong_answer` (hak **3 → 2**) · **çekilmedi**
- oturum kesme: `session_version` **0→1**, `token_version` **0→1**

`ACCESS_GATES_ENABLED` demoda açılırsa bu yolların hepsi canlı hostta da
ölçülebilir. **Bu turda açılmadı** — bayrak bir ürün kararıdır ve kapıları
açmak o kiracıda herkesin giriş davranışını değiştirir.

---

## 15 · Volkan'a üç madde

1. 🔴 **Demo'nun anahtar sırrı hâlâ fabrika cevabı.** `sirVarsayilan: true`
   ölçüldü — `kill_switch_secret.answer_hash`, `db/migrations/046`in tohum
   değeriyle birebir aynı. [[kiraci-hizalama]]'daki "AÇIK KALAN İŞ" doğrulandı.
2. ⚠️ **Demo'da `ACCESS_GATES_ENABLED` kapalı.** Env'de tanımlı ama etkin değeri
   kapalı; `device_approvals`ta 2 satır ve izde 3 `access_approve` var, yani bir
   ara açıktı. Kapı yolları bu yüzden üretimde ölçülemedi (§14).
3. 🔑 **HAK61 ve Sendigo'da patron ATANMAMIŞ** (`is_owner` = 0 kişi). Şema hazır,
   bayrak kapalı. Bayrak bir gün açılırsa uçlar herkese `owner_required` döner —
   fail-closed, ama önce bir patron atamak gerekir.
