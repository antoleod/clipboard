import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readClipboardSnapshot } from './clipboard';

describe('readClipboardSnapshot', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: {
          readText: vi.fn()
        }
      },
      configurable: true
    });
  });

  it('returns text clipboard payloads', async () => {
    navigator.clipboard.readText.mockResolvedValue('hello world');

    await expect(readClipboardSnapshot()).resolves.toEqual(
      expect.objectContaining({
        kind: 'text',
        content: 'hello world',
        preview: 'hello world'
      })
    );
  });

  it('throws when clipboard text is empty', async () => {
    navigator.clipboard.readText.mockResolvedValue('');

    await expect(readClipboardSnapshot()).rejects.toThrow('Clipboard is empty or unchanged.');
  });

  it('throws when clipboard read is denied', async () => {
    navigator.clipboard.readText.mockRejectedValue(new Error('denied'));

    await expect(readClipboardSnapshot()).rejects.toThrow('Clipboard permission denied. Please enable it in your browser.');
  });
});
