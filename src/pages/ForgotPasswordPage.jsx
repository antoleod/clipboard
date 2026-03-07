import { useState } from 'react';
import { sendPasswordReset } from '../services/authService';
import { IconMail } from '../components/Icons';

export const ForgotPasswordPage = ({ onSwitchToLogin }) => {
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setMessage('');
        setLoading(true);
        try {
            await sendPasswordReset(email);
            setMessage('Password reset email sent! Check your inbox.');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <p className="auth-subheading">
                Password reset only works for real email-based accounts.
            </p>
            <div className="auth-form">
                <form onSubmit={handleSubmit}>
                    <div className="input-group">
                        <IconMail className="input-icon" />
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Enter your email"
                            required
                        />
                    </div>
                    {message && <p className="success-message">{message}</p>}
                    {error && <p className="error-message">{error}</p>}
                    <button type="submit" className="auth-button" disabled={loading}>
                        {loading ? (
                            <span className="spinner" />
                        ) : (
                            <span className="button-content">
                                <IconMail className="button-icon" />
                                Send Reset Email
                            </span>
                        )}
                    </button>
                </form>
                <div className="auth-links">
                    <button onClick={onSwitchToLogin} className="link-button">
                        Back to Login
                    </button>
                </div>
            </div>
        </>
    );
};
