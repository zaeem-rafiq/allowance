// Binds the shopping agent port: the scripted agent in test mode, Claude Haiku otherwise.
import { assertModeAllowed, isTestMode } from "@/lib/mode";
import type { ShoppingAgent } from "./port";
import { ScriptedAgent } from "./scripted";

export async function getAgent(): Promise<ShoppingAgent> {
  assertModeAllowed();
  if (isTestMode()) return new ScriptedAgent();
  const { HaikuAgent } = await import("./haiku");
  return new HaikuAgent();
}
