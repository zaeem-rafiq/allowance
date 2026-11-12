// Binds the rule compiler port: the scripted compiler in test mode, Claude Sonnet otherwise.
import { assertModeAllowed, isTestMode } from "@/lib/mode";
import type { RuleCompiler } from "./compile";
import { ScriptedCompiler } from "./scripted-compiler";
import { SonnetCompiler } from "./sonnet-compiler";

export function getRuleCompiler(): RuleCompiler {
  assertModeAllowed();
  if (isTestMode()) return new ScriptedCompiler();
  return new SonnetCompiler();
}
