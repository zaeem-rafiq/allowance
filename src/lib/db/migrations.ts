// Plain SQL migrations (KTD3). They only add, never drop or rename, because previews and
// production share one database. Kept in code, not in .sql files, so the server bundle
// always carries them.

export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: "0001_core",
    sql: `
CREATE TABLE IF NOT EXISTS ledgers (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('visitor', 'demo', 'eval')),
  visitor_key_hash text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mandate_versions (
  id text PRIMARY KEY,
  ledger_id text NOT NULL REFERENCES ledgers(id),
  version integer NOT NULL,
  mandate jsonb NOT NULL,
  hash text NOT NULL,
  signature text NOT NULL,
  public_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ledger_id, version)
);

CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY,
  ledger_id text NOT NULL REFERENCES ledgers(id),
  kind text NOT NULL,
  hidden_line text,
  status text NOT NULL,
  ending text,
  outcome jsonb,
  featured boolean NOT NULL DEFAULT false,
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_microusd bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS run_steps (
  run_id text NOT NULL REFERENCES runs(id),
  seq integer NOT NULL,
  kind text NOT NULL,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE IF NOT EXISTS attempts (
  id text PRIMARY KEY,
  ledger_id text NOT NULL REFERENCES ledgers(id),
  run_id text UNIQUE REFERENCES runs(id),
  mandate_version_id text NOT NULL REFERENCES mandate_versions(id),
  mandate_version integer NOT NULL,
  mandate_hash text NOT NULL,
  source text NOT NULL,
  state text NOT NULL,
  verdict jsonb NOT NULL,
  rule text NOT NULL,
  total_cents integer NOT NULL,
  reserved_cents integer NOT NULL DEFAULT 0,
  captured_cents integer NOT NULL DEFAULT 0,
  receipt_id text UNIQUE,
  paypal jsonb,
  message text,
  created_at timestamptz NOT NULL,
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS attempts_ledger_idx ON attempts (ledger_id, created_at);

CREATE TABLE IF NOT EXISTS counters (
  key text PRIMARY KEY,
  count integer NOT NULL,
  window_start timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_spend (
  day date PRIMARY KEY,
  cost_microusd bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
];
