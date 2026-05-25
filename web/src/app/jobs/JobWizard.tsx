"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadActiveRun, saveActiveRun, clearActiveRun } from "./wizardRun";

interface SourceProgress {
  status: "pending" | "running" | "done" | "error";
  items: number;
  error?: string;
}

const MARKETPLACES: { id: string; label: string; defaultOn: boolean }[] = [
  { id: "linkedin", label: "LinkedIn", defaultOn: true },
  { id: "indeed", label: "Indeed", defaultOn: true },
  { id: "google", label: "Google Jobs", defaultOn: true },
  { id: "upwork", label: "Upwork", defaultOn: false },
];

type Stage = "form" | "scraping" | "done";

interface WizardActivity {
  running: boolean;
  stage: Stage;
  startedAt: number | null;
}


export default function JobWizard({
  visible,
  onClose,
  onBackground,
  onActivityChange,
  onImported,
}: {
  visible: boolean;
  onClose: () => void;
  onBackground: () => void;
  onActivityChange?: (a: WizardActivity) => void;
  // Fired when a finished scrape has been imported into the jobs DB, so the
  // page can refetch the table. The scrape is the pipeline — no report.
  onImported?: () => void;
}) {
  const [stage, setStage] = useState<Stage>("form");

  const [titlesInput, setTitlesInput] = useState("");
  const [titles, setTitles] = useState<string[]>([]);
  const [location, setLocation] = useState("United States");
  const [remote, setRemote] = useState(true);
  const [minSalary, setMinSalary] = useState(0);
  const [sources, setSources] = useState<Set<string>>(() =>
    new Set(MARKETPLACES.filter(m => m.defaultOn).map(m => m.id))
  );

  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scrapeTotal, setScrapeTotal] = useState(0);
  const [imported, setImported] = useState(0);
  const [updated, setUpdated] = useState(0);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [sourceProgress, setSourceProgress] = useState<Record<string, SourceProgress>>({});

  const addTitlesFromInput = useCallback(() => {
    const parts = titlesInput
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    setTitles(prev => {
      const existing = new Set(prev.map(t => t.toLowerCase()));
      const next = [...prev];
      for (const p of parts) {
        if (!existing.has(p.toLowerCase()) && next.length < 12) {
          next.push(p);
          existing.add(p.toLowerCase());
        }
      }
      return next;
    });
    setTitlesInput("");
  }, [titlesInput]);

  const removeTitle = (t: string) =>
    setTitles(prev => prev.filter(x => x !== t));

  const canSubmit = titles.length > 0 && sources.size > 0;

  // Polls a server-side run to completion. The scrape + DB import run in
  // the router goroutine independent of this client, so this only mirrors
  // state — losing the poller (navigation/reload) never stops the run.
  // Returns "done" (status flipped, counts present), or "gone" (run pruned
  // or expired — the import already landed server-side). Throws on real
  // scrape failure.
  const pollUntilDone = useCallback(
    async (id: string, startedAt: number): Promise<"done" | "gone"> => {
      // Server keeps runs ~2h; cap the client a little under that. The
      // import still completes server-side even past this.
      const deadline = startedAt + 50 * 60 * 1000;
      while (true) {
        await new Promise(r => setTimeout(r, 5000));
        if (Date.now() > deadline) return "gone";
        let pollRes: Response;
        try {
          pollRes = await fetch(`/api/jobs/wizard/preview/${id}`);
        } catch {
          continue; // transient network blip — keep trying
        }
        // 404 → the run was pruned/expired. Its import already ran when it
        // finished server-side, so treat as silently complete.
        if (pollRes.status === 404) return "gone";
        const poll = await parseJsonOrThrow(pollRes);
        if (poll.progress) setSourceProgress(poll.progress as Record<string, SourceProgress>);
        if (poll.status === "error") throw new Error(asString(poll.error) || "scrape failed");
        if (poll.status === "done") {
          // Server imports automatically before flipping to "done", so the
          // counts are present here. No report, no manual button.
          setScrapeTotal(typeof poll.total === "number" ? poll.total : 0);
          setImported(typeof poll.imported === "number" ? poll.imported : 0);
          setUpdated(typeof poll.updated === "number" ? poll.updated : 0);
          setImportWarning(asString(poll.import_error) || null);
          return "done";
        }
      }
    },
    []
  );

  // Shared terminal step: clear the persisted run and tell the page to
  // refetch the table (the rows are already imported server-side).
  const finishRun = useCallback(() => {
    clearActiveRun();
    setStage("done");
    onImported?.();
  }, [onImported]);

  const runScrape = useCallback(async () => {
    if (!canSubmit) return;
    setStage("scraping");
    setScrapeError(null);
    setSourceProgress({});
    setScrapeTotal(0);
    setImported(0);
    setUpdated(0);
    setImportWarning(null);
    try {
      const startRes = await fetch("/api/jobs/wizard/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: titles,
          location,
          remote,
          limit: 500,
          sources: Array.from(sources),
        }),
      });
      const start = await parseJsonOrThrow(startRes);
      if (!startRes.ok) throw new Error(asString(start.error) || startRes.statusText);
      const id = start.run_id as string;
      if (!id) throw new Error("no run_id returned");

      const startedAt = Date.now();
      // Persist immediately so a reload/navigation in the next second still
      // reattaches to this run.
      saveActiveRun({ runId: id, startedAt });
      const outcome = await pollUntilDone(id, startedAt);
      if (outcome === "gone") {
        setImportWarning(
          "Run finished or expired while detached — table refreshed from the server."
        );
      }
      finishRun();
    } catch (e: unknown) {
      clearActiveRun();
      setScrapeError(e instanceof Error ? e.message : "scrape failed");
      setStage("form");
    }
  }, [canSubmit, titles, location, remote, sources, pollUntilDone, finishRun]);

  const onSubmit = useCallback(() => {
    void runScrape();
  }, [runScrape]);

  // Re-attach to an in-flight run on mount (navigated back to /jobs, or a
  // full reload). The scrape itself never stopped — this just reconnects
  // the UI and refreshes the table when it lands.
  useEffect(() => {
    if (stage !== "form") return;
    const stored = loadActiveRun();
    if (!stored) return;
    let cancelled = false;
    setStage("scraping");
    setScrapeError(null);
    setSourceProgress({});
    (async () => {
      try {
        const outcome = await pollUntilDone(stored.runId, stored.startedAt);
        if (cancelled) return;
        if (outcome === "gone") {
          setImportWarning(
            "Run finished while you were away — table refreshed from the server."
          );
        }
        finishRun();
      } catch (e: unknown) {
        if (cancelled) return;
        clearActiveRun();
        setScrapeError(e instanceof Error ? e.message : "scrape failed");
        setStage("form");
      }
    })();
    return () => { cancelled = true; };
    // Mount-only: resume once. Subsequent state changes shouldn't retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isBusy = stage === "scraping";
  const [busyStart, setBusyStart] = useState<number | null>(null);
  useEffect(() => {
    if (isBusy && busyStart === null) setBusyStart(Date.now());
    if (!isBusy) setBusyStart(null);
  }, [isBusy, busyStart]);
  useEffect(() => {
    onActivityChange?.({ running: isBusy, stage, startedAt: busyStart });
  }, [isBusy, stage, busyStart, onActivityChange]);

  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const handleClose = () => {
    if (isBusy) setShowCloseConfirm(true);
    else onClose();
  };

  const subtitle = useMemo(() => {
    switch (stage) {
      case "form": return "Filters like LinkedIn — pick marketplaces and target titles";
      case "scraping": return "Scraping, then importing into the jobs table…";
      case "done": return "Imported into the jobs table";
    }
  }, [stage]);

  return (
    <div
      className={`fixed inset-0 z-50 items-center justify-center bg-black/70 backdrop-blur-sm p-4 ${
        visible ? "flex" : "hidden"
      }`}
    >
      <div
        className="relative flex h-[min(90vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-950 shadow-2xl"
        role="dialog"
        aria-labelledby="wizard-title"
      >
        {showCloseConfirm && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-xl border border-white/[0.1] bg-zinc-950 p-5 shadow-2xl">
              <h3 className="text-[14px] font-semibold text-zinc-100">A run is in progress</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-400">
                The wizard is still working. Close and cancel, or run in the background?
              </p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => { setShowCloseConfirm(false); onClose(); }}
                  className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[12px] font-medium text-rose-200 hover:bg-rose-500/20 transition"
                >
                  Cancel run
                </button>
                <button
                  onClick={() => { setShowCloseConfirm(false); onBackground(); }}
                  className="rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-1.5 text-[12px] font-medium text-indigo-200 hover:bg-indigo-500/25 transition"
                >
                  Run in background
                </button>
                <button
                  onClick={() => setShowCloseConfirm(false)}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-white/[0.08] transition"
                >
                  Stay
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.2-5.2M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
              </svg>
            </div>
            <div>
              <h2 id="wizard-title" className="text-[14px] font-semibold text-zinc-100">Job search</h2>
              <p className="text-[11.5px] text-zinc-500">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/[0.08] transition"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {stage === "form" && (
            <FormBody
              titlesInput={titlesInput}
              setTitlesInput={setTitlesInput}
              addTitles={addTitlesFromInput}
              titles={titles}
              removeTitle={removeTitle}
              location={location} setLocation={setLocation}
              remote={remote} setRemote={setRemote}
              minSalary={minSalary} setMinSalary={setMinSalary}
              sources={sources}
              onToggleSource={(id) => {
                setSources(prev => {
                  const n = new Set(prev);
                  if (n.has(id)) n.delete(id); else n.add(id);
                  return n;
                });
              }}
              scrapeError={scrapeError}
            />
          )}
          {stage === "scraping" && (
            <ScrapingBody
              progress={sourceProgress}
              total={scrapeTotal}
              error={scrapeError}
            />
          )}
          {stage === "done" && (
            <DoneBody
              total={scrapeTotal}
              imported={imported}
              updated={updated}
              warning={importWarning}
              onClose={onClose}
            />
          )}
        </div>

        {stage === "form" && (
          <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] bg-black/20 px-6 py-4">
            <button
              onClick={handleClose}
              className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-white/[0.08] transition"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/15 px-3.5 py-1.5 text-[12px] font-medium text-indigo-200 hover:bg-indigo-500/25 transition disabled:opacity-40"
            >
              Scrape + import to table →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FormBody(props: {
  titlesInput: string;
  setTitlesInput: (v: string) => void;
  addTitles: () => void;
  titles: string[];
  removeTitle: (t: string) => void;
  location: string; setLocation: (v: string) => void;
  remote: boolean; setRemote: (v: boolean) => void;
  minSalary: number; setMinSalary: (v: number) => void;
  sources: Set<string>; onToggleSource: (id: string) => void;
  scrapeError: string | null;
}) {
  return (
    <div className="space-y-5">
      <div>
        <label className="text-[11px] uppercase tracking-wide text-zinc-500">
          Job titles ({props.titles.length})
        </label>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={props.titlesInput}
            onChange={e => props.setTitlesInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                props.addTitles();
              }
            }}
            onBlur={() => { if (props.titlesInput.trim()) props.addTitles(); }}
            placeholder="e.g. Software Engineer, Backend Engineer, Staff Engineer"
            className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[13px] text-zinc-200 placeholder-zinc-600 focus:border-indigo-500/40 focus:outline-none"
            autoFocus
          />
          <button
            onClick={props.addTitles}
            disabled={!props.titlesInput.trim()}
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12px] font-medium text-zinc-200 hover:bg-white/[0.08] transition disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {props.titles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {props.titles.map(t => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[11.5px] text-indigo-200"
              >
                {t}
                <button
                  onClick={() => props.removeTitle(t)}
                  className="text-indigo-300/70 hover:text-indigo-100"
                  aria-label={`Remove ${t}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mt-1.5 text-[11px] text-zinc-600">
          Press Enter or comma to add. Up to 12 titles.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="text-[11px] uppercase tracking-wide text-zinc-500">Location</label>
          <input
            type="text"
            value={props.location}
            onChange={e => props.setLocation(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[13px] text-zinc-200 focus:border-indigo-500/40 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-zinc-500">Min salary (USD)</label>
          <input
            type="number"
            value={props.minSalary || ""}
            onChange={e => props.setMinSalary(parseInt(e.target.value || "0", 10))}
            placeholder="0"
            className="mt-2 w-full rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[13px] text-zinc-200 focus:border-indigo-500/40 focus:outline-none"
          />
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-zinc-300">
        <input
          type="checkbox"
          checked={props.remote}
          onChange={e => props.setRemote(e.target.checked)}
          className="h-4 w-4 rounded border-white/[0.15] bg-white/[0.03] accent-indigo-500"
        />
        Remote only
      </label>

      <div>
        <label className="text-[11px] uppercase tracking-wide text-zinc-500">Sources</label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {MARKETPLACES.map(m => {
            const on = props.sources.has(m.id);
            return (
              <button
                key={m.id}
                onClick={() => props.onToggleSource(m.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition ${
                  on
                    ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-200"
                    : "border-white/[0.06] bg-white/[0.02] text-zinc-300 hover:bg-white/[0.05]"
                }`}
              >
                <span className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border ${
                  on ? "border-indigo-400 bg-indigo-500 text-white" : "border-white/[0.15]"
                }`}>
                  {on && (
                    <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </span>
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {props.scrapeError && <ErrorBox message={props.scrapeError} />}
    </div>
  );
}

function ScrapingBody(props: {
  progress: Record<string, SourceProgress>;
  total: number;
  error: string | null;
}) {
  if (props.error) return <ErrorBox message={props.error} />;
  return (
    <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
      <Spinner />
      <div className="mt-4 text-[13px]">Scraping marketplaces…</div>
      <div className="mt-1 text-[11.5px] text-zinc-600">
        Broad queries can take 15–20 min. <Elapsed /> elapsed.
      </div>
      <SourceProgressStrip progress={props.progress} />
      {props.total > 0 && (
        <div className="mt-4 text-[12px] text-zinc-300">
          {props.total} jobs so far
        </div>
      )}
    </div>
  );
}

function DoneBody({
  total, imported, updated, warning, onClose,
}: {
  total: number;
  imported: number;
  updated: number;
  warning: string | null;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
      <h3 className="mt-4 text-[15px] font-semibold text-zinc-100">
        {imported.toLocaleString()} new · {updated.toLocaleString()} updated
      </h3>
      <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-zinc-500">
        Scraped {total.toLocaleString()} listings and imported them straight into
        the jobs table (non-SWE and duplicates filtered out). Close this to see them.
      </p>
      {warning && (
        <div className="mt-3 max-w-md rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-200">
          Import reported an issue: {warning}
        </div>
      )}
      <button
        onClick={onClose}
        className="mt-5 rounded-lg border border-indigo-500/30 bg-indigo-500/15 px-4 py-1.5 text-[12px] font-medium text-indigo-200 hover:bg-indigo-500/25 transition"
      >
        View jobs
      </button>
    </div>
  );
}

async function parseJsonOrThrow(res: Response): Promise<Record<string, unknown>> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const snippet = (await res.text()).slice(0, 120);
    if (snippet.toLowerCase().includes("<!doctype") || res.redirected) {
      throw new Error("Session expired. Open Winston in a new tab to re-authenticate, then try again.");
    }
    throw new Error(`Unexpected response (HTTP ${res.status}): ${snippet}`);
  }
  return await res.json();
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function SourceProgressStrip({ progress }: { progress: Record<string, SourceProgress> }) {
  const entries = Object.entries(progress);
  if (entries.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
      {entries.map(([src, p]) => {
        const label = MARKETPLACES.find(m => m.id === src)?.label || src;
        const color =
          p.status === "done" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" :
          p.status === "error" ? "border-rose-500/40 bg-rose-500/10 text-rose-200" :
          p.status === "running" ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-200" :
          "border-white/[0.08] bg-white/[0.02] text-zinc-400";
        return (
          <span
            key={src}
            title={p.error || `${p.items} items`}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${color}`}
          >
            {p.status === "running" && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
            )}
            {label}
            <span className="tabular-nums opacity-70">
              {p.status === "done" ? `${p.items}` :
               p.status === "error" ? "×" :
               p.status === "running" ? "…" :
               "—"}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function Elapsed() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return <span className="tabular-nums text-zinc-400">{m}:{s.toString().padStart(2, "0")}</span>;
}

function Spinner() {
  return (
    <svg className="h-7 w-7 animate-spin text-indigo-300" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-[12.5px] text-rose-200">
      <div className="font-medium">Something went wrong</div>
      <div className="mt-1 text-rose-300/80">{message}</div>
    </div>
  );
}
