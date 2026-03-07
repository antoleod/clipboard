import { useState, useEffect } from 'react';
import {
    configureAuthPersistence,
    getUserProfile,
    loadKeepSignedInPreference,
    onAuthStateChange,
    saveKeepSignedInPreference
} from '../services/authService';
import { AuthContext } from './authContext';

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [keepSignedIn, setKeepSignedIn] = useState(() => loadKeepSignedInPreference());

    useEffect(() => {
        saveKeepSignedInPreference(keepSignedIn);
        configureAuthPersistence(keepSignedIn).catch(() => {
            // Persistence setup can fail in private mode; app still works with default session behavior.
        });
    }, [keepSignedIn]);

    useEffect(() => {
        const fallbackTimer = window.setTimeout(() => {
            setLoading(false);
        }, 5000);

        const unsubscribe = onAuthStateChange(async (nextUser) => {
            setUser(nextUser);
            if (nextUser?.uid) {
                try {
                    const userProfile = await getUserProfile(nextUser.uid);
                    setProfile(userProfile);
                } catch {
                    setProfile(null);
                }
            } else {
                setProfile(null);
            }
            setLoading(false);
        });

        // Cleanup subscription on unmount
        return () => {
            window.clearTimeout(fallbackTimer);
            unsubscribe();
        };
    }, []);

    const value = { user, profile, loading, keepSignedIn, setKeepSignedIn };

    // Render children only after initial loading is complete to avoid flashes of content.
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
