import React, { useState } from 'react';

/** Shared UI atoms for the ParamHunt panel (dark DevTools-consistent theme). */

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
        active ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

export function Badge({ tone, children, title }: { tone: 'ok' | 'bad' | 'warn' | 'info'; children: React.ReactNode; title?: string }) {
  const tones = {
    ok: 'bg-emerald-500/15 text-emerald-300',
    bad: 'bg-red-500/15 text-red-300',
    warn: 'bg-amber-500/15 text-amber-300',
    info: 'bg-slate-500/15 text-slate-300',
  };
  return (
    <span title={title} className={`rounded px-1 text-[10px] ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function CopyButton({ onCopy, label, flashKey, flash, disabled }: {
  onCopy: () => void;
  label: string;
  flashKey: string;
  flash: string | null;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onCopy}
      disabled={disabled}
      className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-200 hover:bg-slate-600 disabled:opacity-50"
    >
      {flash === flashKey ? '✓ Copied' : label}
    </button>
  );
}

export function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-xs whitespace-pre-line text-slate-500">
      {label}
    </div>
  );
}

export function Toast({ error, message }: { error?: string | null; message?: string | null }) {
  if (!error && !message) return null;
  return (
    <div className={`px-3 py-1 text-xs ${error ? 'bg-red-500/10 text-red-300' : 'bg-slate-800 text-slate-300'}`}>
      {error ?? message}
    </div>
  );
}

/** Copy feedback state shared by several actions in one view. */
export function useCopyFlash(): [string | null, string | null, (text: string, key: string) => Promise<void>] {
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const doCopy = async (text: string, key: string) => {
    const { copyText } = await import('@shared/clipboard');
    const ok = await copyText(text);
    if (ok) {
      setError(null);
      setFlash(key);
      setTimeout(() => setFlash((f) => (f === key ? null : f)), 1200);
    } else {
      setError('Clipboard copy failed — select the text manually.');
      setTimeout(() => setError(null), 3000);
    }
  };
  return [flash, error, doCopy];
}
