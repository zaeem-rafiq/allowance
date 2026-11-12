// Shows a rule the way the store will read it: the parent's words, the lines the checker
// enforces, the clauses it cannot enforce, and, once signed, the version and signature.
// Everything is plain text, so HTML in a rule shows as typed. Used by server and client pages,
// so it imports only types from the signing code.
import type { ReactNode } from "react";
import { CATEGORY_LABELS, HOUSEHOLD_BASICS } from "@/lib/catalog/catalog";
import { type MandateRules, describeAllowed, describeRules } from "@/lib/mandate/schema";
import type { SignedMandate } from "@/lib/mandate/sign";

export interface SignedDetails {
  version: number;
  hash: SignedMandate["hash"];
  signature: SignedMandate["signature"];
  publicKey: SignedMandate["publicKey"];
}

export interface CardClause {
  text: string;
  status: "pending" | "accepted" | "removed";
  /** Buttons for this clause, shown by the rule writer. */
  actions?: ReactNode;
}

interface MandateCardProps {
  heading: string;
  /** The parent's own words. */
  words: string;
  rules: MandateRules;
  /** Notices such as "Capped at $120 for this public demo." */
  notes?: string[];
  /** Conditions of the rule that the mandate cannot hold. */
  clauses?: CardClause[];
  signed?: SignedDetails | null;
  testId?: string;
}

function shorten(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function joinWithAnd(items: string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const STATUS_TEXT: Record<CardClause["status"], string> = {
  pending: "Needs your decision",
  accepted: "Accepted",
  removed: "Removed",
};

export function MandateCard({ heading, words, rules, notes = [], clauses = [], signed = null, testId }: MandateCardProps) {
  const usesHouseholdBasics = describeAllowed(rules) === "household basics only";

  return (
    <article data-testid={testId} className="flex flex-col gap-4 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold">{heading}</h2>
        {signed && <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Signed · Version {signed.version}</p>}
      </header>

      <section aria-label="Your words" className="flex flex-col gap-1">
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Your words</h3>
        <blockquote data-testid="rule-words" className="whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300">
          {words}
        </blockquote>
      </section>

      <section aria-label="What the store enforces" className="flex flex-col gap-1">
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">What the store enforces</h3>
        <ul data-testid="rule-lines" className="flex flex-col gap-1">
          {describeRules(rules).map((line) => (
            <li key={line} className="font-medium">
              {line}
            </li>
          ))}
        </ul>
        {usesHouseholdBasics && (
          <p data-testid="household-basics" className="text-sm text-zinc-600 dark:text-zinc-400">
            Household basics means these store categories: {joinWithAnd(HOUSEHOLD_BASICS.map((category) => CATEGORY_LABELS[category]))}.
          </p>
        )}
      </section>

      {notes.length > 0 && (
        <ul data-testid="rule-notes" className="flex flex-col gap-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {clauses.length > 0 && (
        <section aria-label="Not enforced" className="flex flex-col gap-2">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Not enforced</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {clauses.some((clause) => clause.actions)
              ? "The store cannot check these parts of your rule. Accept each one, knowing it is not enforced, or remove it."
              : "The store cannot check these parts of the rule, and the parent accepted that."}
          </p>
          <ul data-testid="not-enforced" className="flex flex-col gap-2">
            {clauses.map((clause) => (
              <li
                key={clause.text}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
              >
                <span className="flex min-w-0 flex-col">
                  <span className={`break-words font-medium ${clause.status === "removed" ? "text-zinc-500 line-through" : ""}`}>
                    {clause.text}
                  </span>
                  <span className="text-xs text-zinc-500">{STATUS_TEXT[clause.status]}</span>
                </span>
                {clause.actions && <span className="flex gap-2">{clause.actions}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {signed && (
        <dl data-testid="signature-details" className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800 sm:grid-cols-[7rem_1fr]">
          <dt className="text-zinc-500">Version</dt>
          <dd>{signed.version}</dd>
          <dt className="text-zinc-500">Hash</dt>
          <dd data-testid="mandate-hash" title={signed.hash} className="break-all font-mono">
            {shorten(signed.hash, 16)}
          </dd>
          <dt className="text-zinc-500">Signature</dt>
          <dd data-testid="mandate-signature" title={signed.signature} className="break-all font-mono">
            {shorten(signed.signature, 16)}
          </dd>
          <dt className="text-zinc-500">Public key</dt>
          <dd data-testid="mandate-public-key" title={signed.publicKey} className="break-all font-mono">
            {shorten(signed.publicKey, 16)}
          </dd>
        </dl>
      )}
    </article>
  );
}
