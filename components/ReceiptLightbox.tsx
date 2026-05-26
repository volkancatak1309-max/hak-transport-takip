"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  /** Lazily resolve the (signed) image URL when the lightbox opens. */
  getUrl: () => Promise<string | null>;
  title: string;
  info?: React.ReactNode;
  /** Trigger content (e.g. "📎 Fiş" or a whole list row). */
  children: React.ReactNode;
  className?: string;
};

/**
 * Click a trigger to open a dialog showing a private receipt photo full-size
 * (max ~75vh) with optional info. The signed URL is fetched on first open.
 */
export function ReceiptLightbox({ getUrl, title, info, children, className }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (next && url === null) {
      setLoading(true);
      try {
        setUrl(await getUrl());
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => onOpenChange(true)}
      >
        {children}
      </button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {info && <div className="space-y-1 text-sm">{info}</div>}
          <div className="flex min-h-32 items-center justify-center">
            {loading ? (
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            ) : url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt="receipt"
                className="max-h-[75vh] w-auto rounded-md border object-contain"
              />
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
