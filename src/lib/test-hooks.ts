// Test mode only: switches the browser tests use to steer the scripted agent and compiler.
import { isTestMode } from "@/lib/mode";

type Hooks = Record<string, unknown>;
const holder = ((globalThis as Record<string, unknown>).__allowanceTestHooks ??= { hooks: {} }) as { hooks: Hooks };

export function setTestHooks(hooks: Hooks): void {
  if (!isTestMode()) throw new Error("Test hooks exist only in test mode.");
  holder.hooks = { ...holder.hooks, ...hooks };
}

export function resetTestHooks(): void {
  holder.hooks = {};
}

export function getTestHook<T>(name: string): T | undefined {
  if (!isTestMode()) return undefined;
  return holder.hooks[name] as T | undefined;
}
