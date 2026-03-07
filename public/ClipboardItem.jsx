import React, { memo, useState } from 'react';

/**
 * ClipboardItem
 * Minimalist card with hidden actions and optimized rendering.
 */
const ClipboardItem = memo(({ item, onDelete }) => {
    const [menuOpen, setMenuOpen] = useState(false);

    const copyToClipboard = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(item.content);
        // Trigger toast here
    };

    return (
        <div
            className="card relative p-4 mb-3 group hover:bg-opacity-10 hover:bg-white cursor-pointer"
            onClick={copyToClipboard}
        >
            {/* Header: Type & Time */}
            <div className="flex justify-between items-center mb-2 opacity-60 text-xs uppercase tracking-wider font-semibold">
                <span className="text-[var(--accent)]">{item.type || 'Text'}</span>
                <span>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>

            {/* Content Preview */}
            <div className="text-[var(--text-primary)] text-sm font-medium line-clamp-3 leading-relaxed font-mono">
                {item.content}
            </div>

            {/* Hover Actions (Desktop) / Menu (Mobile) */}
            <div className="absolute top-2 right-2">
                <button
                    className="p-2 text-[var(--text-secondary)] hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(!menuOpen);
                    }}
                >
                    {/* 3-dot icon */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="12" cy="5" r="2" />
                        <circle cx="12" cy="19" r="2" />
                    </svg>
                </button>

                {/* Context Menu */}
                {menuOpen && (
                    <div className="absolute right-0 mt-1 w-32 bg-[var(--bg-secondary)] border border-[var(--border)] rounded shadow-xl z-10 overflow-hidden">
                        <button className="w-full text-left px-4 py-2 text-xs hover:bg-[var(--accent)] hover:text-black transition-colors">
                            Pin Item
                        </button>
                        <button
                            className="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-red-900 hover:text-white transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(item.id);
                            }}
                        >
                            Delete
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
});

export default ClipboardItem;