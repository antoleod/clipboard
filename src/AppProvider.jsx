import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardEngine } from './services/ClipboardEngine';
import { AppContext } from './context/appContext';

const mockStorage = {
  getAll: async () => JSON.parse(localStorage.getItem('clip_cache') || '[]'),
  add: async (item) => {
    const current = JSON.parse(localStorage.getItem('clip_cache') || '[]');
    localStorage.setItem('clip_cache', JSON.stringify([item, ...current]));
  },
  findByHash: async () => null,
  update: async () => {}
};

const mockSync = { synchronize: async () => {} };

export function AppProvider({ children }) {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [searchQuery, setSearchQuery] = useState('');
  const engine = useMemo(() => new ClipboardEngine(mockStorage, mockSync), []);

  const handleBackgroundSync = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      await engine.forceSync('app_init');
      const fresh = await mockStorage.getAll();
      setItems(fresh);
      setSyncStatus('synced');
    } catch {
      setSyncStatus('error');
    }
  }, [engine]);

  useEffect(() => {
    let active = true;

    const loadCache = async () => {
      const cached = await mockStorage.getAll();
      if (!active) return;
      setItems(cached);
      setIsLoading(false);
      handleBackgroundSync();
    };

    loadCache();
    engine.init();

    return () => {
      active = false;
    };
  }, [engine, handleBackgroundSync]);

  const deleteItem = useCallback((id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const lower = searchQuery.toLowerCase();
    return items.filter((item) => item.content.toLowerCase().includes(lower));
  }, [items, searchQuery]);

  const value = useMemo(
    () => ({
      items: filteredItems,
      isLoading,
      syncStatus,
      setSearchQuery,
      deleteItem
    }),
    [deleteItem, filteredItems, isLoading, syncStatus]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
