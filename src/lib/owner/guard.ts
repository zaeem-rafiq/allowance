// Reads the owner session from the request's cookies.
import { cookies } from "next/headers";
import { connection } from "next/server";
import { now } from "@/lib/ports";
import { OWNER_COOKIE, type OwnerSession, readSessionCookie } from "./session";

export async function currentOwner(): Promise<OwnerSession | null> {
  await connection();
  const jar = await cookies();
  return readSessionCookie(jar.get(OWNER_COOKIE)?.value, now().getTime());
}
