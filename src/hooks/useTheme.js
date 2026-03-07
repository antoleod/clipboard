import { useLayoutEffect } from 'react';
import { applyThemeToDocument } from '../features/theme/themeSystem';

export const useTheme = (themeId, themeMode = 'dark', customThemeOverrides = {}) => {
  useLayoutEffect(() => {
    applyThemeToDocument({ themeId, themeMode, customThemeOverrides });
  }, [themeId, themeMode, customThemeOverrides]);
};
