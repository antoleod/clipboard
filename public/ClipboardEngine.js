/**
 * ClipboardEngine.js
 * Core logic for capturing, deduplicating, and syncing clipboard content.
 */

export class ClipboardEngine {
    constructor(storageService, syncService) {
        this.storage = storageService;
        this.sync = syncService;
        this.lastHash = null;
        this.isPolling = false;
        this.debounceTimer = null;
    }

    init() {
        // 1. Event-driven capture
        document.addEventListener('copy', () => this.triggerCapture(100));
        document.addEventListener('cut', () => this.triggerCapture(100));

        // 2. Focus detection (Smart Polling)
        window.addEventListener('focus', () => {
            this.triggerCapture(0);
            this.forceSync('focus');
        });

        // 3. Network & Visibility for Sync
        window.addEventListener('online', () => this.forceSync('network_reconnect'));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.forceSync('visibility_visible');
            }
        });

        // 4. Fallback polling (only when window is active)
        this.startSmartPolling();
    }

    startSmartPolling() {
        setInterval(() => {
            if (document.hasFocus()) {
                this.readClipboard();
            }
        }, 2000); // Poll every 2s only if focused
    }

    triggerCapture(delay = 300) {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.readClipboard(), delay);
    }

    async readClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (!text || !text.trim()) return;
            await this.processContent(text);
        } catch (err) {
            console.warn('Clipboard read permission denied or empty', err);
        }
    }

    async processContent(text) {
        const normalized = text.trim();
        const hash = await this.generateHash(normalized);

        // Prevent rapid duplicate processing
        if (hash === this.lastHash) return;
        this.lastHash = hash;

        // Deduplication Logic
        const existingItem = await this.storage.findByHash(hash);

        if (existingItem) {
            // Update existing
            await this.storage.update(existingItem.id, {
                lastCopiedAt: Date.now(),
                usageCount: (existingItem.usageCount || 1) + 1
            });
            console.log('Clipboard: Item updated and moved to top');
        } else {
            // Create new
            const newItem = {
                id: crypto.randomUUID(),
                content: normalized,
                hash: hash,
                type: this.detectType(normalized),
                createdAt: Date.now(),
                lastCopiedAt: Date.now(),
                usageCount: 1,
                synced: false
            };
            await this.storage.add(newItem);
            console.log('Clipboard: New item captured');
        }

        // Trigger Sync after change
        this.forceSync('new_item_captured');
    }

    async generateHash(text) {
        const msgBuffer = new TextEncoder().encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    detectType(text) {
        if (/^https?:\/\//.test(text)) return 'url';
        if (/^#?([a-f0-9]{6}|[a-f0-9]{3})$/i.test(text)) return 'color';
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'email';
        return 'text';
    }

    async forceSync(reason) {
        console.log(`Sync triggered by: ${reason}`);
        try {
            // Timeout wrapper to prevent infinite loading
            await Promise.race([
                this.sync.synchronize(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 5000))
            ]);
        } catch (error) {
            console.error('Sync failed, falling back to local cache:', error);
        }
    }
}