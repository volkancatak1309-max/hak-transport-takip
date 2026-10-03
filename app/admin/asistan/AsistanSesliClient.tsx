"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  SESLI_ADAY_SESLER,
  SESLI_MODELLER,
  SESLI_OTURUM_SINIRI_SN,
  SESLI_SESLER,
  SESLI_VARSAYILAN_MODEL,
  SESLI_VARSAYILAN_SES,
  bosKullanim,
  kullanimEkle,
  tahminiMaliyetUsd,
  type SesliKullanim,
} from "@/lib/asistan-sesli-sabitler";

/**
 * SESLİ ASİSTAN — tarayıcı tarafı (Faz 1 web prototipi).
 *
 * Akış: mikrofon izni → `/api/asistan/oturum` (60 sn'lik anahtar) → WebRTC teklifi
 * `api.openai.com/v1/realtime/calls`'a → ses medya izinde, olaylar "oai-events" veri
 * kanalında. Model araç isterse (`response.done` içinde `function_call`, yalnız
 * `status: completed` — kesilen cevapta yarım argümanla araç çalışmasın) sonuç
 * `/api/asistan/arac`'tan alınıp `function_call_output` + `response.create` ile geri verilir.
 *
 * SAKLAMA YOK (karar 5): döküm bu bileşenin belleğinde durur; "Bildir" yalnız konsola
 * ve indirilen JSON'a yazar. Kısa ömürlü anahtar yerel değişkende kalır, duruma ya da
 * loga yazılmaz.
 */

type Rol = "kullanici" | "asistan" | "arac" | "sistem";
type Satir = { id: string; rol: Rol; metin: string };
type Durum = "hazir" | "baglaniyor" | "canli" | "bitti" | "hata";
type BitisSebebi = "kullanici" | "sure_doldu" | "arka_plan" | "baglanti_koptu" | "hata";
type Olay = Record<string, unknown>;
type AracCagrisi = { name: string; call_id: string; arguments: string };

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

export function AsistanSesliClient() {
  const t = useTranslations("asistanSesli");
  const [model, setModel] = useState(SESLI_VARSAYILAN_MODEL);
  const [ses, setSes] = useState(SESLI_VARSAYILAN_SES);
  const [durum, setDurum] = useState<Durum>("hazir");
  const [satirlar, setSatirlar] = useState<Satir[]>([]);
  const [gecenSn, setGecenSn] = useState(0);
  const [kullanim, setKullanim] = useState<SesliKullanim>(bosKullanim);
  const [hataMetni, setHataMetni] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);
  const [bitisSebebi, setBitisSebebi] = useState<BitisSebebi | null>(null);
  const [yazi, setYazi] = useState("");
  const [mikrofonYok, setMikrofonYok] = useState(false);
  const [oturumBilgisi, setOturumBilgisi] = useState<{ model: string; ses: string; transkripsiyon: string } | null>(
    null
  );

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const sesRef = useRef<HTMLAudioElement | null>(null);
  const sayacRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baslangicRef = useRef(0);
  const satirSayaciRef = useRef(0);
  /** Bağlanırken "Bitir"e basıldıysa kurulum yarıda bırakılır. */
  const iptalRef = useRef(false);
  /** OpenAI öğe kimliği → döküm satırı (döküm sesten SONRA gelebilir; sıra korunur). */
  const satirKimligiRef = useRef(new Map<string, string>());

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

  /** Bağlantıyı kapatır. YALNIZ referanslar — sayfadan çıkarken de çağrılır, durum yazmaz. */
  const kapat = useCallback(() => {
    if (sayacRef.current) {
      clearInterval(sayacRef.current);
      sayacRef.current = null;
    }
    const pc = pcRef.current;
    pcRef.current = null;
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

  const gonder = useCallback((olay: Olay) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(olay));
  }, []);

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
      gonder({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: cagri.call_id, output: JSON.stringify(cikti) },
      });
    },
    [gonder, satirEkle, satirYaz, t]
  );

  const olayIsle = useCallback(
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
    [aracCalistir, gonder, satirEkle, satirYaz]
  );

  const baslat = async () => {
    if (durum === "baglaniyor" || durum === "canli") return;
    setHataMetni(null);
    setBilgi(null);
    setBitisSebebi(null);
    setSatirlar([]);
    setKullanim(bosKullanim());
    setGecenSn(0);
    setOturumBilgisi(null);
    satirKimligiRef.current.clear();
    iptalRef.current = false;
    setDurum("baglaniyor");

    let mic: MediaStream | null = null;
    try {
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        mic = null; // izin yok → yalnız yazı (karar 8); cevap yine sesli gelir
      }
      setMikrofonYok(mic === null);
      if (iptalRef.current) {
        mic?.getTracks().forEach((iz) => iz.stop());
        return;
      }

      const r = await fetch("/api/asistan/oturum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, ses }),
      });
      const j = await jsonOku(r);
      if (!j) throw new Error(t("hata.oturumGecersiz"));
      if (!r.ok || !j.ok) throw new Error(t("hata.oturum", { kod: String(j.error ?? r.status) }));
      if (iptalRef.current) {
        mic?.getTracks().forEach((iz) => iz.stop());
        return;
      }
      const istemciSirri = String(j.istemciSirri ?? "");
      setOturumBilgisi({
        model: String(j.model ?? model),
        ses: String(j.ses ?? ses),
        transkripsiyon: String(j.transkripsiyon ?? ""),
      });

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
      dc.addEventListener("message", (e) => {
        let olay: Olay;
        try {
          olay = JSON.parse(String(e.data)) as Olay;
        } catch {
          return;
        }
        void olayIsle(olay);
      });
      dc.addEventListener("close", () => {
        if (pcRef.current === pc) bitir("baglanti_koptu");
      });

      const teklif = await pc.createOffer();
      await pc.setLocalDescription(teklif);
      const cevap = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: teklif.sdp,
        headers: { Authorization: `Bearer ${istemciSirri}`, "Content-Type": "application/sdp" },
      });
      if (!cevap.ok) throw new Error(t("hata.openai", { durum: cevap.status }));
      await pc.setRemoteDescription({ type: "answer", sdp: await cevap.text() });
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
    if (!metin || durum !== "canli") return;
    satirEkle("kullanici", metin);
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
      surum: 1,
      an: new Date().toISOString(),
      model: oturumBilgisi?.model ?? model,
      ses: oturumBilgisi?.ses ?? ses,
      transkripsiyon: oturumBilgisi?.transkripsiyon ?? null,
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
  const maliyet = tahminiMaliyetUsd(oturumBilgisi?.model ?? model, kullanim);

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
              <span className="text-muted-foreground">{t("model")}</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={mesgul}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {SESLI_MODELLER.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("ses")}</span>
              <select
                value={ses}
                onChange={(e) => setSes(e.target.value)}
                disabled={mesgul}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
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
            </label>
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
          </div>

          <p className="text-xs text-muted-foreground">
            {t("maliyetNot")}{" "}
            {t("tokenlar", {
              sesGirdi: kullanim.sesGirdi,
              sesCikti: kullanim.sesCikti,
              metinGirdi: kullanim.metinGirdi,
              metinCikti: kullanim.metinCikti,
            })}
          </p>
          {oturumBilgisi?.transkripsiyon ? (
            <p className="text-xs text-muted-foreground">
              {t("transkripsiyon", { model: oturumBilgisi.transkripsiyon })}
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
        </CardContent>
      </Card>

      <audio ref={sesRef} autoPlay className="hidden" />
    </div>
  );
}
