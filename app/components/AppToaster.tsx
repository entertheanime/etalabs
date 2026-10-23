'use client';

import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { useTheme } from '../context/ThemeContext';

export default function AppToaster() {
  const [ready, setReady] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) return null;

  const night = theme === 'dark';

  return (
    <Toaster
      position="top-center"
      containerStyle={{ top: 12 }}
      toastOptions={{
        duration: 4000,
        style: {
          background: night ? 'rgba(28,28,30,0.78)' : 'rgba(255,255,255,0.86)',
          border: night ? '0.5px solid rgba(255,255,255,0.16)' : '0.5px solid rgba(0,0,0,0.08)',
          color: night ? '#f5f5f7' : '#1d1d1f',
          backdropFilter: 'blur(50px) saturate(190%)',
          WebkitBackdropFilter: 'blur(50px) saturate(190%)',
          borderRadius: '22px',
          padding: '12px 14px',
          maxWidth: 'min(361px, calc(100vw - 28px))',
          width: 'min(361px, calc(100vw - 28px))',
          textAlign: 'left' as const,
          lineHeight: 1.35,
          whiteSpace: 'normal' as const,
          // Keeps the status icon centred when a toast wraps onto two lines.
          alignItems: 'center',
          fontFamily: 'var(--font-sf-pro)',
          fontSize: '13px',
          fontWeight: 500,
          letterSpacing: '-0.016em',
          boxShadow: night
            ? '0 12px 40px rgba(0,0,0,0.38), inset 0 0.5px 0 rgba(255,255,255,0.2)'
            : '0 12px 40px rgba(0,0,0,0.12), inset 0 0.5px 0 rgba(255,255,255,0.8)',
        },
        success: {
          iconTheme: {
            primary: '#30d158',
            secondary: night ? '#1c1c1e' : '#f5f5f7',
          },
        },
        error: {
          iconTheme: {
            primary: '#ff453a',
            secondary: night ? '#1c1c1e' : '#f5f5f7',
          },
        },
        loading: {
          iconTheme: {
            primary: '#0a84ff',
            secondary: night ? '#1c1c1e' : '#f5f5f7',
          },
        },
      }}
    />
  );
}
