import { useEffect } from 'react';

export const useTheme = (theme) => {
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme || 'midnight-vault');
    }, [theme]);
};
