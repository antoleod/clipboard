import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { ClipboardEngine } from '../../public/ClipboardEngine';

// Mock services for demonstration - replace with actual imports
const mockStorage = {
    getAll: async () => JSON.parse(localStorage.getItem('clip_cache') || '[]'),
    add: async (item) => {
        const current = JSON.parse(localStorage.getItem('clip_cache') || '[]');
        localStorage.setItem('clip_cache', JSON.stringify([item, ...current]));
    },
    findByHash: async () => null,
    update: async () => { }
};
const mockSync = { synchronize: async () => { } };

const AppContext = createContext();

export const AppProvider = ({ children }) => {
    const [items, setItems] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [syncStatus, setSyncStatus] = useState('idle'); // idle, syncing, error, synced
    const [searchQuery, setSearchQuery] = useState('');

    // Memoize engine to prevent re-instantiation
    const engine = useMemo(() => new ClipboardEngine(mockStorage, mockSync), []);

    // 1. Initial Load Strategy: Cache First
    useEffect(() => {
        const loadCache = async () => {
            const cached = await mockStorage.getAll();
            setItems(cached);
            setIsLoading(false); // UI is ready, even if sync isn't
        };

        loadCache();
        engine.init();

        // Setup listeners for engine events if engine supports them
        // For now, we simulate a sync start after load
        handleBackgroundSync();

        return () => {
            // cleanup
        };
    }, [engine]);

    // 2. Background Sync (Non-blocking)
    const handleBackgroundSync = async () => {
        setSyncStatus('syncing');
        try {
            await engine.forceSync('app_init');
            setSyncStatus('synced');
            // Refresh items after sync
            const fresh = await mockStorage.getAll();
            setItems(fresh);
        } catch (e) {
            setSyncStatus('error');
        }
    };

    // 3. Optimistic Updates
    const deleteItem = (id) => {
        // Remove from UI immediately
        setItems(prev => prev.filter(i => i.id !== id));
        // Perform actual delete in background
        // storage.delete(id);
    };

    const filteredItems = useMemo(() => {
        if (!searchQuery) return items;
        const lower = searchQuery.toLowerCase();
        return items.filter(i => i.content.toLowerCase().includes(lower));
    }, [items, searchQuery]);

    return (
        <AppContext.Provider value={{
            items: filteredItems,
            isLoading,
            syncStatus,
            setSearchQuery,
            deleteItem
        }}>
            {children}
        </AppContext.Provider>
    );
};

export const useApp = () => useContext(AppContext);