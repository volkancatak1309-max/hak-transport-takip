"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Pause, Volume2, VolumeX, Timer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { notifyLenkzeit } from "@/app/actions/telegram";

const WARN_MIN = 240; // 4h — pre-warning
const VIOLATION_MIN = 270; // 4.5h — mandatory break
const SNOOZE_MS = 5 * 60 * 1000;

type Props = {
  timeEntryId: string;
  startedAt: string;
  isOnBreak: boolean;
  breakMinutes: number;
  onStartBreak: () => void;
};

export function LenkzeitWarning({
  timeEntryId,
  startedAt,
  isOnBreak,
  breakMinutes,
  onStartBreak,
}: Props) {
  const t = useTranslations("lenkzeit");

  // Driving time runs continuously since the last break end (or shift start).
  // On load we approximate by offsetting the shift start by accumulated breaks.
  const drivingSinceRef = useRef<number>(
    new Date(startedAt).getTime() + Math.max(0, breakMinutes) * 60_000
  );
  const frozenMsRef = useRef<number | null>(null);
  const warned30Ref = useRef(false);
  const violatedRef = useRef(false);
  const prevBreakRef = useRef(isOnBreak);
  const onBreakRef = useRef(isOnBreak);
  const snoozeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [now, setNow] = useState(() => Date.now());
  const [modalOpen, setModalOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);

  onBreakRef.current = isOnBreak;

  // lazy-create audio element
  useEffect(() => {
    audioRef.current = new Audio("/sounds/lenkzeit-alarm.wav");
    audioRef.current.preload = "auto";
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  function playSound() {
    if (!soundOn || !audioRef.current) return;
    try {
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  function showNotification() {
    if (typeof Notification === "undefined") return;
    const fire = () => {
      try {
        new Notification("HAK Transport", {
          body: t("violation_body"),
          icon: "/logo.png",
        });
      } catch {
        /* ignore */
      }
    };
    if (Notification.permission === "granted") fire();
    else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((p) => {
        if (p === "granted") fire();
      });
    }
  }

  function triggerViolation() {
    setModalOpen(true);
    showNotification();
    playSound();
    // Also push a Telegram alert (server de-dupes per shift; fire-and-forget).
    void notifyLenkzeit(timeEntryId).catch(() => {});
  }

  // React to break start/end transitions
  useEffect(() => {
    if (isOnBreak && !prevBreakRef.current) {
      // break started → freeze the driving clock
      frozenMsRef.current = Date.now() - drivingSinceRef.current;
    } else if (!isOnBreak && prevBreakRef.current) {
      // break ended → reset driving timer + warnings
      drivingSinceRef.current = Date.now();
      frozenMsRef.current = null;
      warned30Ref.current = false;
      violatedRef.current = false;
      setModalOpen(false);
      if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current);
    }
    prevBreakRef.current = isOnBreak;
  }, [isOnBreak]);

  // 1s tick + threshold checks
  useEffect(() => {
    const id = setInterval(() => {
      const tNow = Date.now();
      setNow(tNow);
      if (onBreakRef.current) return;
      const ms = frozenMsRef.current ?? tNow - drivingSinceRef.current;
      const min = ms / 60_000;
      if (min >= WARN_MIN && !warned30Ref.current) {
        warned30Ref.current = true;
        toast.warning(t("warning_30min"), { duration: 8000 });
      }
      if (min >= VIOLATION_MIN && !violatedRef.current) {
        violatedRef.current = true;
        triggerViolation();
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current);
    };
  }, []);

  const elapsedMs = Math.max(
    0,
    frozenMsRef.current ?? now - drivingSinceRef.current
  );
  const min = elapsedMs / 60_000;

  // No green for the "ok" state — brand sky. Amber as the approaching-limit step.
  const colorClass =
    min >= WARN_MIN
      ? "text-destructive"
      : min >= 180
      ? "text-accent-gold"
      : "text-accent-sky";
  const pulse = min >= WARN_MIN && !isOnBreak;

  function handleSnooze() {
    setModalOpen(false);
    if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current);
    snoozeTimerRef.current = setTimeout(() => {
      const ms = frozenMsRef.current ?? Date.now() - drivingSinceRef.current;
      if (!onBreakRef.current && ms / 60_000 >= VIOLATION_MIN) {
        setModalOpen(true);
        playSound();
      }
    }, SNOOZE_MS);
  }

  function handleStartBreak() {
    setModalOpen(false);
    if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current);
    onStartBreak();
  }

  return (
    <>
      <div
        className={cn(
          "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm",
          min >= WARN_MIN
            ? "border-destructive/40 bg-destructive/5"
            : "border-border bg-muted/40"
        )}
      >
        <Timer className={cn("size-4", colorClass)} />
        <span className="text-muted-foreground">{t("driving_time")}:</span>
        <span className={cn("nums font-semibold tabular-nums", colorClass, pulse && "pulse-soft")}>
          {formatDuration(elapsedMs)}
        </span>
      </div>

      <Dialog open={modalOpen} onOpenChange={(o) => !o && handleSnooze()}>
        <DialogContent className="border-2 border-destructive">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-xl">
              <AlertTriangle className="size-6" />
              {t("violation_title")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-base font-medium">{t("violation_body")}</p>
            <p className="text-xs text-muted-foreground border-l-2 border-destructive/40 pl-3">
              {t("violation_legal")}
            </p>
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleStartBreak}
                size="lg"
                className="w-full h-12"
              >
                <Pause className="size-4" />
                {t("start_break")}
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleSnooze}
                  className="flex-1"
                >
                  {t("snooze")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setSoundOn((s) => !s)}
                  aria-label={soundOn ? t("sound_off") : t("sound_on")}
                  title={soundOn ? t("sound_off") : t("sound_on")}
                >
                  {soundOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
