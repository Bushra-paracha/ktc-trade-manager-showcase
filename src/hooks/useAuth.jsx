import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) fetchProfile(session.user.id);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    setProfile(data || null);
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message };
  }

  async function signOut() {
    // Forget data saved for offline use on this device.
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-data' });
    await supabase.auth.signOut();
  }

  const role = profile?.role || null;
  const isAdmin = role === 'Admin / Owner';
  const isDirector = role === 'Director';
  // Director sees everything and updates order stages / follow-ups from Today,
  // but doesn't edit or delete records (enforced in the database too).
  const canEdit = ['Admin / Owner', 'Sales Executive', 'Export Manager'].includes(role);
  const isAdminOrDirector = isAdmin || isDirector;

  const value = {
    session,
    user: session?.user || null,
    profile,
    loading: session === undefined,
    isAdmin,
    isDirector,
    canEdit,
    isAdminOrDirector,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
