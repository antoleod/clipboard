import { Logo } from './Logo';

function initialsFromUser(user, profile) {
    const source = profile?.displayName || user?.displayName || user?.email || 'U';
    return source
        .split(/[.\s@_-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('');
}

export const Header = ({ onSignOut, onExport, onToggleSettings, user, profile }) => {
    const initials = initialsFromUser(user, profile);
    const displayName = profile?.displayName || user?.displayName || 'Signed in user';
    const email = profile?.email || user?.email || 'No email';

    return (
        <header className="header">
            <div className="brand">
                <Logo className="brand-logo" />
                <div>
                    <h1>Clipboard</h1>
                    <p>Futuristic clipboard intelligence with secure sync.</p>
                </div>
            </div>
            <div className="account-pill" aria-label="Logged in account">
                <div className="account-avatar">{initials || 'U'}</div>
                <div className="account-meta">
                    <strong>{displayName}</strong>
                    <span>{email}</span>
                    <small className="account-status">Status: online</small>
                </div>
            </div>
            <div className="header-actions">
                <button className="btn settings-trigger" onClick={onToggleSettings}>Settings</button>
                <button className="btn" onClick={onExport}>Export</button>
                <button onClick={onSignOut} className="signout-button">
                    Sign Out
                </button>
            </div>
        </header>
    );
};
