'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { getClientAuth } from '@/lib/firebaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let unsubscribe;
    let cancelled = false;

    getClientAuth()
      .then(auth => {
        if (cancelled) return;
        unsubscribe = onAuthStateChanged(auth, currentUser => {
          setUser(currentUser);
          setLoading(false);
        });
      })
      .catch(error => {
        if (cancelled) return;
        setAuthError(error.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    authError,
    async getIdToken() {
      const auth = await getClientAuth();
      if (!auth.currentUser) throw new Error('尚未登入');
      return auth.currentUser.getIdToken();
    },
    async signIn() {
      const auth = await getClientAuth();
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    },
    async signOut() {
      const auth = await getClientAuth();
      await firebaseSignOut(auth);
    }
  }), [user, loading, authError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
