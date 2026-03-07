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
        global.navigator.clipboard = {
            readText: vi.fn().mockResolvedValue('test content')
        };

        const engine = new ClipboardEngine(mockStorage, mockSync);

        // Call processContent indirectly via readClipboard
        await engine.readClipboard();

        // Assert that storage.add was called with the correct arguments
        expect(mockStorage.add).toHaveBeenCalledTimes(1);
        expect(mockStorage.add).toHaveBeenCalledWith(expect.objectContaining({
            content: 'test content',
            type: 'text' // Default type
        }));
    });
});