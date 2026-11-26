import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, signInWithGoogle, signOutUser, testConnection } from '../lib/firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isDbConnected: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isDbConnected: false,
  signIn: async () => {},
  signOut: async () => {},
  error: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isDbConnected, setIsDbConnected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Validate Firestore connection on boot
    testConnection().then((connected) => {
      setIsDbConnected(connected);
    });

    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        setUser(currentUser);
        setLoading(false);
      },
      (authErr) => {
        console.error('Auth state change error:', authErr);
        setError(authErr.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      // Don't show error if user simply closed the popup
      if (err?.code !== 'auth/popup-closed-by-user') {
        setError(err?.message || 'Failed to sign in with Google');
      }
    }
  };

  const handleSignOut = async () => {
    setError(null);
    try {
      await signOutUser();
    } catch (err: any) {
      setError(err?.message || 'Failed to sign out');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isDbConnected,
        signIn: handleSignIn,
        signOut: handleSignOut,
        error,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
