# Gizlilik politikası eki — Sesli asistan / OpenAI (TASLAK)

> ## ⚠️ AVUKAT ONAYI ŞART — YAYINLANMAZ
> Taslak. **DOĞRULANACAK** işaretli satırlar resmî kaynaktan doğrulanmadan kullanılamaz.
> Hedef: galzura.com `privacy-policy` (EN / DE / TR), mevcut bölüm numaralarıyla.

## 0. Gerçekler (koddan, 03.10.2026)

| Konu | Durum | Dayanak |
|---|---|---|
| Hangi veri OpenAI'a gider | Kullanıcının **sesi** (canlı akış), konuşmanın **dökümü**, araçların sonucu olan **filo verisi** (araç plakası, konum yerine bölge adı, sürücü adı, vardiya/sefer, alarm türleri, yakıt, **izin kayıtları — izin türü dahil**), kullanıcının **tek yönlü karması** (`OpenAI-Safety-Identifier`, sha256) | `lib/asistan-sesli.ts`, `lib/asistan-sesli-araclar.ts` |
| IP adresi | Tarayıcı ses bağlantısını OpenAI'a **doğrudan** kurar (WebRTC) → OpenAI kullanıcının IP adresini görür | `AsistanSesliClient.tsx` |
| Koordinat | Asistana **gitmez**; konum bölge adına çevrilir | Faz 1c |
| Bizde saklanan | **Ses: hiç.** Döküm: yalnız tarayıcı belleğinde. Kullanım kaydı (kim, ne zaman, ne kadar, motor, tahmini maliyet — içerik yok): **2 ay**. "Bildir" denen tek soru-cevap (+ araç adları/süreleri, araç sonucu yok): **90 gün** | migration 110 (taslak), karar 5/9 |
| Model sağlayıcısı | OpenAI (`gpt-live-1` + `gpt-6-luna`; yedek `gpt-realtime-2.1`) | §10 Karar: motor |

⚠️ **İzin türü sağlık verisi olabilir** (ör. hastalık izni) → GDPR md. 9. Müşteri (veri sorumlusu) için
dayanak (md. 9(2)(b) iş hukuku) ve maskeleme kararı (karar 6: maskeleme yok) **avukatın** konusu.

---

## 1. EN — policy-ready blocks

### §5 Data processed — add

> **Voice assistant (optional, only where activated for your company).** When a manager uses the
> voice assistant, the following is processed: the manager's voice (live audio stream), the
> transcript of the conversation, and the fleet data the assistant looks up to answer — vehicle
> plates, a place name instead of coordinates, driver names, shifts and trips, alarm types, fuel
> figures and leave records **including the type of leave**. No audio recording is stored by us.
> The transcript exists only in the user's browser during the conversation.

### §6 Purposes and legal bases — add

> Answering the manager's questions about their own fleet by voice or text. Legal basis: performance
> of the contract with our business customer (Art. 6(1)(b) GDPR) and, for the customer as
> controller, their legitimate interest in efficient fleet management (Art. 6(1)(f) GDPR). Where
> leave types reveal health data (Art. 9 GDPR), the customer relies on Art. 9(2)(b) GDPR
> (employment law). **[DOĞRULANACAK — avukat]**
>
> Usage records (who, when, how long, estimated cost — no content) are kept to enforce usage limits
> and for billing (Art. 6(1)(f) GDPR).

### §7 Recipients and processors — new row

| Service provider | Purpose | Location |
|---|---|---|
| OpenAI **[sözleşme tarafı DOĞRULANACAK: OpenAI OpCo, LLC / OpenAI Ireland Ltd]** | Speech recognition, language model and speech output for the voice assistant | USA **[AB veri yerleşimi uygulanabilirse "EU" — DOĞRULANACAK]** |

> **Transfer to the USA (OpenAI).** OpenAI processes the data as a sub-processor under a data
> processing addendum. Transfer basis: **[DPF sertifikası VARSA:] the EU-U.S. Data Privacy Framework
> (adequacy decision of 10 July 2023), with the standard contractual clauses in the DPA as a fallback
> [YOKSA:] the standard contractual clauses of the European Commission incorporated in OpenAI's DPA**
> — **DOĞRULANACAK**. According to OpenAI, data sent through the API is not used to train its models
> and is retained for up to **[30] days** for abuse monitoring **[DOĞRULANACAK]**.

### §8 Retention periods — new rows

| Type of data | Retention |
|---|---|
| Voice assistant usage record (no content) | 2 months, then deleted |
| Voice assistant report ("Report" button: question, answer, tool names) | 90 days, then deleted |
| Voice recordings | not stored |

---

## 2. DE — richtlinienfertige Blöcke

### §5 Verarbeitete Daten — Ergänzung

> **Sprachassistent (optional, nur wenn für Ihr Unternehmen aktiviert).** Nutzt eine Führungskraft
> den Sprachassistenten, werden verarbeitet: ihre Stimme (Live-Audiostream), das Transkript des
> Gesprächs und die Flottendaten, die der Assistent zur Beantwortung abruft — Kennzeichen, ein
> Ortsname statt Koordinaten, Fahrernamen, Schichten und Fahrten, Alarmarten, Kraftstoffwerte sowie
> Abwesenheiten **einschließlich der Art der Abwesenheit**. Wir speichern keine Audioaufnahmen. Das
> Transkript besteht nur während des Gesprächs im Browser der Nutzerin bzw. des Nutzers.

