import type { SelfUser } from '@onsite/types';
import { store } from '@/store/store';
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from './api';

interface LoginResponse {
  user: SelfUser;
  accessToken: string;
}

/**
 * Auth/session flow, matching apps/web/src/lib/auth-context.tsx: a reload has
 * no access token in memory, so the httpOnly refresh cookie is the only thing
 * that can restore the session.
 */
export async function refetchUser(): Promise<SelfUser> {
  const me = await api.get<SelfUser>('/users/me');
  store.user = me;
  return me;
}

export async function bootstrapSession(): Promise<void> {
  setSessionExpiredHandler(() => {
    store.user = null;
  });
  try {
    const restored = await refreshSession();
    if (restored) {
      try {
        await refetchUser();
      } catch {
        setAccessToken(null);
      }
    }
  } finally {
    store.isLoading = false;
  }
}

function adopt(result: LoginResponse): SelfUser {
  setAccessToken(result.accessToken);
  store.user = result.user;
  return result.user;
}

export async function login(email: string, password: string): Promise<SelfUser> {
  return adopt(await api.post<LoginResponse>('/auth/login', { email, password }, { skipAuthRetry: true }));
}

export async function register(email: string, password: string, displayName: string): Promise<SelfUser> {
  return adopt(
    await api.post<LoginResponse>('/auth/register', { email, password, displayName }, { skipAuthRetry: true }),
  );
}

export async function loginWithGoogle(idToken: string): Promise<SelfUser> {
  return adopt(await api.post<LoginResponse>('/auth/google', { idToken }, { skipAuthRetry: true }));
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout').catch(() => undefined);
  setAccessToken(null);
  store.user = null;
  store.unreadNotifications = 0;
}
