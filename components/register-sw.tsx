'use client';

import { useEffect } from 'react';

export function RegisterSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Registration failing must never break the app.
    });
  }, []);
  return null;
}
