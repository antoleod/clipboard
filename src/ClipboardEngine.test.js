import { describe, it, expect, vi } from 'vitest';
import { ClipboardEngine } from './ClipboardEngine';

describe('ClipboardEngine', () => {
    it('should capture and process clipboard content', async () => {
        // Mock the storage and sync services
        const mockStorage = {
            add: vi.fn(),
            findByHash: vi.fn().mockResolvedValue(null)
        };
        const mockSync = {
            synchronize: vi.fn().mockResolvedValue(undefined)
        };

        // Mock clipboard readText
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                clipboard: {
                    readText: vi.fn().mockResolvedValue('test content')
                }
            },
            configurable: true
        });

        globalThis.crypto = {
            randomUUID: vi.fn().mockReturnValue('id-1'),
            subtle: {
                digest: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer)
            }
        };

        globalThis.TextEncoder = class {
            encode(value) {
                return new Uint8Array(Array.from(String(value)).map((char) => char.charCodeAt(0)));
            }
        };

        const engine = new ClipboardEngine(mockStorage, mockSync);

        await engine.readClipboard();

        expect(mockStorage.add).toHaveBeenCalledTimes(1);
        expect(mockStorage.add).toHaveBeenCalledWith(expect.objectContaining({
            content: 'test content',
            type: 'text'
        }));
    });
});
