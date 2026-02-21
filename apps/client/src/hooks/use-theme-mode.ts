import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { THEMES, clampThemeMode, resolveThemeMode, type ThemeMode } from '../lib/theme';

const THEME_STORAGE_KEY = 'senseboard.theme.mode';

const getInitialThemeMode = (): ThemeMode => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return 'auto';
  }
  try {
    return clampThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'auto';
  }
};

const getInitialPrefersDark = (): boolean => {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

export const useThemeMode = () => {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [prefersDark, setPrefersDark] = useState(getInitialPrefersDark);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };
    setPrefersDark(media.matches);
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // localStorage may be unavailable in private mode; ignore for MVP usage.
    }
  }, [themeMode]);

  const resolvedTheme = useMemo(() => resolveThemeMode(themeMode, prefersDark), [themeMode, prefersDark]);
  const theme = useMemo(() => THEMES[resolvedTheme], [resolvedTheme]);

  return {
    themeMode,
    setThemeMode,
    resolvedTheme,
    theme,
  };
};
