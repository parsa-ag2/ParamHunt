// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('copyText (honest success reporting)', () => {
  it('uses navigator.clipboard and returns true only on success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('redirect_uri')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('redirect_uri');
  });

  it('falls back to execCommand when the async clipboard API rejects', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec as unknown as typeof document.execCommand;
    expect(await copyText('callback')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('returns FALSE when every path fails — never a fake success', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    document.execCommand = vi.fn().mockReturnValue(false) as unknown as typeof document.execCommand;
    expect(await copyText('next')).toBe(false);
  });

  it('empty text is a no-op', async () => {
    expect(await copyText('')).toBe(false);
  });
});
