"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, ArrowRight, type LucideIcon } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { listVehiclePlates } from "@/app/actions/vehicles";

/**
 * Global ⌘K / Ctrl+K komut paleti (DESIGN-SYSTEM §7). İçerik: sayfalar +
 * hızlı eylemler + araç (plaka fuzzy). Başlıklar EYLEM dili ("Alarmları aç").
 * Araç dizini palet İLK açıldığında lazy yüklenir (28 satır) — açılmadan sıfır
 * maliyet. Global araç seçici bu paletin araç modudur.
 */
export type PalettePage = { label: string; href: string; icon?: LucideIcon };

export function CommandPalette({
  pages,
  open: controlledOpen,
  onOpenChange,
}: {
  pages: PalettePage[];
  /** Kontrollü kullanım (topbar düğmesi). Verilmezse bileşen kendi durumunu tutar. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [vehicles, setVehicles] = useState<{ id: string; plate: string }[] | null>(null);

  // Global kısayol: ⌘K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const next = !(controlledOpen ?? internalOpen);
        setInternalOpen(next);
        onOpenChange?.(next);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [controlledOpen, internalOpen, onOpenChange]);

  // Araç dizinini yalnız ilk açılışta çek.
  useEffect(() => {
    if (open && vehicles === null) {
      listVehiclePlates()
        .then(setVehicles)
        .catch(() => setVehicles([]));
    }
  }, [open, vehicles]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Komut paleti"
      description="Araç, sayfa veya eylem ara"
    >
      <Command>
      <CommandInput placeholder="Araç plakası, sayfa veya eylem ara…" />
      <CommandList>
        <CommandEmpty>Sonuç yok.</CommandEmpty>

        <CommandGroup heading="Sayfalar">
          {pages.map((p) => {
            const Icon = p.icon ?? ArrowRight;
            return (
              <CommandItem
                key={p.href}
                value={`sayfa ${p.label}`}
                onSelect={() => go(p.href)}
              >
                <Icon className="size-4" />
                <span>{p.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {vehicles && vehicles.length > 0 && (
          <CommandGroup heading="Araçlar">
            {vehicles.map((v) => (
              <CommandItem
                key={v.id}
                value={`arac ${v.plate}`}
                onSelect={() => go(`/admin/araclar/${v.id}`)}
              >
                <Truck className="size-4" />
                <span className="nums uppercase tracking-wide">{v.plate}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
