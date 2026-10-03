# Gizlilik politikası — Expo satırı (TASLAK)

> ## ⚠️ AVUKAT ONAYI ŞART — YAYINLANMAZ
> Karar 10 (03.10 teyit): Expo satırı **1.5.0 hukuk paketiyle**. **DOĞRULANACAK** satırlar Expo'nun
> resmî sayfalarından doğrulanmadan kullanılamaz.

## Gerçekler (koddan)

- Mobil uygulama bildirimleri **Expo Push Service** üzerinden gider (`expo-notifications`; panel
  tarafı `exp.host` ucuna gönderir). İletilen: cihazın **Expo push jetonu**, bildirimin **başlığı ve
  metni** (sürücü adı, plaka, uyarı türü gibi kişisel veri içerebilir), platform.
- Uygulama güncellemeleri **EAS Update** ile Expo sunucularından indirilir (cihaz IP adresi ve
  uygulama/çalışma zamanı sürümü Expo'ya ulaşır).

## §7 Recipients and processors — new row

| Service provider | Purpose | Location |
|---|---|---|
| Expo (650 Industries, Inc.) **[DOĞRULANACAK]** | Delivery of push notifications to the mobile app; delivery of app updates | USA **[DOĞRULANACAK]** |

> **Transfer to the USA (Expo).** Transfer basis: **[Expo DPA / SCC / DPF — DOĞRULANACAK]**.

**DE:** | Expo (650 Industries, Inc.) | Zustellung von Push-Benachrichtigungen an die App; Auslieferung von App-Updates | USA |
**TR:** | Expo (650 Industries, Inc.) | Mobil uygulamaya bildirim iletimi; uygulama güncellemelerinin iletimi | ABD |

## §8 Retention — not

Expo'nun bildirim verisini ne kadar sakladığı **DOĞRULANACAK**. Galzura tarafında push jetonu,
kullanıcı hesabı silinene kadar tutulur (mevcut politika §8 "User account" satırı).

## Yapılacak

- [ ] Expo DPA'sı ve alt işleyen listesi (DOĞRULANACAK).
- [ ] Bildirim metinlerinde gereksiz kişisel veri var mı (ör. tam ad yerine kısaltma) — veri
      minimizasyonu, avukatla.
