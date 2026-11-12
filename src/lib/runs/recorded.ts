// The recorded run (R22): a real stored run the owner marked as featured. The page shows it at
// a cap or when the AI is busy, labelled with the date it was recorded.
import type { Queryable } from "@/lib/db";
import type { ResultCard } from "./card";
import type { StoredStep } from "./run";

export interface RecordedRun {
  runId: string;
  recordedAt: string;
  hiddenLine: string | null;
  card: ResultCard;
  steps: StoredStep[];
}

export async function featuredRun(q: Queryable): Promise<RecordedRun | null> {
  const runs = await q.query<{ id: string; created_at: string; hidden_line: string | null; outcome: { card: ResultCard } | null }>(
    "SELECT id, created_at, hidden_line, outcome FROM runs WHERE featured = true AND status = 'done' ORDER BY created_at DESC LIMIT 1",
  );
  const run = runs[0];
  if (!run?.outcome?.card) return null;
  const steps = await q.query<{ seq: number; kind: StoredStep["kind"]; detail: { text: string }; created_at: string }>(
    "SELECT seq, kind, detail, created_at FROM run_steps WHERE run_id = $1 ORDER BY seq",
    [run.id],
  );
  return {
    runId: run.id,
    recordedAt: new Date(run.created_at).toISOString(),
    hiddenLine: run.hidden_line,
    card: run.outcome.card,
    steps: steps.map((s) => ({ seq: s.seq, kind: s.kind, text: s.detail.text, at: new Date(s.created_at).toISOString() })),
  };
}

/** Marks the latest finished agent run in a ledger as the one recorded run. */
export async function featureLatestRun(q: Queryable, ledgerId: string): Promise<string | null> {
  const rows = await q.query<{ id: string }>(
    "SELECT id FROM runs WHERE ledger_id = $1 AND kind = 'agent' AND status = 'done' ORDER BY created_at DESC LIMIT 1",
    [ledgerId],
  );
  const id = rows[0]?.id;
  if (!id) return null;
  await q.query("UPDATE runs SET featured = false WHERE featured = true");
  await q.query("UPDATE runs SET featured = true WHERE id = $1", [id]);
  return id;
}
