import { useState } from 'react';
import { signUpWithUsernamePin } from '../services/authService';
import { IconMail, IconLock } from '../components/Icons';

export const RegisterPage = ({ onSwitchToLogin, keepSignedIn }) => {
    const [username, setUsername] = useState('');
    const [pin, setPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (pin !== confirmPin) {
            setError('Pincodes do not match.');
            return;
        }
        setError('');
        setLoading(true);
        try {
            await signUpWithUsernamePin(username, pin, { keepSignedIn });
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <p className="auth-subheading">
                Create your account with username and pincode (4 to 8 digits).
            </p>
            <div className="auth-form">
                <form onSubmit={handleSubmit}>
                    <div className="input-group">
                        <IconMail className="input-icon" />
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Username"
                            required
                        />
                    </div>
                    <div className="input-group">
                        <IconLock className="input-icon" />
                        <input
                            type="password"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            placeholder="Pincode"
                            inputMode="numeric"
                            pattern="[0-9]{4,8}"
                            required
                        />
                    </div>
                    <div className="input-group">
                        <IconLock className="input-icon" />
                        <input
                            type="password"
                            value={confirmPin}
                            onChange={(e) => setConfirmPin(e.target.value)}
                            placeholder="Confirm Pincode"
                            inputMode="numeric"
                            pattern="[0-9]{4,8}"
                            required
                        />
                    </div>
                    {error && <p className="error-message">{error}</p>}
                    <button type="submit" className="auth-button" disabled={loading}>
                        {loading ? (
                            <span className="spinner" />
                        ) : (
                            <span className="button-content">
                                <IconLock className="button-icon" />
                                Register
                            </span>
                        )}
                    </button>
                </form>
                <div className="auth-links">
                    <button onClick={onSwitchToLogin} className="link-button">
                        Already have an account? Login
                    </button>
                </div>
            </div>
        </>
    );
};
