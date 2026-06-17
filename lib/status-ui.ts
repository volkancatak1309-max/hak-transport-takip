import type { ApprovalStatus } from "@/lib/types";

export const APPROVAL_BADGE: Record<
  ApprovalStatus,
  "secondary" | "outline" | "destructive"
> = {
  pending: "secondary",
  approved: "outline",
  rejected: "destructive",
};

// Operational/approval stripes — no green/red. waiting=gold, ok=sky, declined=claret.
export const APPROVAL_STRIPE: Record<ApprovalStatus, string> = {
  pending: "border-l-accent-gold",
  approved: "border-l-accent-sky",
  rejected: "border-l-accent-claret",
};
