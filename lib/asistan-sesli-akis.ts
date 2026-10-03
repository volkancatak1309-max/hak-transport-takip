import { SESLI_DIL_ADI, dilPuani, type SesliDil } from "@/lib/asistan-sesli-sabitler";

/**
 * SESLİ ASİSTAN — REALTIME AKIŞ DURUM MAKİNESİ (Faz 1c, 03.10.2026).
 *
 * SAF: ağ, DOM ve saat okumaz. Sunucu olayını ve şimdiki anı alır, uygulanacak EYLEMLERİ
 * döndürür. Tarayıcı (`AsistanSesliClient`) eylemleri uygular; aynı makine
 * `scripts/verify-asistan-sesli-akis.mjs`'te sahte bir Realtime sunucusuyla koşturulur
 * (Faz 1b mantığıyla yan yana, aynı senaryolar).
 *
 * ═══ 03.10 TEST 2 KİLİTLENMESİ — KÖK SEBEP ═══════════════════════════════════
 * Almanca soru → Türkçe söz kesme ("Dur, sadece duran araçları söyle"): asistan Almanca
 * devam etti, bir araç çağırdı ve CEVAP VERMEDİ; Türkçe ancak iki seslenmeden sonra geldi.
 * Faz 1b istemcisinde üç kusur vardı:
 *  1) Araçlar yalnız `response.done` `status: "completed"` ise çalışıyordu. Söz kesme
 *     yanıtı İPTAL eder (`cancelled`); içindeki tamamlanmış `function_call` hiç
 *     cevaplanmadı → konuşmada SAHİPSİZ çağrı kaldı, model sonucu bekleyip sustu.
 *  2) Araç bitince `response.create` HEMEN yollanıyordu. O sırada kullanıcının yeni
 *     cümlesiyle sunucu kendiliğinden bir yanıt başlattıysa istek
 *     `conversation_already_has_active_response` hatasıyla düştü → sonuç konuşmada durdu
 *     ama onu okuyacak yanıt hiç üretilmedi. (Olay işleyicisi `await` ile araç beklerken
 *     yeni olaylar da işlendiği için bu yarış kolayca oluşuyordu.)
 *  3) Dil, kullanıcının cümlesi BİTTİKTEN sonra (`…transcription.completed`) bildiriliyordu;
 *     yanıt o an çoktan eski dille başlamıştı ve düzeltilmiyordu.
 *
 * ═══ YENİ KURALLAR ═══════════════════════════════════════════════════════════
 *  • Araç `response.output_item.done` gelir gelmez çalışır (çağrı kimliği başına BİR kez);
 *    yanıt sonradan iptal edilse de tamamlanmış çağrı cevaplanır. Sonuç çağrının HEMEN
 *    ARKASINA eklenir (`previous_item_id`): kullanıcının yeni sorusu konuşmada en sonda
 *    kalır, model onu cevaplar. Yarım kalmış (`incomplete`) çağrı silinir.
 *  • `response.create` yalnız BOŞTAYKEN gider: aktif yanıt yok, istek yolda değil,
 *    kullanıcı konuşmuyor (ve konuşma bittiyse sunucunun kendi yanıtı için kısa bir süre
 *    beklendi), çalışan araç yok, sunucunun almadığı öğe yok. Sunucunun aldığı
 *    (`conversation.item.added`) ama sonradan başlayan hiçbir yanıtın görmediği bir sonuç
 *    varsa yanıt istenir; sunucunun kendiliğinden başlattığı yanıt sonucu zaten görüyorsa
 *    İKİNCİ yanıt istenmez. `conversation_already_has_active_response` → aktif yanıt
 *    bitince yeniden denenir.
 *  • DİL KİLİDİ: kullanıcının dili döküm PARÇALARINDAN (cümle bitmeden) tespit edilir;
 *    değiştiyse talimat tazelenir (`session.update`). Bu kullanıcı cümlesine verilen
 *    yanıtın kendi dökümü başka dilde başlarsa yanıt kesilir (`response.cancel` + ses
 *    tamponu temizliği), yarım cevap silinir ve soru yeni talimatla yeniden üretilir —
 *    kullanıcı cümlesi başına EN FAZLA bir kez. Kesmeden yeni cevabın ilk sesine kadar
 *    geçen süre `olcum` eylemiyle ekrana yazılır.
 */

