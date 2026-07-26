// HAK61 UI V2 ortak bileşen kütüphanesi (DESIGN-SYSTEM §7) — tek kaynak.
// Sayfalar FAZ 4'te buradan import eder; sayfa-içi kopya yasak.
export { PageHeader } from "./PageHeader";
export { StatCard, type StatTone } from "./StatCard";
export { StatusChip, type ChipTone } from "./StatusChip";
export { EmptyState, type EmptyKind } from "./EmptyState";
export { FilterBar, type FilterSelect } from "./FilterBar";
export { FilterChips, type ActiveChip } from "./FilterChips";
export { SegmentedControl, type SegmentOption } from "./SegmentedControl";
export { BreakdownCard, type BreakdownRow, type BreakdownTab } from "./BreakdownCard";
export { MiniTrend, type TrendBucket } from "./MiniTrend";
export { SubTabs, type SubTab } from "./SubTabs";
export { RankingTile, type RankRow } from "./RankingTile";
// Kayıtlı görünümler (Aboard klonu — DESIGN.md §0).
export { SavedViews, type SavedView } from "./SavedViews";
// Operasyon konsolu iskeleti (Stellate klonu — DESIGN.md §0 DESTEK C).
export {
  OpsConsole,
  OpsFilter,
  OpsStatGrid,
  OpsGroup,
  OpsGroupRow,
} from "./OpsConsole";
export { RevealFilterRow, type RevealFilter } from "./RevealFilterRow";
export {
  DataTable,
  RowMenuTrigger,
  type Column,
  type SortState,
  type GroupingConfig,
} from "./DataTable";
export { ListRow } from "./ListRow";
export { DetailDrawer } from "./DetailDrawer";
export { ConfirmDialog } from "./ConfirmDialog";
export { DensityToggle } from "./DensityToggle";
export { CommandPalette, type PalettePage } from "./CommandPalette";
export {
  StatCardsSkeleton,
  TableSkeleton,
  ListPageSkeleton,
} from "./SkeletonBlocks";
export { useUrlFilters } from "./useUrlFilters";
export { useDensity, type Density } from "./useDensity";
