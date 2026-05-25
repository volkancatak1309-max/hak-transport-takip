import type { ApprovalStatus } from "@/lib/types";

export const APPROVAL_BADGE: Record<
  ApprovalStatus,
  "secondary" | "outline" | "destructive"
> = {
  pending: "secondary",
  approved: "outline",
  rejected: "destructive",
};

export const APPROVAL_STRIPE: Record<ApprovalStatus, string> = {
  pending: "border-l-muted-foreground/40",
  approved: "border-l-emerald-500",
  rejected: "border-l-destructive",
};
