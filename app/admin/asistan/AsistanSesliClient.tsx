"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  CANLI_ARKA_MODEL,
  CANLI_DAKIKA_USD,
  CANLI_MODEL,
  CANLI_SES,
  SESLI_DIL_ADI,
  SESLI_MODELLER,
  SESLI_NABIZ_ARALIGI_MS,
  SESLI_OTURUM_SINIRI_SN,
  SESLI_SES,
  SESLI_TRANSKRIPSIYON_MODELLERI,
  SESLI_VARSAYILAN_MODEL,
  SESLI_VARSAYILAN_TRANSKRIPSIYON,
  YAZI_MODEL,
  bosKullanim,
  dilPuani,
  dilTahmin,
  kullanimEkle,
  lunaMaliyetUsd,
  tahminiMaliyetUsd,
  type SesliDil,
  type SesliKullanim,
  type SesliMotor,
} from "@/lib/asistan-sesli-sabitler";
import { realtimeAkis, type AkisEylemi, type RealtimeAkis } from "@/lib/asistan-sesli-akis";

/**
 * SESLİ ASİSTAN — tarayıcı tarafı (Faz 1 web prototipi; 1b iki motor + dil güvencesi;
 * 1c akış düzeltmesi, ön ısıtma, yazılı yol, sabit sesler).
 *
 * REALTIME: mikrofon → `/api/asistan/oturum` (60 sn'lik anahtar) → WebRTC teklifi
 * `api.openai.com/v1/realtime/calls`'a → olaylar "oai-events" kanalında. Protokol kararları
 * (araç ne zaman çalışır, `response.create` ne zaman gider, dil kilidi) SAF durum
 * makinesinde: `lib/asistan-sesli-akis.ts` (Test 2 kilitlenmesinin kök sebebi orada).
 * Bu dosya yalnız eylemleri uygular ve dökümü çizer.
 *
 * GPT-LIVE: mikrofon → WebRTC teklifi `/api/asistan/canli`'ya (sunucu `/v1/live/sessions`)
 * → cevap SDP'si. Döküm `session.input_transcript.delta` / `session.output_transcript.delta`
 * (kimliksiz, "bitti" olayı yok → satırlar konuşmacı değişince açılır). Araç isteği arka
 * modelden `response.event` zarfıyla gelir; sonuç `response.item.create` + `response.create`.
 * Yazılı soru belgelenmediği için AYRI metin yoluna gider: `/api/asistan/yazi`.
 *
 * ÖN ISITMA (1c): görüşme başlarken ve açık kaldıkça (45 sn'de bir) `/api/asistan/arac`
 * `{isit:true}` ağır araçların 60 sn'lik önbelleğini doldurur; ilk ısıtmanın süreleri
 * döküme yazılır (soğuk süre ölçümü).
 *
 * FAZ 2a (`kayitAcik` = sunucuda `ASISTAN_SESLI_KAYIT=1`): oturum açılırken sunucu sınırları
 * denetler ve imzalı bir oturum jetonu verir; araç ve ön ısıtma istekleri jetonu taşır, ~15 sn'de
 * bir kalp atışı gider (saniyeyi sunucu sayar), bitişte son atış kaydı kapatır; "Bildir" tabloya
 * yazılır. Kapalıyken prototipin bugünkü davranışı aynen sürer.
 *
 * SAKLAMA YOK (karar 5): döküm yalnız bellekte; "Bildir" (kayıt kapalıyken) konsola + indirilen JSON'a yazar.
 * Kısa ömürlü anahtar yerel değişkende kalır, duruma ya da loga yazılmaz.
 */

type Rol = "kullanici" | "asistan" | "yazi" | "arac" | "sistem";
type Satir = { id: string; rol: Rol; metin: string };
type Durum = "hazir" | "baglaniyor" | "canli" | "bitti" | "hata";
type BitisSebebi = "kullanici" | "sure_doldu" | "arka_plan" | "baglanti_koptu" | "hata";
type Olay = Record<string, unknown>;
type OturumBilgisi = { motor: SesliMotor; model: string; ses: string; ek: string | null; dokumSade: boolean };
type IsitmaSatiri = { ad: string; sureMs: number; onbellek: string; hata: string | null };

const YAZIYOR = "…";
const TIK_MS = 250;
/** Önbellek ömrü 60 sn; 40 sn'den eski kayıt yenilenir → 45 sn'lik ısıtma önbelleği hiç boşaltmaz. */
const ISITMA_ARALIGI_MS = 45_000;
const ARAC_ISTEK_ZAMAN_ASIMI_MS = 25_000;
const YAZI_GECMIS_TAVANI = 12;
/** Bu hatalar akışın olağan parçası; durum makinesi kendi notunu yazar, ham hata gösterilmez. */
const SESSIZ_HATALAR = new Set(["conversation_already_has_active_response", "response_cancel_not_active"]);
/** Sunucunun Faz 2a sınır/kayıt kodları — kullanıcıya kendi dilinde anlatılır (`limit.*`). */
const LIMIT_KODLARI = new Set([
  "gun_siniri",
  "ay_siniri",
  "butce",
  "oturum_acik",
  "oturum_suresi_doldu",
  "kayit_tablo_yok",
  "jeton_sirri_yok",
]);