export type Olay = Record<string, unknown>;
export type AracCagrisi = { name: string; call_id: string; arguments: string; itemId: string | null };

export type AkisNotu = "yanit_kuyrukta" | "yanit_yeniden_istendi" | "dil_duzeltiliyor" | "yarim_cagri_silindi";

export type AkisEylemi =
  | { tur: "gonder"; olay: Olay }
  | { tur: "arac"; cagri: AracCagrisi }
  | { tur: "dil"; dil: SesliDil }
  | { tur: "olcum"; ad: "dil_duzeltme"; ms: number; dil: SesliDil }
  | { tur: "not"; kod: AkisNotu };

/** Talimatın sonuna eklenen dil bölümü (Faz 1b ek güvencesi, Realtime). */
export function dilBolumu(dil: SesliDil): string {
  const ad = SESLI_DIL_ADI[dil];
  return `\n\n# Current user language\n- Current user language: ${ad}. Reply in ${ad} until the user switches.`;
}

/** `gpt-transcribe` algılanan dili `languages: [{ code }]` olarak verir; diğerleri vermez. */
export function olayDili(olay: Olay): SesliDil | null {
  const diller = Array.isArray(olay.languages) ? (olay.languages as Olay[]) : [];
  const kod = String(diller[0]?.code ?? "").slice(0, 2).toLowerCase();
  return kod === "tr" || kod === "de" || kod === "en" ? kod : null;
}

/** Yanıtın dilini "yanlış" saymak için kullanıcıdakinden GÜÇLÜ kanıt — yanlış kesme olmasın. */
const YANIT_DIL_ESIGI = 2;
/** `response.create` cevapsız kalırsa (ne `response.created` ne hata) yeniden denenir. */
const ISTEK_ZAMAN_ASIMI_MS = 4_000;
/** Konuşma onaylanınca (`committed`) sunucunun KENDİ yanıtını başlatması için tanınan süre. */
const KONUSMA_SONRASI_BEKLEME_MS = 1_200;
/** Konuşma bitti ama onay gelmedi (gürültü: sunucu tamponu boşalttı) → yanıt gelmeyecek. */
const ONAYSIZ_KONUSMA_BEKLEME_MS = 400;
/** Sunucu öğeyi bu sürede onaylamazsa alınmış sayılır (olay adı değişse de akış kilitlenmesin). */
const ONAY_ZAMAN_ASIMI_MS = 2_000;

export type RealtimeAkis = {
  /** Sunucu olayı → eylemler. */
  olay(o: Olay, an: number): AkisEylemi[];
  /** Araç sonucu hazır → sonucu konuşmaya ekleyen eylemler. */
  aracBitti(cagri: AracCagrisi, cikti: unknown, an: number): AkisEylemi[];
  /** Yazılı soru (Realtime'da metin girişi belgeli). */
  metinGonder(metin: string, an: number): AkisEylemi[];
  /** Zaman aşımları — istemci ~250 ms'de bir çağırır. */
  tik(an: number): AkisEylemi[];
  durum(): Record<string, unknown>;
};