### §6 Zwecke und Rechtsgrundlagen — Ergänzung

> Beantwortung von Fragen der Führungskraft zur eigenen Flotte per Sprache oder Text. Rechtsgrundlage:
> Vertragserfüllung gegenüber unserem Geschäftskunden (Art. 6 Abs. 1 lit. b DSGVO) und für den
> Kunden als Verantwortlichen dessen berechtigtes Interesse an effizienter Flottenführung (Art. 6
> Abs. 1 lit. f DSGVO). Soweit Abwesenheitsarten Gesundheitsdaten offenlegen (Art. 9 DSGVO), stützt
> sich der Kunde auf Art. 9 Abs. 2 lit. b DSGVO (Arbeitsrecht). **[DOĞRULANACAK — avukat]**
>
> Nutzungsdatensätze (wer, wann, wie lange, geschätzte Kosten — ohne Inhalte) dienen der Durchsetzung
> von Nutzungsgrenzen und der Abrechnung (Art. 6 Abs. 1 lit. f DSGVO).

### §7 Empfänger und Auftragsverarbeiter — neue Zeile

| Dienstleister | Zweck | Ort |
|---|---|---|
| OpenAI **[DOĞRULANACAK]** | Spracherkennung, Sprachmodell und Sprachausgabe des Sprachassistenten | USA **[DOĞRULANACAK]** |

> **Übermittlung in die USA (OpenAI).** OpenAI verarbeitet die Daten als Unterauftragsverarbeiter auf
> Grundlage eines Auftragsverarbeitungsvertrags. Grundlage der Übermittlung: **[DPF / SCC —
> DOĞRULANACAK]**. Laut OpenAI werden über die API übermittelte Daten nicht zum Training verwendet und
> bis zu **[30] Tage** zur Missbrauchserkennung gespeichert **[DOĞRULANACAK]**.

### §8 Speicherdauer — neue Zeilen

| Datenart | Speicherdauer |
|---|---|
| Nutzungsdatensatz Sprachassistent (ohne Inhalte) | 2 Monate, danach gelöscht |
| Meldung aus dem Sprachassistenten (Schaltfläche „Melden“: Frage, Antwort, Tool-Namen) | 90 Tage, danach gelöscht |
| Sprachaufnahmen | werden nicht gespeichert |

---

## 3. TR — politikaya hazır bloklar

### §5 İşlenen veriler — ek

> **Sesli asistan (isteğe bağlı, yalnız şirketiniz için açıldıysa).** Bir yönetici sesli asistanı
> kullandığında şunlar işlenir: yöneticinin sesi (canlı ses akışı), konuşmanın dökümü ve asistanın
> cevap vermek için baktığı filo verisi — plaka, koordinat yerine yer adı, sürücü adları, vardiya ve
> seferler, alarm türleri, yakıt değerleri ve **izin türü dahil** izin kayıtları. Ses kaydı tarafımızca
> saklanmaz. Döküm yalnız görüşme süresince kullanıcının tarayıcısında durur.

### §6 Amaçlar ve hukuki sebepler — ek

> Yöneticinin kendi filosuna ilişkin sorularını sesli ya da yazılı cevaplamak. Hukuki sebep: kurumsal
> müşterimizle sözleşmenin ifası (GDPR m. 6/1-b) ve veri sorumlusu olarak müşterinin verimli filo
> yönetimindeki meşru menfaati (GDPR m. 6/1-f). İzin türünün sağlık verisi açığa çıkardığı hâllerde
> müşteri GDPR m. 9/2-b'ye (iş hukuku) dayanır. **[DOĞRULANACAK — avukat]**
>
> Kullanım kayıtları (kim, ne zaman, ne kadar, tahmini maliyet — içerik yok) kullanım sınırlarını
> uygulamak ve faturalama için tutulur (GDPR m. 6/1-f).

### §7 Alıcılar ve veri işleyenler — yeni satır

| Hizmet sağlayıcı | Amaç | Konum |
|---|---|---|
| OpenAI **[DOĞRULANACAK]** | Sesli asistanın konuşma tanıma, dil modeli ve konuşma çıktısı | ABD **[DOĞRULANACAK]** |

> **ABD'ye aktarım (OpenAI).** OpenAI veriyi bir veri işleme sözleşmesiyle alt işleyen olarak işler.
> Aktarım dayanağı: **[DPF / SCC — DOĞRULANACAK]**. OpenAI'a göre API ile gönderilen veri modellerin
> eğitiminde kullanılmaz ve kötüye kullanımı izlemek için en fazla **[30] gün** saklanır
> **[DOĞRULANACAK]**.

### §8 Saklama süreleri — yeni satırlar

| Veri türü | Saklama |
|---|---|
| Sesli asistan kullanım kaydı (içerik yok) | 2 ay, sonra silinir |
| Sesli asistan bildirimi ("Bildir": soru, cevap, araç adları) | 90 gün, sonra silinir |
| Ses kayıtları | saklanmaz |
