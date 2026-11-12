// Small key/value settings stored in the database, such as the saved PayPal reference.
import type { Queryable } from "@/lib/db";

export async function getSetting<T>(q: Queryable, key: string): Promise<T | null> {
  const rows = await q.query<{ value: T }>("SELECT value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(q: Queryable, key: string, value: unknown): Promise<void> {
  await q.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export const SAVED_PAYPAL_KEY = "paypal_saved";
