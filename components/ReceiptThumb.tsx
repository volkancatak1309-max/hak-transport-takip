"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  /** Pre-signed receipt URL, or null when there is no receipt. */
  url: string | null;
  title: string;
  info?: React.ReactNode;
  /** Shown when url is null (e.g. "Fiş yok"). */
  emptyLabel: string;
};

/**
 * Inline receipt thumbnail for list/table rows: shows a small preview of the
 * (already signed) image and opens a full-size lightbox on click. When there is
 * no receipt it renders a muted "no receipt" label instead of erroring.
 */
export function ReceiptThumb({ url, title, info, emptyLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);

  if (!url || broken) {
    return <span className="text-xs text-muted-foreground">{emptyLabel}</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block size-12 overflow-hidden rounded-md border bg-muted transition hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label={title}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={title}
          loading="lazy"
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {info && <div className="space-y-1 text-sm">{info}</div>}
          <div className="flex min-h-32 items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt="receipt"
              className="max-h-[75vh] w-auto rounded-md border object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
