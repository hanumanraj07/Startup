'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { SelfUser } from '@onsite/types';
import { api, bootstrapSession, setAccessToken, setSessionExpiredHandler } from './api-client';

interface LoginResponse {
  user: SelfUser;
  accessToken: string;
}

interface AuthContextValue {
  user: SelfUser | null;
  /** True until the initial silent-refresh-from-cookie attempt finishes. */
  isLoading: boolean;
  login: (email: string, password: string) => Promise<SelfUser>;
  register: (email: string, password: string, displayName: string) => Promise<SelfUser>;
  loginWithGoogle: (idToken: string) => Promise<SelfUser>;
  logout: () => Promise<void>;
  refetchUser: () => Promise<SelfUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SelfUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    const me = await api.get<SelfUser>('/users/me');
    setUser(me);
    return me;
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    // A page load or reload has no access token in memory yet — the httpOnly
    // refresh cookie is the only thing that can restore the session.
    (async () => {
      const restored = await bootstrapSession();
      if (restored) {
        try {
          await fetchMe();
        } catch {
          setAccessToken(null);
        }
      }
      setIsLoading(false);
    })();
    return () => setSessionExpiredHandler(null);
  }, [fetchMe]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<LoginResponse>('/auth/login', { email, password }, { skipAuthRetry: true });
    setAccessToken(result.accessToken);
    setUser(result.user);
    return result.user;
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    const result = await api.post<LoginResponse>(
      '/auth/register',
      { email, password, displayName },
      { skipAuthRetry: true },
    );
    setAccessToken(result.accessToken);
    setUser(result.user);
    return result.user;
  }, []);

  const loginWithGoogle = useCallback(async (idToken: string) => {
    const result = await api.post<LoginResponse>('/auth/google', { idToken }, { skipAuthRetry: true });
    setAccessToken(result.accessToken);
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, login, register, loginWithGoogle, logout, refetchUser: fetchMe }),
    [user, isLoading, login, register, loginWithGoogle, logout, fetchMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider.');
  return ctx;
}
