"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { DiscoveryRow } from "@/lib/discover";
import { discoverRowAction, rateFitAction, searchRowAction, startDiscoveryAction, trackRowAction } from "./actions";

type Candidate = { name: string; url: string | null; picked: boolean; tracked: boolean };

/** Shrinks a screenshot before upload: smaller and faster, still easily readable. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("resize failed"))), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

const FIT_ORDER = { strong: 0, possible: 1, weak: 2 } as const;
const fitRank = (r: DiscoveryRow) => (r.status === "found" ? (r.fit ? FIT_ORDER[r.fit] : 3) : 10);

export function DiscoverClient({
  run,
  runs,
  trackedNames,
  hasKey,
  hasResume,
  aiProblem,
}: {
  run: { id: number; rows: DiscoveryRow[] } | null;
  runs: { id: number; createdAt: string; companies: number; found: number }[];
  trackedNames: string[];
  hasKey: boolean;
  hasResume: boolean;
  aiProblem: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DiscoveryRow[]>(run?.rows ?? []);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const replace = (r: DiscoveryRow | null) => {
    if (r) setRows((prev) => prev.map((x) => (x.id === r.id ? r : x)));
  };
  const withBusy = async (id: number, fn: () => Promise<void>) => {
    setBusy((b) => new Set(b).add(id));
    try {
      await fn();
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(id);
        return n;
      });
    }
  };

  async function rate() {
    if (!hasKey || !hasResume) return;
    setPhase("Rating fit against your resume…");
    const res = await rateFitAction(run!.id);
    if (res.error) setError(res.error);
    setPhase(null);
    router.refresh();
  }

  // Check every company still pending (a new run, or one left part-way), then rate fit once.
  useEffect(() => {
    if (!run || started.current) return;
    const pending = run.rows.filter((r) => r.status === "pending");
    const unrated = run.rows.some((r) => r.status === "found" && !r.fit);
    if (!pending.length && !unrated) return;
    started.current = true;
    (async () => {
      if (pending.length) {
        setPhase(`Finding job boards… 0 of ${pending.length}`);
        let done = 0;
        await mapLimit(pending, 3, async (r) =>
          withBusy(r.id, async () => {
            replace(await discoverRowAction(r.id));
            setPhase(`Finding job boards… ${++done} of ${pending.length}`);
          }),
        );
      }
      await rate();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  async function search(ids: number[]) {
    setPhase(`Searching the web… 0 of ${ids.length}`);
    let done = 0;
    await mapLimit(ids, 2, async (id) =>
      withBusy(id, async () => {
        replace(await searchRowAction(id));
        setPhase(`Searching the web… ${++done} of ${ids.length}`);
      }),
    );
    await rate();
  }

  if (!run) return <NewDiscovery runs={runs} trackedNames={trackedNames} hasKey={hasKey} aiProblem={aiProblem} />;

  const sorted = [...rows].sort((a, b) => fitRank(a) - fitRank(b) || (b.matching ?? -1) - (a.matching ?? -1));
  const searchable = rows.filter((r) => r.status === "not_found" && !r.searched).map((r) => r.id);
  const found = rows.filter((r) => r.status === "found").length;

  return (
    <>
      <div className="row small" style={{ marginBottom: 8 }}>
        <Link href="/discover?new=1">+ New discovery</Link>
        {runs.length > 1 && (
          <select
            value={run.id}
            onChange={(e) => router.push(`/discover?run=${e.target.value}`)}
            style={{ width: "auto", marginLeft: "auto", fontSize: 13, padding: "4px 8px" }}
            aria-label="Earlier discoveries"
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.createdAt).toLocaleDateString()} · {r.companies} companies, {r.found} found
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="small">
        {found} of {rows.length} companies have a job board the tracker supports.
        {phase && <span className="muted"> {phase}</span>}
      </p>
      {aiProblem && <p className="notice small">{aiProblem} <Link href="/settings">Settings</Link></p>}
      {searchable.length > 0 && hasKey && !phase && (
        <p>
          <button type="button" className="secondary" onClick={() => search(searchable)}>
            Search the web for the {searchable.length} not found
          </button>{" "}
          <span className="muted small">about 2–4¢ each, billed to your API key</span>
        </p>
      )}
      {error && <p className="error small">{error}</p>}

      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>Company</th>
              <th>Roles</th>
              <th>Fit</th>
              <th style={{ paddingRight: 16 }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Row key={r.id} r={r} busy={busy.has(r.id)} canSearch={hasKey && !phase}
                onSearch={() => search([r.id])}
                onRetry={() => withBusy(r.id, async () => { replace(await discoverRowAction(r.id)); })}
                onTrack={() =>
                  withBusy(r.id, async () => {
                    const res = await trackRowAction(r.id);
                    if (res.ok) replace(res.row);
                    else setError(res.error);
                  })
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({ r, busy, canSearch, onSearch, onRetry, onTrack }: {
  r: DiscoveryRow; busy: boolean; canSearch: boolean; onSearch: () => void; onRetry: () => void; onTrack: () => void;
}) {
  const link = r.boardUrl ?? r.careersUrl;
  return (
    <tr>
      <td style={{ paddingLeft: 16 }}>
        <b>{r.name}</b>
        <div className="muted small">
          {r.status === "pending" && (busy ? "Checking…" : "Waiting")}
          {r.status === "found" && (
            <>
              <a href={link!} target="_blank" rel="noreferrer">{r.ats === "greenhouse" ? "Greenhouse" : r.ats === "ashby" ? "Ashby" : "Lever"} board ↗</a>
              {r.how === "search" && " · found by web search"}
            </>
          )}
          {r.status === "not_found" && (busy ? "Searching the web…" : r.searched ? "No careers page found" : "No supported job board found")}
          {r.status === "unsupported" && (
            <>
              {r.careersUrl && <a href={r.careersUrl} target="_blank" rel="noreferrer">Careers page ↗</a>} · uses a job board the tracker doesn't support
            </>
          )}
          {r.status === "error" && <span className="error">Couldn't check: {r.error}</span>}
        </div>
        {r.status === "found" && r.verified === false && (
          <div className="small" style={{ color: "var(--warn)" }}>Guessed from the name and may be a different company. Check the board.</div>
        )}
        {r.status !== "found" && r.error && r.status !== "error" && <div className="small muted">{r.error}</div>}
      </td>
      <td className="small">
        {r.status === "found" ? (
          <>
            <b>{r.matching}</b> of {r.openJobs} match your filters
            {r.topTitles.length > 0 && <div className="muted">{r.topTitles.slice(0, 3).join(" · ")}</div>}
            {r.topLocations.length > 0 && <div className="muted">{r.topLocations.join(" · ")}</div>}
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="small" style={{ maxWidth: 280 }}>
        {r.fit && <span className={`chip ${r.fit === "strong" ? "good" : r.fit === "weak" ? "bad" : "warn"}`}>{r.fit}</span>}
        {r.fitNote && (r.fit || r.status === "unsupported") && <div>{r.fitNote}</div>}
      </td>
      <td style={{ paddingRight: 16, whiteSpace: "nowrap" }}>
        {r.status === "found" &&
          (r.tracked ? <span className="chip good">Tracking</span> : <button type="button" onClick={onTrack} disabled={busy}>{busy ? "Adding…" : "Track"}</button>)}
        {r.status === "not_found" && !r.searched && canSearch && (
          <button type="button" className="secondary" onClick={onSearch} disabled={busy}>Search the web</button>
        )}
        {r.status === "error" && <button type="button" className="secondary" onClick={onRetry} disabled={busy}>Retry</button>}
      </td>
    </tr>
  );
}

function NewDiscovery({ runs, trackedNames, hasKey, aiProblem }: {
  runs: { id: number; createdAt: string; companies: number; found: number }[]; trackedNames: string[]; hasKey: boolean; aiProblem: string | null;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isTracked = (name: string) => trackedNames.includes(name.trim().toLowerCase());

  // Paste a screenshot straight onto the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const imgs = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (imgs.length) setFiles((f) => [...f, ...imgs].slice(0, 5));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  async function read() {
    setError(null);
    setBusy("Reading the screenshots…");
    try {
      const form = new FormData();
      for (const f of files) form.append("images", await shrink(f), f.name.replace(/\.\w+$/, "") + ".jpg");
      const res = await fetch("/api/discover/extract", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      const list = body.companies as { name: string; url: string | null }[];
      if (!list.length) throw new Error("No companies found in those screenshots.");
      setCandidates(list.map((c) => ({ ...c, tracked: isTracked(c.name), picked: !isTracked(c.name) })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    const picked = (candidates ?? []).filter((c) => c.picked && c.name.trim());
    setBusy("Starting…");
    const res = await startDiscoveryAction(picked.map((c) => ({ name: c.name, url: c.url })));
    if ("error" in res) {
      setError(res.error);
      setBusy(null);
      return;
    }
    router.push(`/discover?run=${res.runId}`);
  }

  const set = (i: number, patch: Partial<Candidate>) => setCandidates((cs) => cs!.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const pickedCount = candidates?.filter((c) => c.picked && c.name.trim()).length ?? 0;

  return (
    <>
      {runs.length > 0 && (
        <p className="small"><Link href={`/discover?run=${runs[0].id}`}>← Back to your latest discovery</Link></p>
      )}
      {aiProblem && !hasKey && <p className="notice small">{aiProblem} <Link href="/settings">Settings</Link></p>}
      {!candidates ? (
        <div className="panel">
          <label htmlFor="shots" style={{ marginTop: 0 }}>Screenshots of a list of companies</label>
          <input id="shots" type="file" accept="image/png,image/jpeg,image/webp" multiple
            onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 5))} />
          <p className="muted small">Up to 5 images. You can also paste a screenshot onto this page. Reading them costs well under 1¢.</p>
          {files.length > 0 && <p className="small">{files.length} image{files.length === 1 ? "" : "s"} ready.</p>}
          {error && <p className="error small">{error}</p>}
          <button type="button" onClick={read} disabled={!files.length || !hasKey || !!busy}>{busy ?? "Read companies"}</button>
        </div>
      ) : (
        <div className="panel">
          <p style={{ marginTop: 0 }}>
            Found {candidates.length} companies. Untick any you don't want checked. Nothing else happens until you click <b>Check</b>.
          </p>
          <div className="row small" style={{ gap: 12, marginBottom: 8 }}>
            <button type="button" className="secondary" onClick={() => setCandidates((cs) => cs!.map((c) => ({ ...c, picked: true })))}>Select all</button>
            <button type="button" className="secondary" onClick={() => setCandidates((cs) => cs!.map((c) => ({ ...c, picked: false })))}>Select none</button>
          </div>
          <div className="discover-list">
            {candidates.map((c, i) => (
              <div key={i} className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                <input type="checkbox" checked={c.picked} onChange={(e) => set(i, { picked: e.target.checked })} aria-label={`Check ${c.name}`} />
                <input type="text" value={c.name} onChange={(e) => set(i, { name: e.target.value, tracked: isTracked(e.target.value) })} style={{ flex: "1 1 40%" }} aria-label="Company name" />
                <input type="text" value={c.url ?? ""} placeholder="careers URL (optional)" onChange={(e) => set(i, { url: e.target.value || null })} style={{ flex: "1 1 45%" }} className="hide-sm" aria-label="Careers URL" />
                {c.tracked && <span className="chip good">tracking</span>}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input type="text" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Add another company" style={{ flex: "1 1 200px", width: "auto" }} />
            <button type="button" className="secondary" disabled={!extra.trim()}
              onClick={() => { setCandidates((cs) => [...cs!, { name: extra.trim(), url: null, picked: true, tracked: isTracked(extra) }]); setExtra(""); }}>
              Add
            </button>
          </div>
          {error && <p className="error small">{error}</p>}
          <p className="row">
            <button type="button" onClick={start} disabled={!pickedCount || !!busy}>{busy ?? `Check ${pickedCount} compan${pickedCount === 1 ? "y" : "ies"}`}</button>
            <button type="button" className="secondary" onClick={() => setCandidates(null)} disabled={!!busy}>Start over</button>
          </p>
          <p className="muted small">Checking finds each company's job board and compares its open roles with your filters (free), then rates fit with one short AI call.</p>
        </div>
      )}
    </>
  );
}