export function realtimeAkis(talimat: string): RealtimeAkis {
  let aktifYanit: string | null = null;
  let istekAn: number | null = null;
  let konusuyor = false;
  let konusmaBittiAn: number | null = null;
  let konusmaOnayBekliyor = false;
  const gorulenCagrilar = new Set<string>();
  const calisan = new Set<string>();
  /** Yollanmış, sunucunun henüz onaylamadığı öğeler (çağrı kimliği / mesaj kimliği) → an. */
  const onaysiz = new Map<string, number>();
  /** Sunucunun aldığı ama sonradan başlayan bir yanıtın HENÜZ görmediği öğeler. */
  const kapsanmamis = new Set<string>();
  /** Yeniden göndermek için: çağrı kimliği → `conversation.item.create` olayı. */
  const ciktiOlaylari = new Map<string, Olay>();
  let oturumDili: SesliDil | null = null;
  let sonKullaniciOgesi: string | null = null;
  const kullaniciMetni = new Map<string, string>();
  const yanitMetni = new Map<string, string>();
  const yanitMesajlari = new Map<string, string[]>();
  /** Yanıt → başladığı anda konuşmadaki son kullanıcı öğesi (yanıt hangi soruya?). */
  const yanitinOgesi = new Map<string, string | null>();
  let izle: { yanitId: string | null; dil: SesliDil; oge: string } | null = null;
  const duzeltilen = new Set<string>();
  let iptal: { yanitId: string; oge: string } | null = null;
  let olcum: { dil: SesliDil; iptalAn: number; yanitId: string | null } | null = null;
  let yaziSayaci = 0;

  const gonder = (olay: Olay): AkisEylemi => ({ tur: "gonder", olay });

  function dene(an: number): AkisEylemi[] {
    if (kapsanmamis.size === 0) return [];
    if (aktifYanit !== null || istekAn !== null || iptal !== null) return [];
    if (konusuyor || konusmaBittiAn !== null) return [];
    if (calisan.size > 0 || onaysiz.size > 0) return [];
    istekAn = an;
    return [gonder({ type: "response.create" })];
  }

  function dilIptal(yanitId: string, oge: string, dil: SesliDil, an: number): AkisEylemi[] {
    duzeltilen.add(oge);
    izle = null;
    iptal = { yanitId, oge };
    olcum = { dil, iptalAn: an, yanitId: null };
    return [
      { tur: "not", kod: "dil_duzeltiliyor" },
      gonder({ type: "response.cancel", response_id: yanitId }),
      gonder({ type: "output_audio_buffer.clear" }),
    ];
  }

  /** Yanıtın dökümü yeterli kanıt taşıyorsa: yanlış dil → kes, doğru dil → izlemeyi bırak. */
  function yanitDiliniDenetle(yanitId: string, an: number): AkisEylemi[] {
    if (!izle || izle.yanitId !== yanitId || iptal) return [];
    const k = dilPuani(yanitMetni.get(yanitId) ?? "");
    if (!k || k.puan < YANIT_DIL_ESIGI) return [];
    if (k.dil !== izle.dil) return dilIptal(yanitId, izle.oge, izle.dil, an);
    izle = null;
    return [];
  }

  function kullaniciDili(dil: SesliDil, oge: string, an: number): AkisEylemi[] {
    const e: AkisEylemi[] = [];
    if (dil !== oturumDili) {
      oturumDili = dil;
      e.push({ tur: "dil", dil });
      // Talimat boşsa güncelleme YOLLANMAZ: `instructions` tamamen değişir, yalnız dil satırı
      // kalırsa asistan bütün kurallarını kaybederdi.
      if (talimat) {
        e.push(gonder({ type: "session.update", session: { type: "realtime", instructions: talimat + dilBolumu(dil) } }));
      }
    }
    if (duzeltilen.has(oge)) return e;
    if (izle && izle.oge === oge && izle.dil === dil) return e;
    // Yalnız BU kullanıcı öğesine verilen yanıt izlenir — önceki soruya verilen cevap silinmez.
    const mevcut = aktifYanit !== null && yanitinOgesi.get(aktifYanit) === oge ? aktifYanit : null;
    izle = { yanitId: mevcut, dil, oge };
    if (mevcut) e.push(...yanitDiliniDenetle(mevcut, an));
    return e;
  }

  function cagriIsle(item: Olay): AkisEylemi[] {
    if (item.type !== "function_call") return [];
    const callId = String(item.call_id ?? "");
    if (!callId || gorulenCagrilar.has(callId)) return [];
    gorulenCagrilar.add(callId);
    if (item.status !== undefined && item.status !== "completed") {
      // Argümanı yarım kalmış çağrı çalıştırılamaz; konuşmada sahipsiz kalmasın diye silinir.
      return typeof item.id === "string"
        ? [gonder({ type: "conversation.item.delete", item_id: item.id }), { tur: "not", kod: "yarim_cagri_silindi" }]
        : [];
    }
    calisan.add(callId);
    return [
      {
        tur: "arac",
        cagri: {
          name: String(item.name ?? ""),
          call_id: callId,
          arguments: String(item.arguments ?? ""),
          itemId: typeof item.id === "string" ? item.id : null,
        },
      },
    ];
  }

  function olay(o: Olay, an: number): AkisEylemi[] {
    const e: AkisEylemi[] = [];
    switch (o.type) {
      case "input_audio_buffer.speech_started":
        konusuyor = true;
        konusmaBittiAn = null;
        break;
      case "input_audio_buffer.speech_stopped":
        konusuyor = false;
        konusmaBittiAn = an;
        konusmaOnayBekliyor = true;
        break;
      case "input_audio_buffer.committed":
        if (typeof o.item_id === "string") sonKullaniciOgesi = o.item_id;
        if (konusmaBittiAn !== null) konusmaBittiAn = an;
        konusmaOnayBekliyor = false;
        break;
      case "conversation.item.input_audio_transcription.delta":
      case "conversation.item.input_audio_transcription.completed": {
        const oge = String(o.item_id ?? "");
        const metin =
          o.type === "conversation.item.input_audio_transcription.completed"
            ? String(o.transcript ?? "")
            : (kullaniciMetni.get(oge) ?? "") + String(o.delta ?? "");
        kullaniciMetni.set(oge, metin);
        const dil = olayDili(o) ?? dilPuani(metin)?.dil ?? null;
        if (dil && oge) e.push(...kullaniciDili(dil, oge, an));
        break;
      }
      case "conversation.item.added":
      case "conversation.item.created":
      case "conversation.item.done": {
        const item = (o.item ?? {}) as Olay;
        const anahtar = item.type === "function_call_output" ? String(item.call_id ?? "") : String(item.id ?? "");
        if (anahtar && onaysiz.delete(anahtar)) {
          kapsanmamis.add(anahtar);
          e.push(...dene(an));
        }
        break;
      }
      case "response.created": {
        const id = String(((o.response ?? {}) as Olay).id ?? "") || `yanit@${an}`;
        aktifYanit = id;
        istekAn = null;
        konusmaBittiAn = null;
        konusmaOnayBekliyor = false;
        // Bu yanıt, sunucunun şu ana kadar aldığı her öğeyi görüyor.
        kapsanmamis.clear();
        yanitinOgesi.set(id, sonKullaniciOgesi);
        if (izle && izle.yanitId === null && izle.oge === sonKullaniciOgesi) izle.yanitId = id;
        if (olcum && olcum.yanitId === null) olcum.yanitId = id;
        break;
      }
      case "response.output_item.added": {
        const item = (o.item ?? {}) as Olay;
        if (item.type === "message" && typeof item.id === "string") {
          const r = String(o.response_id ?? aktifYanit ?? "");
          yanitMesajlari.set(r, [...(yanitMesajlari.get(r) ?? []), item.id]);
        }
        break;
      }
      case "response.output_item.done":
        e.push(...cagriIsle((o.item ?? {}) as Olay));
        break;
      case "response.output_audio_transcript.delta":
      case "response.output_text.delta": {
        const r = String(o.response_id ?? aktifYanit ?? "");
        yanitMetni.set(r, (yanitMetni.get(r) ?? "") + String(o.delta ?? ""));
        if (olcum && olcum.yanitId === r) {
          e.push({ tur: "olcum", ad: "dil_duzeltme", ms: an - olcum.iptalAn, dil: olcum.dil });
          olcum = null;
        }
        e.push(...yanitDiliniDenetle(r, an));
        break;
      }
      case "response.done": {
        const yanit = (o.response ?? {}) as Olay;
        const id = String(yanit.id ?? "") || aktifYanit || "";
        for (const item of Array.isArray(yanit.output) ? (yanit.output as Olay[]) : []) e.push(...cagriIsle(item));
        if (aktifYanit === id || aktifYanit === null || !id) aktifYanit = null;
        const mesajVardi = (yanitMesajlari.get(id) ?? []).length > 0;
        // Yalnız araç çağıran yanıt cevap DEĞİL: izleme, araç sonrası gelecek yanıta geçer.
        if (izle && izle.yanitId === id) {
          if (mesajVardi) izle = null;
          else izle.yanitId = null;
        }
        if (iptal && iptal.yanitId === id) {
          for (const m of yanitMesajlari.get(id) ?? []) e.push(gonder({ type: "conversation.item.delete", item_id: m }));
          kapsanmamis.add(`dil:${iptal.oge}`);
          iptal = null;
        }
        yanitMesajlari.delete(id);
        yanitMetni.delete(id);
        e.push(...dene(an));
        break;
      }
      case "error": {
        const hata = (o.error ?? {}) as Olay;
        const olayKimligi = String(hata.event_id ?? "");
        if (hata.code === "conversation_already_has_active_response") {
          istekAn = null;
          e.push({ tur: "not", kod: "yanit_kuyrukta" });
        } else if (olayKimligi.startsWith("cikti_")) {
          // Çağrının arkasına ekleme reddedildi (ör. öğe artık yok) → sona ekle, bir kez.
          const callId = olayKimligi.slice("cikti_".length);
          const ilk = ciktiOlaylari.get(callId);
          if (ilk) {
            ciktiOlaylari.delete(callId);
            const { previous_item_id: _atla, ...sade } = ilk;
            void _atla;
            onaysiz.set(callId, an);
            e.push(gonder({ ...sade, event_id: `tekrar_${callId}` }));
          }
        }
        break;
      }
      default:
        break;
    }
    return e;
  }

  function aracBitti(cagri: AracCagrisi, cikti: unknown, an: number): AkisEylemi[] {
    if (!calisan.delete(cagri.call_id)) return [];
    const olayi: Olay = {
      type: "conversation.item.create",
      event_id: `cikti_${cagri.call_id}`,
      item: { type: "function_call_output", call_id: cagri.call_id, output: JSON.stringify(cikti ?? null) },
    };
    if (cagri.itemId) olayi.previous_item_id = cagri.itemId;
    ciktiOlaylari.set(cagri.call_id, olayi);
    onaysiz.set(cagri.call_id, an);
    return [gonder(olayi)];
  }

  function metinGonder(metin: string, an: number): AkisEylemi[] {
    yaziSayaci += 1;
    const id = `yazi_${an.toString(36)}_${yaziSayaci}`.slice(0, 32);
    onaysiz.set(id, an);
    sonKullaniciOgesi = id;
    const e: AkisEylemi[] = [
      gonder({
        type: "conversation.item.create",
        item: { id, type: "message", role: "user", content: [{ type: "input_text", text: metin }] },
      }),
    ];
    const dil = dilPuani(metin)?.dil;
    if (dil) e.push(...kullaniciDili(dil, id, an));
    return e;
  }

  function tik(an: number): AkisEylemi[] {
    const e: AkisEylemi[] = [];
    if (istekAn !== null && an - istekAn > ISTEK_ZAMAN_ASIMI_MS) {
      istekAn = null;
      e.push({ tur: "not", kod: "yanit_yeniden_istendi" });
    }
    if (konusmaBittiAn !== null) {
      const sinir = konusmaOnayBekliyor ? ONAYSIZ_KONUSMA_BEKLEME_MS : KONUSMA_SONRASI_BEKLEME_MS;
      if (an - konusmaBittiAn >= sinir) {
        konusmaBittiAn = null;
        konusmaOnayBekliyor = false;
      }
    }
    for (const [k, t] of onaysiz) {
      if (an - t > ONAY_ZAMAN_ASIMI_MS) {
        onaysiz.delete(k);
        kapsanmamis.add(k);
      }
    }
    e.push(...dene(an));
    return e;
  }

  function durum(): Record<string, unknown> {
    return {
      aktifYanit,
      istekAn,
      konusuyor,
      calisan: [...calisan],
      onaysiz: [...onaysiz.keys()],
      kapsanmamis: [...kapsanmamis],
      oturumDili,
      izle,
      iptal,
    };
  }

  return { olay, aracBitti, metinGonder, tik, durum };
}
