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
  CANLI_SESLER,
  CANLI_VARSAYILAN_SES,
  SESLI_ADAY_SESLER,
  SESLI_DIL_ADI,
  SESLI_MODELLER,
  SESLI_OTURUM_SINIRI_SN,
  SESLI_SESLER,
  SESLI_TRANSKRIPSIYON_MODELLERI,
  SESLI_VARSAYILAN_MODEL,
  SESLI_VARSAYILAN_SES,
  SESLI_VARSAYILAN_TRANSKRIPSIYON,
  bosKullanim,
  dilTahmin,
  kullanimEkle,
  tahminiMaliyetUsd,
  type SesliDil,
  type SesliKullanim,
  type SesliMotor,
} from "@/lib/asistan-sesli-sabitler";

/**
 * SESLİ ASİSTAN — tarayıcı tarafı (Faz 1 web prototipi; Faz 1b: iki motor + dil güvencesi).
 *
 * REALTIME: mikrofon → `/api/asistan/oturum` (60 sn'lik anahtar) → WebRTC teklifi
 * `api.openai.com/v1/realtime/calls`'a → olaylar "oai-events" kanalında. Araç isteği
 * (`response.done` içinde `function_call`, yalnız `status: completed`) `/api/asistan/arac`'a
 * gider; sonuç `function_call_output` + `response.create` ile döner.
 *
 * GPT-LIVE: mikrofon → WebRTC teklifi `/api/asistan/canli`'ya (sunucu `/v1/live/sessions`)
 * → cevap SDP'si. Döküm `session.input_transcript.delta` / `session.output_transcript.delta`
 * (kimliksiz, "bitti" olayı yok → satırlar konuşmacı değişince açılır). Araç isteği arka
 * modelden `response.event` zarfıyla gelir; sonuç `response.item.create` + `response.create`.
 *
 * DİL GÜVENCESİ (karar 4): kullanıcının cümlesi bitince dili tespit edilir (`gpt-transcribe`
 * `languages` döndürürse o, yoksa metin sezgisi); değiştiyse Realtime'da `session.update`
 * ile talimata "Current user language" bölümü eklenir, Live'da `session.instructions.append`.
 *
 * SAKLAMA YOK (karar 5): döküm yalnız bellekte; "Bildir" konsola + indirilen JSON'a yazar.
 * Kısa ömürlü anahtar yerel değişkende kalır, duruma ya da loga yazılmaz.
 */

type Rol = "kullanici" | "asistan" | "arac" | "sistem";
type Satir = { id: string; rol: Rol; metin: string };
type Durum = "hazir" | "baglaniyor" | "canli" | "bitti" | "hata";
type BitisSebebi = "kullanici" | "sure_doldu" | "arka_plan" | "baglanti_koptu" | "hata";
type Olay = Record<string, unknown>;
type AracCagrisi = { name: string; call_id: string; arguments: string };
type OturumBilgisi = { motor: SesliMotor; model: string; ses: string; ek: string | null; dokumSade: boolean };

const DIGER_SESLER = SESLI_SESLER.filter((s) => !SESLI_ADAY_SESLER.includes(s));
const YAZIYOR = "…";

