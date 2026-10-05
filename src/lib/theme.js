import { useCallback, useEffect, useState } from 'react';

// Light / dark theme. The choice is saved on this device; until someone picks one,
// the app follows the device's own setting. index.html applies it before the first
// paint so there's no flash. Buyer-facing public pages always stay light.
const KEY = 'ktc-theme';
const EVENT = 'ktc-theme-change';
const THEME_COLOR = { light: '#1A4D2E', dark: '#0E1411' };

function storedTheme() {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolvedTheme() {
  return storedTheme() || systemTheme();
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme] || THEME_COLOR.light);
}

export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || resolvedTheme());

  useEffect(() => {
    const onChange = (event) => setTheme(event.detail);
    window.addEventListener(EVENT, onChange);
    // Follow the device setting while no choice has been saved.
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystem = () => {
      if (storedTheme()) return;
      const next = systemTheme();
      applyTheme(next);
      setTheme(next);
    };
    media?.addEventListener?.('change', onSystem);
    return () => {
      window.removeEventListener(EVENT, onChange);
      media?.removeEventListener?.('change', onSystem);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = (document.documentElement.getAttribute('data-theme') || theme) === 'dark' ? 'light' : 'dark';
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* private mode: still switch for this visit */
    }
    applyTheme(next);
    window.dispatchEvent(new window.CustomEvent(EVENT, { detail: next }));
  }, [theme]);

  return { theme, toggle };
}
