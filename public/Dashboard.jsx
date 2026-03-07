import React from 'react';
import { useApp } from '../context/AppProvider';
import ClipboardItem from './ClipboardItem';

const Dashboard = () => {
    const { items, isLoading, syncStatus, setSearchQuery, deleteItem } = useApp();

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col">

            {/* 1. Compact Header */}
            <header className="sticky top-0 z-50 bg-[var(--bg-primary)]/90 backdrop-blur-md border-b border-[var(--border)] px-4 py-3">
                <div className="max-w-2xl mx-auto flex items-center gap-4">

                    {/* Logo / Status */}
                    <div className="relative">
                        <div className={`w-2 h-2 rounded-full ${syncStatus === 'syncing' ? 'bg-yellow-500 animate-pulse' :
                                syncStatus === 'synced' ? 'bg-[var(--status-success)]' : 'bg-red-500'
                            }`} />
                    </div>

                    {/* Integrated Search */}
                    <div className="flex-1 relative">
                        <input
                            type="text"
                            placeholder="Search clipboard..."
                            className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-full py-1.5 px-4 text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* Minimal Actions */}
                    <button className="text-[var(--text-secondary)] hover:text-white text-xs font-medium">
                        SELECT
                    </button>
                </div>

                {/* Collapsible Filters (Horizontal Scroll) */}
                <div className="max-w-2xl mx-auto mt-3 flex gap-2 overflow-x-auto hide-scrollbar pb-1">
                    {['All', 'Links', 'Images', 'Code', 'Email', 'Files'].map(filter => (
                        <button
                            key={filter}
                            className="whitespace-nowrap px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all"
                        >
                            {filter}
                        </button>
                    ))}
                </div>
            </header>

            {/* 2. Main Content Area */}
            <main className="flex-1 max-w-2xl w-full mx-auto p-4">

                {/* Loading State: Skeleton */}
                {isLoading ? (
                    <div className="space-y-3 animate-pulse">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="h-24 bg-[var(--card-bg)] rounded-lg border border-[var(--border)]" />
                        ))}
                    </div>
                ) : (
                    /* Content List */
                    <div className="space-y-1">
                        {items.length === 0 ? (
                            <div className="text-center py-20 text-[var(--text-secondary)]">
                                <p>Clipboard is empty</p>
                            </div>
                        ) : (
                            items.map(item => (
                                <ClipboardItem
                                    key={item.id}
                                    item={item}
                                    onDelete={deleteItem}
                                />
                            ))
                        )}
                    </div>
                )}
            </main>

            {/* 3. Footer / Status Bar (Optional, keeps UI clean) */}
            <footer className="py-4 text-center text-[10px] text-[var(--text-secondary)] opacity-50">
                <p>Vault Secure • {items.length} Items • {syncStatus.toUpperCase()}</p>
            </footer>
        </div>
    );
};

export default Dashboard;