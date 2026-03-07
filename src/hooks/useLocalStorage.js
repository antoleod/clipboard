import { useCallback, useMemo, useState } from 'react';
import { useAuth } from './useAuth';

function resolveInitialValue(initialValue) {
    return typeof initialValue === 'function' ? initialValue() : initialValue;
}

function readLocalStorageValue(key, initialValue) {
    const fallback = resolveInitialValue(initialValue);
    if (key === null) return fallback;

    try {
        const jsonValue = window.localStorage.getItem(key);
        return jsonValue !== null ? JSON.parse(jsonValue) : fallback;
    } catch (error) {
        console.error(`Error reading localStorage key "${key}":`, error);
        return fallback;
    }
}

export function useLocalStorage(baseKey, initialValue) {
    const { user } = useAuth();
    const key = user ? `${baseKey}-${user.uid}` : null;

    const [state, setState] = useState(() => ({
        key,
        value: readLocalStorageValue(key, initialValue)
    }));

    const value = useMemo(
        () => (state.key === key ? state.value : readLocalStorageValue(key, initialValue)),
        [state.key, state.value, key, initialValue]
    );

    const setValue = useCallback(
        (nextValue) => {
            setState((prev) => {
                const currentValue = prev.key === key ? prev.value : readLocalStorageValue(key, initialValue);
                const resolvedNext = typeof nextValue === 'function' ? nextValue(currentValue) : nextValue;

                if (key !== null) {
                    try {
                        window.localStorage.setItem(key, JSON.stringify(resolvedNext));
                    } catch (error) {
                        console.error(`Error setting localStorage key "${key}":`, error);
                    }
                }

                return { key, value: resolvedNext };
            });
        },
        [key, initialValue]
    );

    return [value, setValue];
}
