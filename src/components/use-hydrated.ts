import { useSyncExternalStore } from "react";

/**
 * False while the server renders and during hydration, true once the page is interactive. Buttons
 * stay disabled until then, so an early click cannot submit a form as a plain page load.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
