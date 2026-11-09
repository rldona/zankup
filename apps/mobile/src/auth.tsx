/** The session the screens use: `useApi()` gives the signed-in client. */
import type { ApiClient } from '@zankup/core';
import { createContext, useContext } from 'react';

export type AuthState = {
  api: ApiClient;
  signOut: () => Promise<void>;
  /** Stores the refresh token again, with the protection the current settings ask for. */
  rekey: () => Promise<void>;
};

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth outside a session');
  return value;
}

export const useApi = () => useAuth().api;
