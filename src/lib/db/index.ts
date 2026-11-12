// A small database interface with query and transaction (KTD3, KTD4).
// - DATABASE_URL set: Render Postgres through `pg`.
// - Test mode: an in-memory PGlite, fresh per server process.
// - Local development without DATABASE_URL: an on-disk PGlite in .data/pglite, because this
//   Mac cannot reach Render's database.
import { isTestMode } from "@/lib/mode";
import { MIGRATIONS } from "./migrations";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs several statements with no parameters, such as a migration. */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: "pg" | "pglite";
}

export class DatabaseUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("The database could not be reached.", { cause });
    this.name = "DatabaseUnavailableError";
  }
}

const MIGRATION_LOCK_KEY = 727274001;

export async function createPg(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 5000 });
  pool.on("error", () => {
    // An idle client lost its connection. The next query reconnects.
  });
  const db: Db = {
    kind: "pg",
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params);
      return res.rows as T[];
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          async query<R>(sql: string, params: unknown[] = []) {
            const res = await client.query(sql, params);
            return res.rows as R[];
          },
          async exec(sql: string) {
            await client.query(sql);
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
  return db;
}

export async function createPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  const db: Db = {
    kind: "pglite",
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pg.query(sql, params);
      return res.rows as T[];
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      return pg.transaction(async (tx) =>
        fn({
          async query<R>(sql: string, params: unknown[] = []) {
            const res = await tx.query(sql, params);
            return res.rows as R[];
          },
          async exec(sql: string) {
            await tx.exec(sql);
          },
        }),
      );
    },
    async close() {
      await pg.close();
    },
  };
  return db;
}

/** Runs every migration not yet applied, under an advisory lock. Safe to run twice. */
export async function migrate(db: Db): Promise<string[]> {
  const applied: string[] = [];
  const run = async (q: Queryable) => {
    await q.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set(
      (await q.query<{ id: string }>("SELECT id FROM schema_migrations")).map((r) => r.id),
    );
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await q.exec(m.sql);
      await q.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
      applied.push(m.id);
    }
  };
  // The transaction-scoped advisory lock makes concurrent servers wait for one another.
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await run(tx);
  });
  return applied;
}

type Holder = { promise?: Promise<Db> };
const holder: Holder = ((globalThis as Record<string, unknown>).__allowanceDb ??= {}) as Holder;

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  let db: Db;
  if (isTestMode()) {
    db = await createPglite();
  } else if (url) {
    db = await createPg(url);
  } else if (process.env.NODE_ENV !== "production") {
    db = await createPglite(".data/pglite");
  } else {
    throw new DatabaseUnavailableError(new Error("DATABASE_URL is not set"));
  }
  await migrate(db);
  return db;
}

/** The process-wide database, opened and migrated on first use. */
export async function getDb(): Promise<Db> {
  if (!holder.promise) {
    holder.promise = open().catch((err) => {
      holder.promise = undefined;
      throw err instanceof DatabaseUnavailableError ? err : new DatabaseUnavailableError(err);
    });
  }
  return holder.promise;
}

/** Test mode only: drop the database so the next call gets a fresh one. */
export async function resetDbForTests(): Promise<void> {
  if (!isTestMode()) throw new Error("resetDbForTests is test mode only");
  const current = holder.promise;
  holder.promise = undefined;
  if (current) await (await current).close().catch(() => {});
}
