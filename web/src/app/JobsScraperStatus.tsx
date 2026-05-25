"use client";

// App-wide indicator for the background job scraper. Mounted once in the
// root layout, so it shows on every page (the App Router keeps the layout
// mounted across client navigation). The scrape + DB import run server-side
// and never stop on navigation; this only mirrors their status and lets the
// user jump to /jobs. Fixed bottom-right, out of the way.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadActiveRun,
  clearActiveRun,
  SCRAPE_DONE_EVENT,
  type StoredRun,
} from "./jobs/wizardRun";

type Phase = "running" | "done" | "error";

export default function JobsScraperStatus() {
  const router = useRouter();
  const [run, setRun] = useState<StoredRun | null>(null);
  const [phase, setPhase] = useState<Phase>("running");
  const [total, setTotal] = useState(0);
  const [imported, setImported] = useState(0);
  const [updated, setUpdated] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Refs so the single polling interval reads fresh values without
  // resubscribing every tick.
  const runRef = useRef<StoredRun | null>(null);
  const phaseRef = useRef<Phase>("running");
  runRef.current = run;
  phaseRef.current = phase;

  const reset = useCallback(() => {
    setRun(null);
    setPhase("running");
    setTotal(0);
    setImported(0);
    setUpdated(0);
    setErrMsg(null);
    setDismissed(false);
  }, []);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      const stored = loadActiveRun();
      const cur = runRef.current;

      // A new (or first) run appeared in storage — adopt it.
      if (stored && (!cur || cur.runId !== stored.runId)) {
        setRun(stored);
        setPhase("running");
        setTotal(0);
        setImported(0);
        setUpdated(0);
        setErrMsg(null);
        setDismissed(false);
        return;
      }

      if (!cur) return;

      // Storage cleared by someone else (the in-page wizard finished and
      // refreshed the table itself). Nothing left to show.
      if (!stored) {
        if (phaseRef.current === "running") reset();
        return;
      }

      // Latched terminal states stop polling; they linger until the user
      // clicks through or dismisses, or a new run replaces them.
      if (phaseRef.current !== "running") return;

      let res: Response;
      try {
        res = await fetch(`/api/jobs/wizard/preview/${cur.runId}`);
      } catch {
        return; // transient blip — try again next tick
      }
      if (!alive) return;

      // Pruned/expired. It still imported server-side when it finished, so
      // present it as done (counts unknown) and let /jobs show the rows.
      if (res.status === 404) {
        setPhase("done");
        window.dispatchEvent(new CustomEvent(SCRAPE_DONE_EVENT));
        return;
      }

      let poll: Record<string, unknown>;
      try {
        poll = await res.json();
      } catch {
        return;
      }
      if (!alive) return;

      if (poll.status === "error") {
        setPhase("error");
        setErrMsg(typeof poll.error === "string" ? poll.error : "scrape failed");
        return;
      }
      if (poll.status === "done") {
        setTotal(typeof poll.total === "number" ? poll.total : 0);
        setImported(typeof poll.imported === "number" ? poll.imported : 0);
        setUpdated(typeof poll.updated === "number" ? poll.updated : 0);
        if (typeof poll.import_error === "string" && poll.import_error)
          setErrMsg(poll.import_error);
        setPhase("done");
        window.dispatchEvent(new CustomEvent(SCRAPE_DONE_EVENT));
      }
    };

    tick();
    const poll = setInterval(tick, 4000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [reset]);

  if (!run || dismissed) return null;

  const elapsed = Math.max(0, Math.floor((now - run.startedAt) / 1000));
  const mm = Math.floor(elapsed / 60);
  const ss = (elapsed % 60).toString().padStart(2, "0");

  const goToJobs = () => {
    if (phase !== "running") {
      clearActiveRun();
      reset();
    }
    router.push("/jobs");
  };
  const dismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearActiveRun();
    setDismissed(true);
  };

  const tone =
    phase === "done"
      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
      : phase === "error"
      ? "border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
      : "border-indigo-500/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25";
  const dotColor =
    phase === "done" ? "bg-emerald-400" : phase === "error" ? "bg-rose-400" : "bg-indigo-400";

  const label =
    phase === "running"
      ? `Jobs scraper · ${mm}:${ss}`
      : phase === "error"
      ? "Jobs scraper · failed"
      : imported || updated
      ? `Jobs · ${imported.toLocaleString()} new · ${updated.toLocaleString()} updated`
      : "Jobs scraper · done";

  return (
    <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-2">
      <button
        onClick={goToJobs}
        title={
          phase === "running"
            ? "Job scraper running in the background — click to open /jobs"
            : phase === "error"
            ? errMsg || "Scrape failed — click to open /jobs"
            : "Scrape finished and imported — click to view the jobs table"
        }
        className={`group flex items-center gap-2 rounded-full border px-3.5 py-2 shadow-xl backdrop-blur-xl transition ${tone}`}
      >
        <span className="relative flex h-2.5 w-2.5 items-center justify-center">
          {phase === "running" && (
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColor} opacity-75`} />
          )}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotColor}`} />
        </span>
        <span className="text-[12px] font-medium tabular-nums">{label}</span>
        <svg className="h-3 w-3 opacity-60 transition group-hover:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <button
        onClick={dismiss}
        title="Hide this indicator (the scrape keeps running on the server)"
        className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-[11px] text-zinc-400 shadow-xl backdrop-blur-xl hover:bg-white/[0.08] transition"
      >
        ✕
      </button>
    </div>
  );
}
