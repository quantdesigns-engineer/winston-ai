"use client";

import { use, useEffect, useState } from "react";

interface ScrapedJob {
  source?: string;
  sources?: string[];
  jobId?: string;
  title?: string;
  standardizedTitle?: string;
  company?: string;
  location?: string;
  salary?: string;
  applyUrl?: string;
  url?: string;
  postedAt?: string;
  fullDescription?: string;
  descriptionSnippet?: string;
  remote?: boolean;
  [k: string]: unknown;
}

interface ReportData {
  run_id: string;
  queries: string[];
  sources: string[];
  location: string;
  started: string;
  total: number;
  items: ScrapedJob[];
}

export default function ReportPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  async function importToJobs() {
    setImporting(true);
    setImportMsg(null);
    setImportErr(null);
    try {
      const res = await fetch(`/api/jobs/wizard/import/${runId}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || body.error || res.statusText);
      setImportMsg(
        `Imported ${body.imported} new, updated ${body.updated}` +
          (body.skipped > 0 ? `, skipped ${body.skipped} (non-SWE/dupe)` : "") +
          ` of ${body.scraped} scraped.`
      );
    } catch (e: unknown) {
      setImportErr(e instanceof Error ? e.message : "import failed");
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/jobs/wizard/report/${runId}`);
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          throw new Error(`HTTP ${res.status} — session may have expired`);
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.statusText);
        if (!cancelled) setData(body as ReportData);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load report");
      }
    })();
    return () => { cancelled = true; };
  }, [runId]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-10 text-[14px] text-rose-700">
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3">
          <div className="font-semibold">Couldn&apos;t load report</div>
          <div className="mt-1">{error}</div>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl p-10 text-[14px] text-zinc-500">Loading…</div>
    );
  }

  const started = data.started ? new Date(data.started).toLocaleString() : "";

  return (
    <div className="report-root mx-auto max-w-[900px] bg-white px-10 py-8 text-[12px] leading-relaxed text-zinc-900">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .report-root { padding: 0 !important; max-width: 100% !important; }
          body { background: white !important; }
          .row { break-inside: avoid; }
        }
        body { background: #f3f4f6; }
      `}</style>

      <div className="no-print mb-6 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] text-zinc-600">
            Use <kbd className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-[11px]">⌘/Ctrl + P</kbd> to save as PDF.
          </div>
          <div className="flex flex-shrink-0 gap-2">
            <button
              onClick={importToJobs}
              disabled={importing || !!importMsg}
              className="rounded-md border border-blue-300 bg-blue-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing ? "Importing…" : importMsg ? "Imported ✓" : "Import to jobs table"}
            </button>
            <button
              onClick={() => window.print()}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Print / Save PDF
            </button>
          </div>
        </div>
        {importMsg && (
          <div className="mt-2 text-[11.5px] font-medium text-emerald-700">
            {importMsg} Open <a href="/jobs" className="underline">/jobs</a> to triage.
          </div>
        )}
        {importErr && (
          <div className="mt-2 text-[11.5px] font-medium text-rose-700">{importErr}</div>
        )}
      </div>

      <header className="mb-6 border-b border-zinc-200 pb-4">
        <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900">Job search report</h1>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[11.5px]">
          <Row k="Queries" v={data.queries.join(", ")} />
          <Row k="Location" v={data.location} />
          <Row k="Sources" v={data.sources.join(", ")} />
          <Row k="Run started" v={started} />
          <Row k="Total jobs" v={String(data.total)} />
          <Row k="Run ID" v={data.run_id} />
        </dl>
      </header>

      <section className="space-y-3">
        {data.items.map((job, i) => (
          <JobRow key={(job.jobId as string) || String(i)} job={job} index={i + 1} />
        ))}
        {data.items.length === 0 && (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-zinc-500">
            No jobs in this run.
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="contents">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="font-medium text-zinc-800">{v || "—"}</dd>
    </div>
  );
}

function JobRow({ job, index }: { job: ScrapedJob; index: number }) {
  const title = job.title || job.standardizedTitle || "(untitled)";
  const sources = job.sources && job.sources.length > 0 ? job.sources : (job.source ? [job.source] : []);
  const apply = job.applyUrl || job.url || "";
  const snippet = job.descriptionSnippet
    || (typeof job.fullDescription === "string" ? job.fullDescription.slice(0, 340) : "");
  return (
    <article className="row rounded-md border border-zinc-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-semibold text-zinc-900">
            <span className="mr-2 text-zinc-400 tabular-nums">{index}.</span>
            {title}
          </h2>
          <div className="mt-0.5 text-[12px] text-zinc-700">
            <span className="font-medium">{job.company || "—"}</span>
            {job.location ? <span className="text-zinc-500"> · {job.location}</span> : null}
            {job.salary ? <span className="text-zinc-500"> · {job.salary}</span> : null}
          </div>
        </div>
        {sources.length > 0 && (
          <div className="flex flex-shrink-0 flex-wrap gap-1">
            {sources.map(s => (
              <span
                key={s}
                className="inline-flex rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-zinc-600"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
      {snippet && (
        <p className="mt-2 whitespace-pre-wrap text-[11.5px] leading-relaxed text-zinc-700">
          {snippet}
          {job.fullDescription && snippet.length < (job.fullDescription as string).length ? "…" : ""}
        </p>
      )}
      {apply && (
        <div className="mt-2 text-[11px]">
          <a href={apply} target="_blank" rel="noreferrer" className="text-blue-700 underline">
            {apply}
          </a>
        </div>
      )}
    </article>
  );
}
