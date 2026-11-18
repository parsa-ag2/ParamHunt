import React, { useEffect, useMemo, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { RequestRecord } from '@shared/types/http';
import { maskUrl, urlForCopy } from '@shared/mask';
import { CopyButton, Empty, Toast, useCopyFlash } from '../ui';

/** Request Inspector — observed request metadata + controlled manual replay. */
export default function RequestsTab({ origin, tabId }: { origin: string; tabId: number | null }) {
  const [requests, setRequests] = useState<RequestRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [flash, copyError, doCopy] = useCopyFlash();
  const [replaying, setReplaying] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  const refresh = (o: string) => {
    void sendRequest<{ requests: RequestRecord[]; total: number }>({
      type: 'http/query',
      ...(o ? { origin: o } : {}),
    })
      .then((r) => {
        setRequests(r.requests);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => refresh(origin), [origin]);

  const rows = useMemo(() => {
    const list = requests ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((r) => r.url.toLowerCase().includes(needle) || r.path.toLowerCase().includes(needle));
  }, [requests, filter]);

  const replay = async (r: RequestRecord, editedUrl: string) => {
    const ok = confirm(
      `Manually resend this GET request?\n\nDestination:\n${maskUrl(editedUrl)}\n\nMethod: GET · Credentials: NOT sent · Scope: enforced`,
    );
    if (!ok) return;
    setReplaying(r.id);
    setReplayResult(null);
    setReplayError(null);
    try {
      const res = await sendRequest<{ status: number; statusText: string; contentType?: string; bodyPreview?: string; finalUrl?: string; error?: string }>({
        type: 'http/replay',
        url: editedUrl,
      });
      if (res.error) {
        setReplayError(`${res.statusText}: ${res.error}`);
      } else {
        setReplayResult(
          `${res.status} ${res.statusText} · ${res.contentType ?? 'no content-type'}` +
            (res.bodyPreview ? `\n\n${res.bodyPreview}` : ''),
        );
      }
    } catch (err) {
      setReplayError(err instanceof Error ? err.message : String(err));
    } finally {
      setReplaying(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <Toast error={error ?? copyError} message={replayError ?? null} />
      <div className="flex items-center gap-2 border-b border-slate-700 px-3 py-1.5">
        <span className="text-[10px] uppercase text-slate-500">GET replay: manual · credentials omitted · scope enforced</span>
        <span className="ml-auto text-xs text-slate-400">{requests ? `${rows.length} requests` : '…'}</span>
      </div>
      <div className="border-b border-slate-700 px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search requests by URL/path…"
          className="w-full rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-sky-600"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {requests === null ? (
          <Empty label="Loading…" />
        ) : rows.length === 0 ? (
          <Empty label={'No requests observed for this site yet.\nRequests are metadata-only (URL, method, type, status).\nBodies, headers and cookie values are never collected.'} />
        ) : (
          <ul className="text-xs">
            {rows.map((r) => {
              const open = expanded === r.id;
              const display = maskUrl(r.url);
              return (
                <li key={r.id} className="border-t border-slate-800">
                  <div
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-800/60"
                    onClick={() => setExpanded(open ? null : r.id)}
                  >
                    <MethodBadge method={r.method} />
                    <span className="truncate font-mono text-slate-300" title={display}>
                      {display}
                    </span>
                    <span className="ml-auto flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <TypeBadge type={r.resourceType} />
                      {r.statusCode != null && <StatusBadge code={r.statusCode} />}
                      <span className="text-[10px] text-slate-500">{new Date(r.timestamp).toLocaleTimeString()}</span>
                    </span>
                  </div>
                  {open && <RequestDetail request={r} onReplay={replay} replaying={replaying === r.id} result={replayResult} doCopy={doCopy} flash={flash} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function RequestDetail({
  request,
  onReplay,
  replaying,
  result,
  doCopy,
  flash,
}: {
  request: RequestRecord;
  onReplay: (r: RequestRecord, editedUrl: string) => Promise<void>;
  replaying: boolean;
  result: string | null;
  doCopy: (text: string, key: string) => Promise<void>;
  flash: string | null;
}) {
  const isGet = request.method === 'GET';
  const [editedUrl, setEditedUrl] = useState(request.url);

  return (
    <div className="space-y-2 bg-slate-800/40 px-3 py-2 text-[11px] text-slate-300">
      <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1">
        <dt className="text-slate-500">method</dt>
        <dd>{request.method}</dd>
        <dt className="text-slate-500">path</dt>
        <dd className="font-mono">{request.path}</dd>
        <dt className="text-slate-500">origin</dt>
        <dd className="font-mono">{request.origin}</dd>
        <dt className="text-slate-500">initiator</dt>
        <dd className="font-mono">{request.initiatorOrigin ?? '—'}</dd>
        <dt className="text-slate-500">resource type</dt>
        <dd>{request.resourceType}</dd>
        <dt className="text-slate-500">status</dt>
        <dd>{request.statusCode ?? '—'}</dd>
        <dt className="text-slate-500">timestamp</dt>
        <dd>{new Date(request.timestamp).toLocaleString()}</dd>
      </dl>

      {/* editable query values — local until explicitly resent */}
      <div>
        <div className="mb-1 text-slate-500">URL (query values editable — local until you press Replay):</div>
        <input
          value={editedUrl}
          onChange={(e) => setEditedUrl(e.target.value)}
          className="w-full rounded bg-slate-900 px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-sky-600"
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <CopyButton onCopy={() => doCopy(urlForCopy(editedUrl, { includeValues: true }), `c-${request.id}`)} flashKey={`c-${request.id}`} flash={flash} label="Copy URL" />
          {isGet ? (
            <button
              onClick={() => void onReplay(request, editedUrl)}
              disabled={replaying}
              className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {replaying ? 'Sending…' : 'Replay (GET, credentials omitted)'}
            </button>
          ) : (
            <span className="text-[10px] text-slate-500">replay supported for GET only</span>
          )}
        </div>
        {result && <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-[10px] text-emerald-300">{result}</pre>}
      </div>

      <div>
        <div className="mb-1 text-slate-500">query parameter names:</div>
        <div className="flex flex-wrap gap-1">
          {request.paramNames.length > 0 ? (
            request.paramNames.map((p) => (
              <span key={p} className="rounded bg-slate-700 px-1 font-mono text-[10px] text-slate-200">
                {p}
              </span>
            ))
          ) : (
            <span className="text-slate-500">none</span>
          )}
        </div>
      </div>
    </div>
  );
}

function MethodBadge({ method }: { method: string }) {
  const tone =
    method === 'GET' ? 'bg-emerald-500/15 text-emerald-300' : method === 'POST' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-500/15 text-slate-300';
  return <span className={`rounded px-1 text-[10px] ${tone}`}>{method}</span>;
}

function TypeBadge({ type }: { type: string }) {
  return <span className="rounded bg-slate-700 px-1 text-[10px] text-slate-300">{type}</span>;
}

function StatusBadge({ code }: { code: number }) {
  const tone = code < 300 ? 'ok' : code < 400 ? 'warn' : 'bad';
  const cls = { ok: 'bg-emerald-500/15 text-emerald-300', warn: 'bg-amber-500/15 text-amber-300', bad: 'bg-red-500/15 text-red-300' }[tone]!;
  return <span className={`rounded px-1 text-[10px] ${cls}`}>{code}</span>;
}
