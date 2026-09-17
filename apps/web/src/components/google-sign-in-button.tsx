'use client';

import { useEffect, useId, useRef, useState } from 'react';

interface CredentialResponse {
  credential: string;
}

interface GoogleAccountsId {
  initialize: (config: { client_id: string; callback: (response: CredentialResponse) => void }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load Google Sign-In.'));
      document.body.appendChild(script);
    });
  }
  return scriptPromise;
}

/**
 * Renders Google's own Sign-In button (not a custom-styled one — Google's
 * terms require using their rendered button, not a lookalike). The ID token
 * it produces is verified server-side in GoogleAuthService before anything
 * about the claimed identity is trusted.
 */
export function GoogleSignInButton({ onToken, onError }: { onToken: (idToken: string) => void; onError: (message: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const elementId = useId();

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setUnavailable(true);
      return;
    }

    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response.credential) onToken(response.credential);
            else onError('Google did not return a credential.');
          },
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          width: 360,
        });
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });

    return () => {
      cancelled = true;
    };
  }, [onToken, onError]);

  if (unavailable) return null;

  return <div ref={containerRef} id={elementId} className="flex justify-center" />;
}
