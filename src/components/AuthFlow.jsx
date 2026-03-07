import { useState } from 'react';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import '../styles/Auth.css';
import { Logo } from './Logo';
import { useAuth } from './AuthProvider';

export const AuthFlow = () => {
    const [view, setView] = useState('login'); // 'login', 'register', 'forgot'
    const { keepSignedIn, setKeepSignedIn } = useAuth();

    const renderView = () => {
        switch (view) {
            case 'register':
                return <RegisterPage onSwitchToLogin={() => setView('login')} keepSignedIn={keepSignedIn} />;
            case 'forgot':
                return <ForgotPasswordPage onSwitchToLogin={() => setView('login')} />;
            case 'login':
            default:
                return (
                    <LoginPage
                        onSwitchToRegister={() => setView('register')}
                        onSwitchToForgotPassword={() => setView('forgot')}
                        keepSignedIn={keepSignedIn}
                        onToggleKeepSignedIn={setKeepSignedIn}
                    />
                );
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                <Logo className="auth-logo" />
                <h1 className="auth-title">Clipboard</h1>
                {renderView()}
            </div>
        </div>
    );
};