function sureMetni(sn: number): string {
  const m = Math.floor(sn / 60);
  const s = sn % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function jsonOku(r: Response): Promise<Record<string, unknown> | null> {
  if (!(r.headers.get("content-type") ?? "").includes("application/json")) return null;
  return (await r.json().catch(() => null)) as Record<string, unknown> | null;
}

const sayi = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const saniye = (ms: unknown) => (sayi(ms) / 1000).toFixed(1);

const SECIM = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function AsistanSesliClient({ kayitAcik = false }: { kayitAcik?: boolean }) {
  const t = useTranslations("asistanSesli");
  const [motor, setMotor] = useState<SesliMotor>("realtime");
  const [model, setModel] = useState(SESLI_VARSAYILAN_MODEL);
  const [transkripsiyon, setTranskripsiyon] = useState<string>(SESLI_VARSAYILAN_TRANSKRIPSIYON);
  const [durum, setDurum] = useState<Durum>("hazir");
  const [satirlar, setSatirlar] = useState<Satir[]>([]);
  const [gecenSn, setGecenSn] = useState(0);
  /** Oturumun süre sınırı — kayıt açıkken sunucunun verdiği (min 10 dk / kalan gün / kalan ay). */
  const [sinirSn, setSinirSn] = useState(SESLI_OTURUM_SINIRI_SN);
  const [kullanim, setKullanim] = useState<SesliKullanim>(bosKullanim);
  const [arkaToken, setArkaToken] = useState({ girdi: 0, cikti: 0 });
  const [yaziToken, setYaziToken] = useState({ girdi: 0, cikti: 0 });
  /** GPT-Live: sunucunun saydığı ses süresi (`session.usage.updated` → `usage.seconds`). */
  const [canliSesSn, setCanliSesSn] = useState<number | null>(null);
  const [hataMetni, setHataMetni] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);
  const [bitisSebebi, setBitisSebebi] = useState<BitisSebebi | null>(null);
  const [yazi, setYazi] = useState("");
  const [yaziBekliyor, setYaziBekliyor] = useState(false);
  const [mikrofonYok, setMikrofonYok] = useState(false);
  const [dil, setDil] = useState<SesliDil | null>(null);
  const [oturumBilgisi, setOturumBilgisi] = useState<OturumBilgisi | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const sesRef = useRef<HTMLAudioElement | null>(null);
  const sayacRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tikRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isitmaRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baslangicRef = useRef(0);
  const satirSayaciRef = useRef(0);
  /** Her görüşme bir numara alır; eski görüşmeden geç gelen sonuç yeni görüşmeye yazılmaz. */
  const oturumNoRef = useRef(0);
  /** Bağlanırken "Bitir"e basıldıysa kurulum yarıda bırakılır. */
  const iptalRef = useRef(false);
  /** Faz 2a: sunucunun verdiği imzalı oturum jetonu — araç, ön ısıtma ve kalp atışı taşır. */
  const oturumJetonuRef = useRef<string | null>(null);
  /** Bildir'in kaydı oturuma bağlayabilmesi için (oturum bitince de durur). */
  const bildirJetonuRef = useRef<string | null>(null);
  const sinirSnRef = useRef(SESLI_OTURUM_SINIRI_SN);
  const nabizRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Kalp atışına giden son maliyet tahmini ve arka model tokenları. */
  const maliyetRef = useRef(0);
  const arkaTokenRef = useRef({ girdi: 0, cikti: 0 });
  /** Bildir için araç kayıtları: döküm satırının sırası + ad + süre + önbellek etiketi. */
  const aracKayitlariRef = useRef<{ satirNo: number; ad: string; sureMs: number | null; onbellek: string | null }[]>([]);
  /** OpenAI öğe kimliği → döküm satırı (Realtime; döküm sesten SONRA gelebilir). */
  const satirKimligiRef = useRef(new Map<string, string>());
  const motorRef = useRef<SesliMotor>("realtime");
  /** Realtime protokol durum makinesi (görüşme başına bir tane). */
  const akisRef = useRef<RealtimeAkis | null>(null);
  const uygulaRef = useRef<(eylemler: AkisEylemi[]) => void>(() => {});
  const dilRef = useRef<SesliDil | null>(null);
  /** Live: kimliksiz döküm akışında o an kimin konuştuğu ve satırı. */
  const canliSiraRef = useRef<{ rol: Rol | null; satirId: string | null; kullaniciMetni: string }>({
    rol: null,
    satirId: null,
    kullaniciMetni: "",
  });
  /** Live: aynı araç çağrısı iki kez çalışmasın. */
  const canliCagrilarRef = useRef(new Set<string>());

  const satirEkle = useCallback((rol: Rol, metin: string, anahtar?: string): string => {
    satirSayaciRef.current += 1;
    const id = `s${satirSayaciRef.current}`;
    if (anahtar) satirKimligiRef.current.set(anahtar, id);
    setSatirlar((once) => [...once, { id, rol, metin }]);
    return id;
  }, []);

  const satirYaz = useCallback((id: string, yaz: (metin: string) => string) => {
    setSatirlar((once) => once.map((s) => (s.id === id ? { ...s, metin: yaz(s.metin) } : s)));
  }, []);

  const gonder = useCallback((olay: Olay) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(olay));
  }, []);

  /** Faz 2a: son kalp atışı — kayıt kapanır. Sayfa kapanırken de gitsin diye `keepalive`. */
  const sonNabizGonder = useCallback((sebep: BitisSebebi) => {
    const jeton = oturumJetonuRef.current;
    if (!jeton) return;
    oturumJetonuRef.current = null;
    void fetch("/api/asistan/nabiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        oturumJetonu: jeton,
        bitti: true,
        sebep,
        tahminiMaliyetUsd: maliyetRef.current,
        arkaToken: arkaTokenRef.current,
      }),
    }).catch(() => {});
  }, []);

  /** Bağlantıyı kapatır. YALNIZ referanslar — sayfadan çıkarken de çağrılır, durum yazmaz. */
  const kapat = useCallback(() => {
    for (const ref of [sayacRef, tikRef, isitmaRef, nabizRef]) {
      if (ref.current) {
        clearInterval(ref.current);
        ref.current = null;
      }
    }
    akisRef.current = null;
    const pc = pcRef.current;
    pcRef.current = null;
    if (motorRef.current === "live" && dcRef.current?.readyState === "open") {
      dcRef.current.send(JSON.stringify({ type: "session.close" }));
    }
    dcRef.current?.close();
    dcRef.current = null;
    pc?.getSenders().forEach((s) => s.track?.stop());
    pc?.close();
    micRef.current?.getTracks().forEach((iz) => iz.stop());
    micRef.current = null;
    if (sesRef.current) sesRef.current.srcObject = null;
  }, []);

  const bitir = useCallback(
    (sebep: BitisSebebi) => {
      if (!pcRef.current) return;
      sonNabizGonder(sebep);
      kapat();
      setBitisSebebi(sebep);
      setDurum("bitti");
    },
    [kapat, sonNabizGonder]
  );

  /** Faz 2a: kalp atışı. Sunucu "süre doldu" derse görüşme kapanır. */
  const nabizAt = useCallback(async () => {
    const jeton = oturumJetonuRef.current;
    if (!jeton) return;
    try {
      const r = await fetch("/api/asistan/nabiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oturumJetonu: jeton, tahminiMaliyetUsd: maliyetRef.current, arkaToken: arkaTokenRef.current }),
      });
      const j = await jsonOku(r);
      if (j?.ok && j.bitir === true) bitir("sure_doldu");
    } catch {
      // Ağ hatası: bir sonraki atış yeniden dener; saniyeyi zaten sunucu sayıyor.
    }
  }, [bitir]);

  /** "Bitir" düğmesi: bağlantı varsa kapatır, kurulum sürüyorsa yarıda keser. */
  const kullaniciBitirdi = () => {
    if (pcRef.current) {
      bitir("kullanici");
      return;
    }
    sonNabizGonder("kullanici");
    iptalRef.current = true;
    setBitisSebebi("kullanici");
    setDurum("bitti");
  };

  // Karar 7: sekme arka plana gidince görüşme biter.
  useEffect(() => {
    const gorunurluk = () => {
      if (document.hidden) bitir("arka_plan");
    };
    document.addEventListener("visibilitychange", gorunurluk);
    return () => document.removeEventListener("visibilitychange", gorunurluk);
  }, [bitir]);

  useEffect(
    () => () => {
      sonNabizGonder("kullanici");
      kapat();
    },
    [kapat, sonNabizGonder]
  );

  const onbellekEki = useCallback(
    (d: unknown) => (d === "tam" ? ` · ${t("onbellekTam")}` : d === "kismi" ? ` · ${t("onbellekKismi")}` : ""),
    [t]
  );

  /** Aracı sunucuda çalıştırır, döküme sunucu + toplam süreyi yazar, modelin göreceği sonucu döndürür. */
  const aracIste = useCallback(
    async (ad: string, argumanlar: string): Promise<unknown> => {
      const satirId = satirEkle("arac", t("aracCalisiyor", { ad }));
      const t0 = performance.now();
      const kesici = new AbortController();
      const zamanlayici = setTimeout(() => kesici.abort(), ARAC_ISTEK_ZAMAN_ASIMI_MS);
      try {
        const jeton = oturumJetonuRef.current;
        const r = await fetch("/api/asistan/arac", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(jeton ? { "x-sesli-oturum": jeton } : {}) },
          body: JSON.stringify({ ad, girdi: argumanlar }),
          signal: kesici.signal,
        });
        const j = await jsonOku(r);
        const toplam = ((performance.now() - t0) / 1000).toFixed(1);
        if (r.ok && j?.ok) {
          aracKayitlariRef.current.push({
            satirNo: Number(satirId.slice(1)),
            ad,
            sureMs: typeof j.sureMs === "number" ? j.sureMs : null,
            onbellek: typeof j.onbellek === "string" ? j.onbellek : null,
          });
          satirYaz(satirId, () => `${t("aracBitti", { ad, sn: saniye(j.sureMs), toplam })}${onbellekEki(j.onbellek)}`);
          return j.sonuc;
        }
        // Faz 2a: oturumun süresi SUNUCUDA doldu → araç veri vermez, görüşme kapanır.
        if (r.status === 401 && j?.error === "oturum_suresi_doldu") bitir("sure_doldu");
        satirYaz(satirId, () => t("aracHata", { ad }));
        return { hata: j?.error ?? "arac_ucu_hatasi", durum: r.status };
      } catch {
        satirYaz(satirId, () => t("aracHata", { ad }));
        return { hata: "ag_hatasi" };
      } finally {
        clearTimeout(zamanlayici);
      }
    },
    [bitir, onbellekEki, satirEkle, satirYaz, t]
  );

  /** Realtime durum makinesinin eylemlerini uygular. */
  const uygula = useCallback(
    (eylemler: AkisEylemi[]) => {
      for (const e of eylemler) {
        switch (e.tur) {
          case "gonder":
            gonder(e.olay);
            break;
          case "arac": {
            const oturum = oturumNoRef.current;
            void aracIste(e.cagri.name, e.cagri.arguments).then((cikti) => {
              const akis = akisRef.current;
              if (!akis || oturumNoRef.current !== oturum) return;
              uygulaRef.current(akis.aracBitti(e.cagri, cikti, Date.now()));
            });
            break;
          }
          case "dil":
            dilRef.current = e.dil;
            setDil(e.dil);
            break;
          case "olcum":
            satirEkle("sistem", t("dilDuzeltme", { dil: t(`dilAdi.${e.dil}`), ms: e.ms }));
            break;
          case "not":
            satirEkle("sistem", t(`akisNotu.${e.kod}`));
            break;
        }
      }
    },
    [aracIste, gonder, satirEkle, t]
  );

  useEffect(() => {
    uygulaRef.current = uygula;
  }, [uygula]);

  /** Live: dil değiştiyse motora bildirir (Realtime'da bunu durum makinesi yapar). */
  const canliDilGuncelle = useCallback(
    (yeni: SesliDil | null) => {
      if (!yeni || yeni === dilRef.current) return;
      dilRef.current = yeni;
      setDil(yeni);
      const ad = SESLI_DIL_ADI[yeni];
      gonder({
        type: "session.instructions.append",
        content: `Current user language: ${ad}. Reply in ${ad} until the user switches.`,
        delegation_id: null,
      });
    },
    [gonder]
  );

  const realtimeOlay = useCallback(
    (olay: Olay) => {
      const kullaniciSatiri = () => {
        const anahtar = `k:${String(olay.item_id ?? "")}`;
        return satirKimligiRef.current.get(anahtar) ?? satirEkle("kullanici", YAZIYOR, anahtar);
      };
      const asistanSatiri = () => {
        const anahtar = `a:${String(olay.item_id ?? olay.response_id ?? "")}`;
        return satirKimligiRef.current.get(anahtar) ?? satirEkle("asistan", "", anahtar);
      };

      // Döküm — yalnız ekran.
      switch (olay.type) {
        case "input_audio_buffer.committed":
          kullaniciSatiri();
          break;
        case "conversation.item.input_audio_transcription.delta": {
          const parca = String(olay.delta ?? "");
          satirYaz(kullaniciSatiri(), (m) => (m === YAZIYOR ? parca : m + parca));
          break;
        }
        case "conversation.item.input_audio_transcription.completed": {
          const metin = String(olay.transcript ?? "").trim();
          satirYaz(kullaniciSatiri(), (m) => metin || m);
          break;
        }
        case "response.output_audio_transcript.delta":
        case "response.output_text.delta": {
          const parca = String(olay.delta ?? "");
          satirYaz(asistanSatiri(), (m) => m + parca);
          break;
        }
        case "response.output_audio_transcript.done":
        case "response.output_text.done": {
          const son = String(olay.transcript ?? olay.text ?? "");
          if (son) satirYaz(asistanSatiri(), () => son);
          break;
        }
        case "response.done":
          setKullanim((k) => kullanimEkle(k, ((olay.response ?? {}) as Olay).usage));
          break;
        case "error": {
          const e = (olay.error ?? {}) as Olay;
          if (!SESSIZ_HATALAR.has(String(e.code ?? ""))) satirEkle("sistem", String(e.message ?? e.code ?? "error"));
          break;
        }
        default:
          break;
      }

      // Protokol — durum makinesi.
      const akis = akisRef.current;
      if (akis) uygula(akis.olay(olay, Date.now()));
    },
    [satirEkle, satirYaz, uygula]
  );

  const canliOlay = useCallback(
    async (olay: Olay) => {
      const sira = canliSiraRef.current;
      const konusmaci = (rol: "kullanici" | "asistan", parca: string) => {
        let id = sira.satirId;
        if (sira.rol !== rol || !id) {
          // Konuşmacı kullanıcıdan asistana geçti → kullanıcının cümlesi bitti, dili tespit et.
          if (rol === "asistan" && sira.rol === "kullanici") canliDilGuncelle(dilTahmin(sira.kullaniciMetni));
          id = satirEkle(rol, "");
          sira.rol = rol;
          sira.satirId = id;
          if (rol === "kullanici") sira.kullaniciMetni = "";
        }
        if (rol === "kullanici") {
          sira.kullaniciMetni += parca;
          // Faz 1c: dili cümle bitmeden, yeterli kanıt birikince bildir (cevap başlamadan).
          const kanit = dilPuani(sira.kullaniciMetni);
          if (kanit && kanit.puan >= 2) canliDilGuncelle(kanit.dil);
        }
        satirYaz(id, (m) => m + parca);
      };

      switch (olay.type) {
        case "session.input_transcript.delta":
          konusmaci("kullanici", String(olay.delta ?? ""));
          break;
        case "session.output_transcript.delta":
          konusmaci("asistan", String(olay.delta ?? ""));
          break;
        case "response.event": {
          const ic = (olay.event ?? {}) as Olay;
          const oge = (ic.item ?? {}) as Olay;
          if (ic.type === "response.output_item.done" && oge.type === "function_call") {
            const callId = String(oge.call_id ?? "");
            if (!callId || canliCagrilarRef.current.has(callId)) break;
            canliCagrilarRef.current.add(callId);
            sira.rol = "arac";
            const oturum = oturumNoRef.current;
            const cikti = await aracIste(String(oge.name ?? ""), String(oge.arguments ?? ""));
            if (oturumNoRef.current !== oturum) break;
            gonder({ type: "response.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(cikti) } });
            gonder({ type: "response.create" });
          } else if (ic.type === "response.completed") {
            const u = (((ic.response ?? {}) as Olay).usage ?? {}) as Olay;
            setArkaToken((o) => ({ girdi: o.girdi + sayi(u.input_tokens), cikti: o.cikti + sayi(u.output_tokens) }));
          }
          break;
        }
        case "session.usage.updated": {
          // Belge: "Use the latest usage.seconds as the running total for voice duration."
          const u = (olay.usage ?? {}) as Olay;
          if (typeof u.seconds === "number") setCanliSesSn(u.seconds);
          break;
        }
        case "session.closed": {
          const u = (olay.usage ?? {}) as Olay;
          if (typeof u.seconds === "number") setCanliSesSn(u.seconds);
          bitir("baglanti_koptu");
          break;
        }
        case "error": {
          const e = (olay.error ?? {}) as Olay;
          satirEkle("sistem", String(e.message ?? e.code ?? "error"));
          break;
        }
        default:
          break;
      }
    },
    [aracIste, bitir, canliDilGuncelle, gonder, satirEkle, satirYaz]
  );

  /** Ön ısıtma: ilk çağrının süreleri döküme yazılır (soğuk ölçüm); periyodik çağrılar sessiz. */
  const isit = useCallback(
    async (ilk: boolean) => {
      const oturum = oturumNoRef.current;
      try {
        const jeton = oturumJetonuRef.current;
        const r = await fetch("/api/asistan/arac", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(jeton ? { "x-sesli-oturum": jeton } : {}) },
          body: JSON.stringify({ isit: true, ilk }),
        });
        const j = await jsonOku(r);
        if (!ilk || oturumNoRef.current !== oturum) return;
        if (r.ok && j?.ok && Array.isArray(j.isitma)) {
          const liste = (j.isitma as IsitmaSatiri[])
            .map((x) => `${x.ad} ${saniye(x.sureMs)} sn${x.hata ? ` (${x.hata})` : ""}`)
            .join(" · ");
          satirEkle("sistem", t("onIsitma", { liste }));
        } else {
          satirEkle("sistem", t("onIsitmaHata", { kod: String(j?.error ?? r.status) }));
        }
      } catch {
        if (ilk && oturumNoRef.current === oturum) satirEkle("sistem", t("onIsitmaHata", { kod: "ag" }));
      }
    },
    [satirEkle, t]
  );

  const baslat = async () => {
    if (durum === "baglaniyor" || durum === "canli") return;
    oturumNoRef.current += 1;
    setHataMetni(null);
    setBilgi(null);
    setBitisSebebi(null);
    setSatirlar([]);
    setKullanim(bosKullanim());
    setArkaToken({ girdi: 0, cikti: 0 });
    setYaziToken({ girdi: 0, cikti: 0 });
    setCanliSesSn(null);
    setGecenSn(0);
    setOturumBilgisi(null);
    setDil(null);
    satirKimligiRef.current.clear();
    canliSiraRef.current = { rol: null, satirId: null, kullaniciMetni: "" };
    canliCagrilarRef.current.clear();
    dilRef.current = null;
    akisRef.current = null;
    oturumJetonuRef.current = null;
    bildirJetonuRef.current = null;
    aracKayitlariRef.current = [];
    sinirSnRef.current = SESLI_OTURUM_SINIRI_SN;
    setSinirSn(SESLI_OTURUM_SINIRI_SN);
    iptalRef.current = false;
    motorRef.current = motor;
    setDurum("baglaniyor");

    let mic: MediaStream | null = null;
    try {
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        mic = null; // izin yok → Realtime'da yalnız yazı (karar 8); cevap yine sesli gelir
      }
      setMikrofonYok(mic === null);
      if (iptalRef.current) {
        mic?.getTracks().forEach((iz) => iz.stop());
        return;
      }
      // Bağlantı kurulurken ağır araçlar önbelleğe alınır (soru gelmeden). Kayıt açıkken
      // ön ısıtma da jeton ister → oturum açıldıktan sonra başlar.
      if (!kayitAcik) void isit(true);
      /** Sunucunun oturum yanıtından jeton + sınır (kayıt açıkken). */
      const oturumuAl = (j: Record<string, unknown>) => {
        const jeton = typeof j.oturumJetonu === "string" ? j.oturumJetonu : null;
        oturumJetonuRef.current = jeton;
        bildirJetonuRef.current = jeton;
        const sinir = typeof j.sinirSn === "number" && j.sinirSn > 0 ? j.sinirSn : SESLI_OTURUM_SINIRI_SN;
        sinirSnRef.current = sinir;
        setSinirSn(sinir);
        if (kayitAcik) void isit(true);
      };
      const oturumHatasi = (kod: string, varsayilan: string) =>
        new Error(LIMIT_KODLARI.has(kod) ? t(`limit.${kod}`) : varsayilan);

      // Realtime: önce kısa ömürlü anahtar. Live: anahtar yok, SDP sunucudan geçer.
      let istemciSirri = "";
      if (motor === "realtime") {
        const r = await fetch("/api/asistan/oturum", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, transkripsiyon }),
        });
        const j = await jsonOku(r);
        if (!j) throw new Error(t("hata.oturumGecersiz"));
        if (!r.ok || !j.ok) {
          throw oturumHatasi(String(j.error ?? ""), t("hata.oturum", { kod: String(j.error ?? r.status) }));
        }
        oturumuAl(j);
        istemciSirri = String(j.istemciSirri ?? "");
        akisRef.current = realtimeAkis(String(j.talimat ?? ""));
        setOturumBilgisi({
          motor: "realtime",
          model: String(j.model ?? model),
          ses: String(j.ses ?? SESLI_SES),
          ek: String(j.transkripsiyon ?? ""),
          dokumSade: j.dokumSade === true,
        });
      }
      if (iptalRef.current) {
        mic?.getTracks().forEach((iz) => iz.stop());
        return;
      }

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      micRef.current = mic;
      pc.ontrack = (e) => {
        if (sesRef.current) sesRef.current.srcObject = e.streams[0];
      };
      if (mic) {
        const akis = mic;
        akis.getTracks().forEach((iz) => pc.addTrack(iz, akis));
      } else {
        pc.addTransceiver("audio", { direction: "recvonly" });
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" && pcRef.current === pc) bitir("baglanti_koptu");
      };

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("open", () => {
        baslangicRef.current = Date.now();
        setDurum("canli");
        sayacRef.current = setInterval(() => {
          const sn = Math.floor((Date.now() - baslangicRef.current) / 1000);
          setGecenSn(sn);
          if (sn >= sinirSnRef.current) bitir("sure_doldu");
        }, 1000);
        if (oturumJetonuRef.current) {
          void nabizAt();
          nabizRef.current = setInterval(() => void nabizAt(), SESLI_NABIZ_ARALIGI_MS);
        }
        if (motor === "realtime") {
          tikRef.current = setInterval(() => {
            const akis = akisRef.current;
            if (akis) uygulaRef.current(akis.tik(Date.now()));
          }, TIK_MS);
        }
        isitmaRef.current = setInterval(() => void isit(false), ISITMA_ARALIGI_MS);
      });
      const isle = motor === "realtime" ? realtimeOlay : canliOlay;
      dc.addEventListener("message", (e) => {
        let olay: Olay;
        try {
          olay = JSON.parse(String(e.data)) as Olay;
        } catch {
          return;
        }
        void isle(olay);
      });
      dc.addEventListener("close", () => {
        if (pcRef.current === pc) bitir("baglanti_koptu");
      });

      const teklif = await pc.createOffer();
      await pc.setLocalDescription(teklif);

      let cevapSdp: string;
      if (motor === "realtime") {
        const cevap = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          body: teklif.sdp,
          headers: { Authorization: `Bearer ${istemciSirri}`, "Content-Type": "application/sdp" },
        });
        if (!cevap.ok) throw new Error(t("hata.openai", { durum: cevap.status }));
        cevapSdp = await cevap.text();
      } else {
        const r = await fetch("/api/asistan/canli", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sdp: teklif.sdp }),
        });
        const j = await jsonOku(r);
        if (!j) throw new Error(t("hata.oturumGecersiz"));
        if (!r.ok || !j.ok) {
          const ayrinti = [j.error, j.saglayiciDurum, j.saglayiciKod].filter(Boolean).join(" · ");
          throw oturumHatasi(String(j.error ?? ""), t("hata.canli", { kod: ayrinti || String(r.status) }));
        }
        oturumuAl(j);
        cevapSdp = String(j.sdp ?? "");
        setOturumBilgisi({
          motor: "live",
          model: String(j.model ?? CANLI_MODEL),
          ses: String(j.ses ?? CANLI_SES),
          ek: String(j.arkaModel ?? CANLI_ARKA_MODEL),
          dokumSade: false,
        });
      }
      await pc.setRemoteDescription({ type: "answer", sdp: cevapSdp });
    } catch (e) {
      if (!pcRef.current) mic?.getTracks().forEach((iz) => iz.stop());
      sonNabizGonder("hata");
      kapat();
      setDurum("hata");
      setBitisSebebi("hata");
      setHataMetni(e instanceof Error ? e.message : t("hata.genel", { mesaj: String(e) }));
    }
  };

  const canli = durum === "canli";
  const mesgul = durum === "baglaniyor" || canli;
  /** Yazılı yolun motoru: seçim kutusu görüşme boyunca kilitli, yani açık görüşmenin motoru. */
  const etkinMotor: SesliMotor = motor;
  /** Maliyet göstergesi: son görüşmenin motoru (görüşme bitip seçim değişse de o görüşmeyi gösterir). */
  const maliyetMotoru: SesliMotor = oturumBilgisi?.motor ?? motor;

  /** GPT-Live yazılı yolu: `/api/asistan/yazi` — ses oturumundan bağımsız, aynı araçlar. */
  const yaziSor = async (metin: string) => {
    const gecmis = satirlar
      .filter((s) => (s.rol === "kullanici" || s.rol === "asistan" || s.rol === "yazi") && s.metin && s.metin !== YAZIYOR)
      .slice(-YAZI_GECMIS_TAVANI)
      .map((s) => ({ rol: s.rol === "kullanici" ? "kullanici" : "asistan", metin: s.metin.slice(0, 2000) }));
    satirEkle("kullanici", metin);
    const satirId = satirEkle("arac", t("yaziGonderiliyor"));
    setYaziBekliyor(true);
    const kanit = dilTahmin(metin);
    if (kanit && etkinMotor === "live") canliDilGuncelle(kanit);
    try {
      const r = await fetch("/api/asistan/yazi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metin, gecmis }),
      });
      const j = await jsonOku(r);
      if (r.ok && j?.ok) {
        const araclar = Array.isArray(j.araclar) ? (j.araclar as Record<string, unknown>[]) : [];
        const aracMetni =
          araclar.map((a) => `${String(a.ad)} ${saniye(a.sureMs)} sn${onbellekEki(a.onbellek)}`).join(", ") || "—";
        satirYaz(satirId, () => t("yaziBitti", { model: String(j.model ?? YAZI_MODEL), sn: saniye(j.sureMs), araclar: aracMetni }));
        satirEkle("yazi", String(j.metin ?? ""));
        const k = (j.kullanim ?? {}) as Record<string, unknown>;
        setYaziToken((o) => ({ girdi: o.girdi + sayi(k.girdi), cikti: o.cikti + sayi(k.cikti) }));
      } else {
        const kod = [j?.error, j?.saglayiciDurum, j?.saglayiciKod].filter(Boolean).join(" · ") || String(r.status);
        const sinirKodu = String(j?.error ?? "");
        satirYaz(satirId, () => (LIMIT_KODLARI.has(sinirKodu) ? t(`limit.${sinirKodu}`) : t("yaziHata", { kod })));
      }
    } catch {
      satirYaz(satirId, () => t("yaziHata", { kod: "ag" }));
    } finally {
      setYaziBekliyor(false);
    }
  };

  const yaziGonder = () => {
    const metin = yazi.trim();
    if (!metin) return;
    if (etkinMotor === "live") {
      if (yaziBekliyor) return;
      setYazi("");
      void yaziSor(metin);
      return;
    }
    const akis = akisRef.current;
    if (!canli || !akis) return;
    satirEkle("kullanici", metin);
    uygula(akis.metinGonder(metin, Date.now()));
    setYazi("");
  };

  /** JSON indirme — kayıt kapalıyken (ve sunucuya yazılamazsa yedek olarak). */
  const jsonIndir = (kayit: { an: string }) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(kayit, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sesli-asistan-bildirim-${kayit.an.replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Karar 5: "Bildir". Kayıt açıkken (Faz 2a) son soru-cevap `asistan_bildirimleri`ne yazılır
   * (90 gün); yazılamazsa JSON indirilir. Kayıt kapalıyken konsol + JSON (prototip).
   */
  const bildir = async () => {
    const sira = [...satirlar].reverse().findIndex((s) => s.rol === "kullanici" && s.metin !== YAZIYOR);
    if (sira === -1) {
      setBilgi(t("bildirYok"));
      return;
    }
    const soruIndeksi = satirlar.length - 1 - sira;
    const sonrasi = satirlar.slice(soruIndeksi + 1);
    const kayit = {
      tur: "sesli_asistan_bildirimi",
      surum: 3,
      an: new Date().toISOString(),
      motor: oturumBilgisi?.motor ?? etkinMotor,
      model: oturumBilgisi?.model ?? (etkinMotor === "live" ? CANLI_MODEL : model),
      ses: oturumBilgisi?.ses ?? (etkinMotor === "live" ? CANLI_SES : SESLI_SES),
      ek: oturumBilgisi?.ek ?? null,
      dil: dil,
      soru: satirlar[soruIndeksi].metin,
      cevap: sonrasi
        .filter((s) => s.rol === "asistan" || s.rol === "yazi")
        .map((s) => s.metin)
        .join(" ")
        .trim(),
      araclar: sonrasi.filter((s) => s.rol === "arac").map((s) => s.metin),
      sistem: sonrasi.filter((s) => s.rol === "sistem").map((s) => s.metin),
      oturumSn: gecenSn,
      not: kayitAcik ? "Faz 2a: sunucuya yazılır (90 gün)." : "Faz 1 prototipi: sunucuya gönderilmez, saklanmaz.",
    };
    console.info("[sesli-asistan:bildir]", kayit);
    if (kayitAcik) {
      const soruNo = Number(satirlar[soruIndeksi].id.slice(1));
      const araclar = aracKayitlariRef.current
        .filter((a) => a.satirNo > soruNo)
        .map(({ ad, sureMs, onbellek }) => ({ ad, sureMs, onbellek }));
      try {
        const r = await fetch("/api/asistan/bildir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            oturumJetonu: bildirJetonuRef.current,
            motor: kayit.motor,
            model: kayit.model,
            dil: kayit.dil,
            soru: kayit.soru,
            cevap: kayit.cevap,
            araclar,
          }),
        });
        const j = await jsonOku(r);
        if (r.ok && j?.ok) {
          setBilgi(t("bildirKaydedildi"));
          return;
        }
        jsonIndir(kayit);
        setBilgi(t("bildirKayitHata", { kod: String(j?.error ?? r.status) }));
      } catch {
        jsonIndir(kayit);
        setBilgi(t("bildirKayitHata", { kod: "ag" }));
      }
      return;
    }
    jsonIndir(kayit);
    setBilgi(t("bildirIndi"));
  };

  const arkaVar = arkaToken.girdi + arkaToken.cikti > 0;
  const yaziVar = yaziToken.girdi + yaziToken.cikti > 0;
  const maliyet =
    maliyetMotoru === "live"
      ? ((canliSesSn ?? gecenSn) / 60) * CANLI_DAKIKA_USD +
        lunaMaliyetUsd(arkaToken.girdi, arkaToken.cikti) +
        lunaMaliyetUsd(yaziToken.girdi, yaziToken.cikti)
      : tahminiMaliyetUsd(oturumBilgisi?.model ?? model, kullanim);
  const yaziAcik = etkinMotor === "live" ? !yaziBekliyor : canli;

  // Kalp atışı en son tahmini ve arka model tokenlarını taşır (sunucu tabanla kıyaslar).
  useEffect(() => {
    maliyetRef.current = maliyet;
  }, [maliyet]);
  useEffect(() => {
    arkaTokenRef.current = arkaToken;
  }, [arkaToken]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("aciklama")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("motor")}</span>
              <select
                value={motor}
                onChange={(e) => setMotor(e.target.value as SesliMotor)}
                disabled={mesgul}
                className={SECIM}
              >
                <option value="realtime">{t("motorRealtime")}</option>
                <option value="live">{t("motorLive")}</option>
              </select>
            </label>
            {motor === "realtime" ? (
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">{t("model")}</span>
                <select value={model} onChange={(e) => setModel(e.target.value)} disabled={mesgul} className={SECIM}>
                  {SESLI_MODELLER.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="space-y-1 text-sm">
                <span className="text-muted-foreground">{t("model")}</span>
                <p className="flex h-9 items-center text-sm">
                  {CANLI_MODEL} · {t("arkaModel", { model: CANLI_ARKA_MODEL })}
                </p>
              </div>
            )}
            <div className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("ses")}</span>
              <p className="flex h-9 items-center text-sm">
                {t("sesSabit", { ses: motor === "realtime" ? SESLI_SES : CANLI_SES })}
              </p>
            </div>
            {motor === "realtime" ? (
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">{t("dokumModeli")}</span>
                <select
                  value={transkripsiyon}
                  onChange={(e) => setTranskripsiyon(e.target.value)}
                  disabled={mesgul}
                  className={SECIM}
                >
                  {SESLI_TRANSKRIPSIYON_MODELLERI.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="self-end text-xs text-muted-foreground">{t("canliNot")}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {mesgul ? (
              <Button variant="destructive" onClick={kullaniciBitirdi}>
                {t("bitir")}
              </Button>
            ) : (
              <Button onClick={baslat}>{t("baslat")}</Button>
            )}
            <span className="text-sm font-medium">{t(`durum.${durum}`)}</span>
            <span className="text-sm tabular-nums text-muted-foreground">
              {t("sure")}: {sureMetni(gecenSn)} / {sureMetni(sinirSn)}
            </span>
            <span className="text-sm tabular-nums text-muted-foreground">
              {t("maliyet")}: ${maliyet.toFixed(4)}
            </span>
            <span className="text-sm text-muted-foreground">
              {t("dil")}: {dil ? t(`dilAdi.${dil}`) : t("dilYok")}
            </span>
          </div>

          {maliyetMotoru === "live" ? (
            <p className="text-xs text-muted-foreground">
              {arkaVar
                ? t("canliMaliyetTam", { model: CANLI_ARKA_MODEL, girdi: arkaToken.girdi, cikti: arkaToken.cikti })
                : t("canliMaliyetSesKatmani")}
              {canliSesSn !== null ? ` ${t("canliSesSuresi", { sn: canliSesSn })}` : ""}
              {yaziVar ? ` ${t("yaziMaliyet", { girdi: yaziToken.girdi, cikti: yaziToken.cikti })}` : ""}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("maliyetNot")}{" "}
              {t("tokenlar", {
                sesGirdi: kullanim.sesGirdi,
                sesCikti: kullanim.sesCikti,
                metinGirdi: kullanim.metinGirdi,
                metinCikti: kullanim.metinCikti,
              })}
            </p>
          )}
          {kayitAcik ? (
            <p className="text-xs text-muted-foreground">{t("kayitNot", { dk: Math.round(sinirSn / 60) })}</p>
          ) : null}
          {oturumBilgisi?.motor === "realtime" && oturumBilgisi.ek ? (
            <p className="text-xs text-muted-foreground">
              {t("transkripsiyon", { model: oturumBilgisi.ek })}
              {oturumBilgisi.dokumSade ? ` · ${t("dokumSadeNot")}` : ""}
            </p>
          ) : null}
          {mikrofonYok && mesgul ? <p className="text-sm text-amber-800 dark:text-amber-200">{t("mikrofonYok")}</p> : null}
          {hataMetni ? <p className="text-sm text-destructive">{hataMetni}</p> : null}
          {bitisSebebi && bitisSebebi !== "hata" ? (
            <p className="text-sm text-muted-foreground">{t(`bitisSebebi.${bitisSebebi}`)}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">{t("dokum")}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => void bildir()} title={kayitAcik ? t("bildirIpucuKayit") : t("bildirIpucu")}>
            {t("bildir")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div aria-live="polite" className="max-h-[50vh] space-y-2 overflow-y-auto">
            {satirlar.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("bos")}</p>
            ) : (
              satirlar.map((s) => (
                <p
                  key={s.id}
                  className={
                    s.rol === "asistan" || s.rol === "yazi"
                      ? "whitespace-pre-line text-sm"
                      : s.rol === "kullanici"
                        ? "text-sm font-medium"
                        : "text-xs text-muted-foreground"
                  }
                >
                  <span className="mr-2 text-xs uppercase tracking-wide text-muted-foreground">{t(`rol.${s.rol}`)}</span>
                  {s.metin}
                </p>
              ))
            )}
          </div>
          {bilgi ? <p className="text-xs text-muted-foreground">{bilgi}</p> : null}
          {etkinMotor === "live" ? (
            <p className="text-xs text-muted-foreground">{t("canliYaziYolu", { model: YAZI_MODEL })}</p>
          ) : null}
          <div className="flex items-end gap-2">
            <Textarea
              value={yazi}
              onChange={(e) => setYazi(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  yaziGonder();
                }
              }}
              placeholder={t("yaziYer")}
              disabled={!yaziAcik}
              rows={2}
            />
            <Button onClick={yaziGonder} disabled={!yaziAcik || !yazi.trim()}>
              {t("gonder")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <audio ref={sesRef} autoPlay className="hidden" />
    </div>
  );
}