function sureMetni(sn: number): string {
  const m = Math.floor(sn / 60);
  const s = sn % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function jsonOku(r: Response): Promise<Record<string, unknown> | null> {
  if (!(r.headers.get("content-type") ?? "").includes("application/json")) return null;
  return (await r.json().catch(() => null)) as Record<string, unknown> | null;
}

function dilBolumu(dil: SesliDil): string {
  const ad = SESLI_DIL_ADI[dil];
  return `\n\n# Current user language\n- Current user language: ${ad}. Reply in ${ad} until the user switches.`;
}

/** `gpt-transcribe` algılanan dili `languages: [{ code }]` olarak verir; diğerleri vermez. */
function olayDili(olay: Olay): SesliDil | null {
  const diller = Array.isArray(olay.languages) ? (olay.languages as Olay[]) : [];
  const kod = String(diller[0]?.code ?? "").slice(0, 2).toLowerCase();
  return kod === "tr" || kod === "de" || kod === "en" ? kod : null;
}

const SECIM = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function AsistanSesliClient() {
  const t = useTranslations("asistanSesli");
  const [motor, setMotor] = useState<SesliMotor>("realtime");
  const [model, setModel] = useState(SESLI_VARSAYILAN_MODEL);
  const [ses, setSes] = useState(SESLI_VARSAYILAN_SES);
  const [canliSes, setCanliSes] = useState<string>(CANLI_VARSAYILAN_SES);
  const [transkripsiyon, setTranskripsiyon] = useState<string>(SESLI_VARSAYILAN_TRANSKRIPSIYON);
  const [durum, setDurum] = useState<Durum>("hazir");
  const [satirlar, setSatirlar] = useState<Satir[]>([]);
  const [gecenSn, setGecenSn] = useState(0);
  const [kullanim, setKullanim] = useState<SesliKullanim>(bosKullanim);
  const [arkaToken, setArkaToken] = useState({ girdi: 0, cikti: 0 });
  const [hataMetni, setHataMetni] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);
  const [bitisSebebi, setBitisSebebi] = useState<BitisSebebi | null>(null);
  const [yazi, setYazi] = useState("");
  const [mikrofonYok, setMikrofonYok] = useState(false);
  const [dil, setDil] = useState<SesliDil | null>(null);
  const [oturumBilgisi, setOturumBilgisi] = useState<OturumBilgisi | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const sesRef = useRef<HTMLAudioElement | null>(null);
  const sayacRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baslangicRef = useRef(0);
  const satirSayaciRef = useRef(0);
  /** Bağlanırken "Bitir"e basıldıysa kurulum yarıda bırakılır. */
  const iptalRef = useRef(false);
  /** OpenAI öğe kimliği → döküm satırı (Realtime; döküm sesten SONRA gelebilir). */
  const satirKimligiRef = useRef(new Map<string, string>());
  const motorRef = useRef<SesliMotor>("realtime");
  /** Realtime talimatı (sunucudan); dil değişince sonuna dil bölümü eklenip tazelenir. */
  const talimatRef = useRef("");
  const dilRef = useRef<SesliDil | null>(null);
  /** Live: kimliksiz döküm akışında o an kimin konuştuğu ve satırı. */
  const canliSiraRef = useRef<{ rol: Rol | null; satirId: string | null; kullaniciMetni: string }>({
    rol: null,
    satirId: null,
    kullaniciMetni: "",
  });

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

  /** Bağlantıyı kapatır. YALNIZ referanslar — sayfadan çıkarken de çağrılır, durum yazmaz. */
  const kapat = useCallback(() => {
    if (sayacRef.current) {
      clearInterval(sayacRef.current);
      sayacRef.current = null;
    }
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
      kapat();
      setBitisSebebi(sebep);
      setDurum("bitti");
    },
    [kapat]
  );

  /** "Bitir" düğmesi: bağlantı varsa kapatır, kurulum sürüyorsa yarıda keser. */
  const kullaniciBitirdi = () => {
    if (pcRef.current) {
      bitir("kullanici");
      return;
    }
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

  useEffect(() => () => kapat(), [kapat]);

  /** Dil değiştiyse motora bildirir (karar 4 ek güvencesi). */
  const dilGuncelle = useCallback(
    (yeni: SesliDil | null) => {
      if (!yeni || yeni === dilRef.current) return;
      dilRef.current = yeni;
      setDil(yeni);
      if (motorRef.current === "realtime") {
        // Talimat boşsa güncelleme YOLLANMAZ: `instructions` tamamen değişir, yalnız dil
        // satırı kalırsa asistan bütün kurallarını kaybederdi.
        if (!talimatRef.current) return;
        gonder({ type: "session.update", session: { type: "realtime", instructions: talimatRef.current + dilBolumu(yeni) } });
      } else {
        const ad = SESLI_DIL_ADI[yeni];
        gonder({
          type: "session.instructions.append",
          content: `Current user language: ${ad}. Reply in ${ad} until the user switches.`,
          delegation_id: null,
        });
      }
    },
    [gonder]
  );

  const aracCalistir = useCallback(
    async (cagri: AracCagrisi) => {
      const satirId = satirEkle("arac", t("aracCalisiyor", { ad: cagri.name }));
      let cikti: unknown;
      try {
        const r = await fetch("/api/asistan/arac", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ad: cagri.name, girdi: cagri.arguments }),
        });
        const j = await jsonOku(r);
        if (r.ok && j?.ok) {
          cikti = j.sonuc;
          const sn = (Number(j.sureMs ?? 0) / 1000).toFixed(1);
          satirYaz(satirId, () => t("aracBitti", { ad: cagri.name, sn }));
        } else {
          cikti = { hata: j?.error ?? "arac_ucu_hatasi", durum: r.status };
          satirYaz(satirId, () => t("aracHata", { ad: cagri.name }));
        }
      } catch {
        cikti = { hata: "ag_hatasi" };
        satirYaz(satirId, () => t("aracHata", { ad: cagri.name }));
      }
      const item = { type: "function_call_output", call_id: cagri.call_id, output: JSON.stringify(cikti) };
      if (motorRef.current === "live") {
        gonder({ type: "response.item.create", item });
        gonder({ type: "response.create" });
      } else {
        gonder({ type: "conversation.item.create", item });
      }
    },
    [gonder, satirEkle, satirYaz, t]
  );

  const realtimeOlay = useCallback(
    async (olay: Olay) => {
      const kullaniciSatiri = () => {
        const anahtar = `k:${String(olay.item_id ?? "")}`;
        return satirKimligiRef.current.get(anahtar) ?? satirEkle("kullanici", YAZIYOR, anahtar);
      };
      const asistanSatiri = () => {
        const anahtar = `a:${String(olay.item_id ?? olay.response_id ?? "")}`;
        return satirKimligiRef.current.get(anahtar) ?? satirEkle("asistan", "", anahtar);
      };

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
          dilGuncelle(olayDili(olay) ?? dilTahmin(metin));
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
        case "response.done": {
          const yanit = (olay.response ?? {}) as Olay;
          setKullanim((k) => kullanimEkle(k, yanit.usage));
          if (yanit.status !== "completed") break;
          const cikti = Array.isArray(yanit.output) ? (yanit.output as Olay[]) : [];
          const cagrilar = cikti.filter((o) => o.type === "function_call") as unknown as AracCagrisi[];
          if (cagrilar.length === 0) break;
          for (const c of cagrilar) await aracCalistir(c);
          gonder({ type: "response.create" });
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
    [aracCalistir, dilGuncelle, gonder, satirEkle, satirYaz]
  );

  const canliOlay = useCallback(
    async (olay: Olay) => {
      const sira = canliSiraRef.current;
      const konusmaci = (rol: "kullanici" | "asistan", parca: string) => {
        let id = sira.satirId;
        if (sira.rol !== rol || !id) {
          // Konuşmacı kullanıcıdan asistana geçti → kullanıcının cümlesi bitti, dili tespit et.
          if (rol === "asistan" && sira.rol === "kullanici") dilGuncelle(dilTahmin(sira.kullaniciMetni));
          id = satirEkle(rol, "");
          sira.rol = rol;
          sira.satirId = id;
          if (rol === "kullanici") sira.kullaniciMetni = "";
        }
        if (rol === "kullanici") sira.kullaniciMetni += parca;
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
            sira.rol = "arac";
            await aracCalistir(oge as unknown as AracCagrisi);
          } else if (ic.type === "response.completed") {
            const u = (((ic.response ?? {}) as Olay).usage ?? {}) as Olay;
            setArkaToken((o) => ({
              girdi: o.girdi + (typeof u.input_tokens === "number" ? u.input_tokens : 0),
              cikti: o.cikti + (typeof u.output_tokens === "number" ? u.output_tokens : 0),
            }));
          }
          break;
        }
        case "session.closed":
          bitir("baglanti_koptu");
          break;
        case "error": {
          const e = (olay.error ?? {}) as Olay;
          satirEkle("sistem", String(e.message ?? e.code ?? "error"));
          break;
        }
        default:
          break;
      }
    },
    [aracCalistir, bitir, dilGuncelle, satirEkle, satirYaz]
  );

  const baslat = async () => {
    if (durum === "baglaniyor" || durum === "canli") return;
    setHataMetni(null);
    setBilgi(null);
    setBitisSebebi(null);
    setSatirlar([]);
    setKullanim(bosKullanim());
    setArkaToken({ girdi: 0, cikti: 0 });
    setGecenSn(0);
    setOturumBilgisi(null);
    setDil(null);
    satirKimligiRef.current.clear();
    canliSiraRef.current = { rol: null, satirId: null, kullaniciMetni: "" };
    dilRef.current = null;
    talimatRef.current = "";
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

      // Realtime: önce kısa ömürlü anahtar. Live: anahtar yok, SDP sunucudan geçer.
      let istemciSirri = "";
      if (motor === "realtime") {
        const r = await fetch("/api/asistan/oturum", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, ses, transkripsiyon }),
        });
        const j = await jsonOku(r);
        if (!j) throw new Error(t("hata.oturumGecersiz"));
        if (!r.ok || !j.ok) throw new Error(t("hata.oturum", { kod: String(j.error ?? r.status) }));
        istemciSirri = String(j.istemciSirri ?? "");
        talimatRef.current = String(j.talimat ?? "");
        setOturumBilgisi({
          motor: "realtime",
          model: String(j.model ?? model),
          ses: String(j.ses ?? ses),
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
          if (sn >= SESLI_OTURUM_SINIRI_SN) bitir("sure_doldu");
        }, 1000);
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
          body: JSON.stringify({ sdp: teklif.sdp, ses: canliSes }),
        });
        const j = await jsonOku(r);
        if (!j) throw new Error(t("hata.oturumGecersiz"));
        if (!r.ok || !j.ok) {
          const ayrinti = [j.error, j.saglayiciDurum, j.saglayiciKod].filter(Boolean).join(" · ");
          throw new Error(t("hata.canli", { kod: ayrinti || String(r.status) }));
        }
        cevapSdp = String(j.sdp ?? "");
        setOturumBilgisi({
          motor: "live",
          model: String(j.model ?? CANLI_MODEL),
          ses: String(j.ses ?? canliSes),
          ek: String(j.arkaModel ?? CANLI_ARKA_MODEL),
          dokumSade: false,
        });
      }
      await pc.setRemoteDescription({ type: "answer", sdp: cevapSdp });
    } catch (e) {
      if (!pcRef.current) mic?.getTracks().forEach((iz) => iz.stop());
      kapat();
      setDurum("hata");
      setBitisSebebi("hata");
      setHataMetni(e instanceof Error ? e.message : t("hata.genel", { mesaj: String(e) }));
    }
  };

  const yaziGonder = () => {
    const metin = yazi.trim();
    if (!metin || durum !== "canli" || motorRef.current !== "realtime") return;
    satirEkle("kullanici", metin);
    dilGuncelle(dilTahmin(metin));
    gonder({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: metin }] },
    });
    gonder({ type: "response.create" });
    setYazi("");
  };

  /** Karar 5: "Bildir" bu fazda yalnız konsola + indirilen JSON'a yazar. */
  const bildir = () => {
    const sira = [...satirlar].reverse().findIndex((s) => s.rol === "kullanici" && s.metin !== YAZIYOR);
    if (sira === -1) {
      setBilgi(t("bildirYok"));
      return;
    }
    const soruIndeksi = satirlar.length - 1 - sira;
    const sonrasi = satirlar.slice(soruIndeksi + 1);
    const kayit = {
      tur: "sesli_asistan_bildirimi",
      surum: 2,
      an: new Date().toISOString(),
      motor: oturumBilgisi?.motor ?? motor,
      model: oturumBilgisi?.model ?? model,
      ses: oturumBilgisi?.ses ?? ses,
      ek: oturumBilgisi?.ek ?? null,
      dil: dil,
      soru: satirlar[soruIndeksi].metin,
      cevap: sonrasi
        .filter((s) => s.rol === "asistan")
        .map((s) => s.metin)
        .join(" ")
        .trim(),
      araclar: sonrasi.filter((s) => s.rol === "arac").map((s) => s.metin),
      oturumSn: gecenSn,
      not: "Faz 1 prototipi: sunucuya gönderilmez, saklanmaz.",
    };
    console.info("[sesli-asistan:bildir]", kayit);
    const url = URL.createObjectURL(new Blob([JSON.stringify(kayit, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sesli-asistan-bildirim-${kayit.an.replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBilgi(t("bildirIndi"));
  };

  const canli = durum === "canli";
  const mesgul = durum === "baglaniyor" || canli;
  const aktifMotor = oturumBilgisi?.motor ?? motor;
  const maliyet =
    aktifMotor === "live"
      ? (gecenSn / 60) * CANLI_DAKIKA_USD
      : tahminiMaliyetUsd(oturumBilgisi?.model ?? model, kullanim);

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
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("ses")}</span>
              {motor === "realtime" ? (
                <select value={ses} onChange={(e) => setSes(e.target.value)} disabled={mesgul} className={SECIM}>
                  <optgroup label={t("adaySesler")}>
                    {SESLI_ADAY_SESLER.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t("digerSesler")}>
                    {DIGER_SESLER.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </optgroup>
                </select>
              ) : (
                <select value={canliSes} onChange={(e) => setCanliSes(e.target.value)} disabled={mesgul} className={SECIM}>
                  {CANLI_SESLER.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </label>
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
              {t("sure")}: {sureMetni(gecenSn)} / {sureMetni(SESLI_OTURUM_SINIRI_SN)}
            </span>
            <span className="text-sm tabular-nums text-muted-foreground">
              {t("maliyet")}: ${maliyet.toFixed(4)}
            </span>
            <span className="text-sm text-muted-foreground">
              {t("dil")}: {dil ? t(`dilAdi.${dil}`) : t("dilYok")}
            </span>
          </div>

          {aktifMotor === "live" ? (
            <p className="text-xs text-muted-foreground">
              {t("canliMaliyetNot")} {t("arkaTokenlar", { girdi: arkaToken.girdi, cikti: arkaToken.cikti })}
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
          <Button variant="outline" size="sm" onClick={bildir} title={t("bildirIpucu")}>
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
                    s.rol === "asistan"
                      ? "text-sm"
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
          {motor === "live" ? (
            <p className="text-xs text-muted-foreground">{t("canliYaziKapali")}</p>
          ) : (
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
                disabled={!canli}
                rows={2}
              />
              <Button onClick={yaziGonder} disabled={!canli || !yazi.trim()}>
                {t("gonder")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <audio ref={sesRef} autoPlay className="hidden" />
    </div>
  );
}
