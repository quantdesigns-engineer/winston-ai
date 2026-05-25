// Shared persistence for the in-flight job-scrape "wizard" run.
//
// The scrape + DB import run server-side in the router goroutine and never
// stop when the browser navigates or reloads. We persist just the run id so
// the UI (the in-page wizard modal AND the global status pill) can re-attach
// and reflect progress wherever the user is in Winston.

export const ACTIVE_RUN_KEY = "winston.jobsWizardRun";

export interface StoredRun {
  runId: string;
  startedAt: number;
}

export function loadActiveRun(): StoredRun | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_RUN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredRun;
    return v && typeof v.runId === "string" && typeof v.startedAt === "number"
      ? v
      : null;
  } catch {
    return null;
  }
}

export function saveActiveRun(r: StoredRun) {
  if (typeof window !== "undefined")
    localStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(r));
}

export function clearActiveRun() {
  if (typeof window !== "undefined") localStorage.removeItem(ACTIVE_RUN_KEY);
}

export function hasActiveWizardRun(): boolean {
  return loadActiveRun() !== null;
}

// Fired by the global status pill when a run reaches "done", so a mounted
// /jobs page can refetch the table even if its wizard modal is closed.
export const SCRAPE_DONE_EVENT = "winston:jobsScrapeDone";
