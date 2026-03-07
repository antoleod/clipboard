import { useState } from 'react';
import { signInWithEmailPassword } from '../services/authService';
import { IconMail, IconLock } from '../components/Icons';

export const LoginPage = ({
    onSwitchToRegister,
    onSwitchToForgotPassword,
    keepSignedIn,
    onToggleKeepSignedIn
}) => {
    const [identifier, setIdentifier] = useState('');
    const [secret, setSecret] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await signInWithEmailPassword(identifier, secret, { keepSignedIn });
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <p className="auth-subheading">
                Sign in with email/password or username/pincode.
            </p>
            <div className="auth-form">
                <form onSubmit={handleSubmit}>
                    <div className="input-group">
                        <IconMail className="input-icon" />
                        <input
                            id="identifier"
                            type="text"
                            value={identifier}
                            onChange={(e) => setIdentifier(e.target.value)}
                            placeholder="Email or username"
                            required
                        />
                    </div>
                    <div className="input-group">
                        <IconLock className="input-icon" />
                        <input
                            id="secret"
                            type="password"
                            value={secret}
                            onChange={(e) => setSecret(e.target.value)}
                            placeholder="Password or pincode"
                            required
                        />
                    </div>
                    <label className="auth-switch">
                        <input
                            type="checkbox"
                            checked={keepSignedIn}
                            onChange={(event) => onToggleKeepSignedIn(event.target.checked)}
                        />
                        Keep me signed in
                    </label>
                    {error && <div className="error-alert">{error}</div>}
                    <button type="submit" className="auth-button" disabled={loading}>
                        {loading ? (
                            <span className="spinner" />
                        ) : (
                            <span className="button-content">
                                <IconLock className="button-icon" />
                                Sign In
                            </span>
                        )}
                    </button>
                </form>
            </div>
            <div className="auth-links">
                <button onClick={onSwitchToRegister} className="link-button">
                    Don&apos;t have an account? Register
                </button>
                <button onClick={onSwitchToForgotPassword} className="link-button">
                    Forgot Password?
                </button>
            </div>
        </>
    );
};
