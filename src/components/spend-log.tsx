"use client";

// The spend log table (U14), an AG Grid Community grid. Every cell shows plain text from the
// server's row, never HTML. Only the Receipt cell is a component, and it builds a link from an
// ID the server has already checked.
import {
  AllCommunityModule,
  type CellClassParams,
  type ColDef,
  ModuleRegistry,
  colorSchemeDark,
  themeQuartz,
} from "ag-grid-community";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import type { LogRow } from "@/lib/log/spend-log";

ModuleRegistry.registerModules([AllCommunityModule]);

const ROW_HEIGHT = 44;
const MAX_HEIGHT = 480;
const NO_VALUE = "—";

const lightTheme = themeQuartz.withParams({ fontFamily: "inherit", headerFontWeight: 600, wrapperBorderRadius: 12 });
const darkTheme = lightTheme.withPart(colorSchemeDark);

const DARK_QUERY = "(prefers-color-scheme: dark)";
function subscribeToScheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const prefersDark = () => window.matchMedia(DARK_QUERY).matches;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function resultClass(p: CellClassParams<LogRow, string>): string {
  switch (p.value) {
    case "Charged":
      return "font-medium text-emerald-700 dark:text-emerald-400";
    case "Blocked":
      return "font-medium text-red-700 dark:text-red-400";
    case "Allowed, not charged":
      return "font-medium text-sky-700 dark:text-sky-400";
    default:
      return "font-medium text-amber-700 dark:text-amber-400";
  }
}

function ReceiptCell({ data }: CustomCellRendererProps<LogRow>) {
  if (!data?.receiptId) return <span className="text-zinc-400">{NO_VALUE}</span>;
  return (
    <Link
      href={`/receipts/${encodeURIComponent(data.receiptId)}`}
      prefetch={false}
      aria-label="Open receipt"
      className="text-blue-700 underline underline-offset-4 dark:text-blue-400"
    >
      Open
    </Link>
  );
}

const COLUMNS: ColDef<LogRow>[] = [
  {
    headerName: "Time",
    field: "createdAt",
    width: 140,
    minWidth: 130,
    sort: "desc",
    valueFormatter: (p) => (p.value ? formatTime(p.value) : NO_VALUE),
  },
  { headerName: "Source", field: "source", width: 140, minWidth: 130 },
  { headerName: "Result", field: "result", width: 180, minWidth: 170, cellClass: resultClass },
  { headerName: "Rule cited", field: "rule", flex: 1, minWidth: 200 },
  {
    headerName: "Amount",
    field: "amount",
    width: 100,
    minWidth: 100,
    headerClass: "ag-right-aligned-header",
    cellClass: ["ag-right-aligned-cell", "tabular-nums"],
    comparator: (_a, _b, nodeA, nodeB) => (nodeA.data?.amountCents ?? 0) - (nodeB.data?.amountCents ?? 0),
  },
  { headerName: "PayPal order", field: "paypalOrder", width: 170, minWidth: 160, cellClass: "font-mono text-[13px]" },
  { headerName: "Receipt", field: "receiptId", width: 90, minWidth: 90, sortable: false, cellRenderer: ReceiptCell },
];

export function SpendLog({ rows }: { rows: LogRow[] }) {
  const dark = useSyncExternalStore(subscribeToScheme, prefersDark, () => false);
  // Short logs get a short box. The box never grows past MAX_HEIGHT; the grid scrolls inside it.
  const height = Math.min(MAX_HEIGHT, ROW_HEIGHT * (rows.length + 1) + 20);
  const defaultColDef = useMemo<ColDef<LogRow>>(() => ({ sortable: true, suppressMovable: true }), []);

  return (
    <div role="region" aria-label="Spend log table" className="w-full min-w-0" style={{ height }}>
      <AgGridReact<LogRow>
        theme={dark ? darkTheme : lightTheme}
        rowData={rows}
        columnDefs={COLUMNS}
        defaultColDef={defaultColDef}
        getRowId={(p) => p.data.id}
        rowHeight={ROW_HEIGHT}
        headerHeight={ROW_HEIGHT}
        suppressColumnVirtualisation
        enableCellTextSelection
      />
    </div>
  );
}
