"use client";

import { useState } from "react";

/** A product page's hidden line. It is always plain text, never HTML (R6). */
export function HiddenLine({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <p
        data-testid="hidden-line"
        className={
          shown
            ? "rounded-lg border border-red-300 bg-red-50 px-3 py-2 font-mono text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
            : "select-none font-mono text-[2px] leading-none text-transparent"
        }
        aria-hidden={!shown}
      >
        {text}
      </p>
      <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <input type="checkbox" checked={shown} onChange={(e) => setShown(e.target.checked)} />
        Show hidden text
      </label>
    </div>
  );
}
