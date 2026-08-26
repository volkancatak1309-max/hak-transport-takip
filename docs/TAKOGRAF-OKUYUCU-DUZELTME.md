# Takograf okuyucu servisi — faaliyet zamanı düzeltmesi

**Durum:** ⏳ Kod düzeltildi ve YEREL olarak doğrulandı. **Canlı servis
(https://takograf.galzura.com) HÂLÂ ESKİ SÜRÜMÜ KOŞUYOR.** Dağıtım Volkan'da.

**Tarih:** 26.08.2026 · Faz 3 Adım 2 sırasında panel tarafı ölçülürken bulundu.

---

## Bulgu

Panel tarafının uçtan uca kanıtı canlı servise gerçek bir `.ddd` gönderdi.
Servis 200 döndü, 155 faaliyet satırı geldi — **155'inin de zamanı boştu.**

```
$ curl -s https://takograf.galzura.com/parse … --data-binary @vu-004-full.ddd
{"faaliyetler":[{"baslangic":"","faaliyet":"WORK","slot":"DRIVER_SLOT"}, …]}
                              ↑ 155/155 boş
```

Bu haliyle ekran 155 satır gösteriyor ama Tarih / Başlangıç / Bitiş / Süre
sütunlarının dördü de boş — yani tablo hiçbir şey anlatmıyor.

## Kök neden

Servis faaliyet satırının zamanını `m["time"]` alanından okuyordu. Kütüphanenin
`activityChange` nesnesinde böyle bir alan **yok**. Gerçek şema:

```
gün kaydı  : { dateOfDay,           activityChanges:    [...] }   ← VU gen2
gün kaydı  : { activityRecordDate,  activityChangeInfo: [...] }   ← sürücü kartı
değişim    : { timeOfChangeMinutes, activity, slot, crew, … }
```

Zaman **gün kaydında**, değişim satırında yalnızca gece yarısından itibaren
geçen dakika var. İkisi ayrı düğümde olduğu için servisin kullandığı düz
`derinAra` taraması ikisini birleştiremiyordu: değişim listesini buluyor,
tarihi bulamıyordu.

## Düzeltme

`scripts`de değil servis kaynağında (`main.go`), üç parça:

1. **`gunKayitlari(agac)`** — ağaçta HEM tarih HEM değişim listesi taşıyan
   düğümleri bulur; tarihi aşağı taşır. Tarihi çözülemeyen bir liste de
   alınır (satır düşürülmez), zamanı boş kalır.
2. **`gunuCoz(gun)`** — `baslangic = dateOfDay + timeOfChangeMinutes`.
3. **Süre, SLOT İÇİNDE zincirlenir** — sürücü ve yardımcı paralel iki zaman
   çizgisidir; düz listede araya giren bir yardımcı satırı sürücünün bitişini
   yanlış yere çekerdi.

`faaliyet` sözleşmesine iki alan eklendi: `bitis`, `sure_dk` (ikisi de
`omitempty` — ölçülemediğinde **alan gelmez**, 0 gelmez).

### Ölçülemeyen süre uydurulmaz

İki yerde bilinçli olarak boş bırakılıyor:

- **Slotun günkü SON satırı.** "Gün kaydı gece yarısında biter, öyleyse son
  faaliyet 24:00'a kadar sürer" çıkarımı yapılabilirdi ve çoğu zaman doğrudur
  — ama bir çıkarımdır, ölçüm değil. Elimizdeki gerçek dosyada iki gün kaydı
  24 saati aşıyor (dakikalar 1410'dan 0'a dönüyor) ve o çıkarım **22 saatlik
  tek bir sürüş bloğu** üretti: sürüş 34:00 yerine 76:00 çıktı (ölçüldü).
- **Sıra bozuksa** (sonraki değişimin dakikası daha küçük).

Panel bu satırları ayrıca sayıp gösteriyor: "*8 kaydın süresi ölçülemedi*".

## Ölçüm — önce / sonra

Aynı dosya (`vu-004-full.ddd`, 98.590 bayt), aynı kütüphane sürümü
(`tachograph-go@95ca680`):

| | ÖNCE (canlı) | SONRA (yerel) |
|---|---|---|
| faaliyet satırı | 155 | 155 |
| başlangıcı olan | **0** | **155** |
| süresi ölçülen | 0 | 147 |
| sürüş | — | 34:00 |
| diğer iş | — | 34:30 |
| mola | — | 5:00 |
| ölçülemeyen | 155 | 8 |

Elimizdeki beş örnek dosyanın hepsi denendi:

| dosya | nesil | faaliyet | başlangıçlı | süreli | olay |
|---|---|---|---|---|---|
| `vu-004-full.ddd` | GEN2_V2 | 155 | 155 | 147 | 27 |
| `vu-003-gen2v2.ddd` | GEN2_V2 | 3.430 | 3.430 | 3.202 | 27 |
| `vu-000-gen1.ddd` | GEN1 | 473 | 473 | 461 | 38 |
| `card-000-gen1.ddd` | GEN1 | 0 | 0 | 0 | 120 |
| `card-003-dual.ddd` | KARMA | 0 | 0 | 0 | 300 |

Gen1 ve Gen2_V2 araç kayıtlarının üçünde de zaman eksiksiz: 4.058 satırın
4.058'i başlangıçlı, 3.810'u süreli. Ölçülemeyen 248 satır gün/slot sınırı ve
bozuk sıra kuralından geliyor (yukarı bakın) — hepsi ekranda ayrıca sayılıyor.

⚠️ İki sürücü kartı örneği 0 faaliyet döndürüyor ve bu **doğru**: o anonim
örneklerde `driverActivityData` bölümü hiç yok (ham ağaçta doğrulandı — `driverCard`
altında yalnız `icc`, `ic`, `tachograph`, `tachographG2` var; olay ve arıza
kayıtları geliyor, faaliyet kaydı gelmiyor).

🔴 **Sürücü kartı yolu bu veriyle ÖLÇÜLEMEDİ.** Kod kart şemasını da
karşılıyor (`activityRecordDate` + `activityChangeInfo`) ama bunu doğrulayan
bir dosya elimizde yok. Gerçek bir kart dosyası gelene kadar bu yol
**varsayım** sayılmalı; VU yolu ölçüldü.

## Dağıtım (Volkan)

Yerel derleme hazır ve masaüstünde:

- `C:\Users\90553\Desktop\takograf-okuyucu` — Linux/amd64, 14.528.674 bayt,
  sha256 `8aca52822f76…`
- `C:\Users\90553\Desktop\takograf-okuyucu-main.go` — düzeltilmiş kaynak

```bash
scp ~/Desktop/takograf-okuyucu galzura@178.104.143.207:~/takograf/bin/takograf-okuyucu.yeni
ssh galzura@178.104.143.207
  systemctl --user stop takograf-okuyucu
  mv ~/takograf/bin/takograf-okuyucu ~/takograf/bin/takograf-okuyucu.eski
  mv ~/takograf/bin/takograf-okuyucu.yeni ~/takograf/bin/takograf-okuyucu
  chmod +x ~/takograf/bin/takograf-okuyucu
  systemctl --user start takograf-okuyucu
  curl -s localhost:8790/health
```

⚠️ Servisin `--help` bayrağı **yok**; parametresiz çalıştırmak sunucuyu başlatır
ve SSH oturumunu bloklar. Sağlık için yalnız `/health` ucunu kullanın.

Dağıtımdan sonra panelde okunamayan/eksik dosyalar için **"Yeniden oku"**
düğmesi yeterlidir — dosyalar arşivde duruyor, yeniden yüklemek gerekmez.

## Servisin dört kuralı bozulmadı

Düzeltme yalnız bellek içi ağaç dönüşümüne dokunuyor:

- AB'de koşar — değişmedi (aynı sunucu).
- İstek gövdesini loglamaz — yeni log satırı eklenmedi.
- Diske yazmaz — yeni dosya işlemi yok.
- Saklama sıfır — yeni durum tutulmuyor.
