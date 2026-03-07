import { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthProvider';

export function useLocalStorage(baseKey, initialValue) {
    const { user } = useAuth();

    // Create a user-specific key. If no user, the key is null, and we won't interact with localStorage.
    const key = user ? `${baseKey}-${user.uid}` : null;

    const [value, setValue] = useState(() => {
        if (key === null) {
            return typeof initialValue === 'function' ? initialValue() : initialValue;
        }
        try {
            const jsonValue = window.localStorage.getItem(key);
            if (jsonValue !== null) {
                return JSON.parse(jsonValue);
            }
            return typeof initialValue === 'function' ? initialValue() : initialValue;
        } catch (error) {
            console.error(`Error reading localStorage key "${key}":`, error);
            return typeof initialValue === 'function' ? initialValue() : initialValue;
        }
    });

    // When the user logs in or out, the `key` will change.
    // This effect will re-read the value from localStorage for the new user.
    useEffect(() => {
        if (key === null) {
            // Handle user logout: you might want to reset to initialValue
            setValue(typeof initialValue === 'function' ? initialValue() : initialValue);
            return;
        }
        const jsonValue = window.localStorage.getItem(key);
        const newValue = jsonValue !== null ? JSON.parse(jsonValue) : (typeof initialValue === 'function' ? initialValue() : initialValue);
        setValue(newValue);
    }, [key]);

    useEffect(() => {
        // Only write to localStorage if there is a valid key (a logged-in user).
        if (key === null) {
            return;
        }
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.error(`Error setting localStorage key "${key}":`, error);
        }
    }, [key, value]);

    return [value, setValue];
}