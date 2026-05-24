"use client";

import { useEffect, useState } from "react";
import { User } from "firebase/auth";
import { onAuthChange, signOutUser } from "@/lib/auth";

export interface AuthState {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

/**
 * Subscribes to Firebase auth state. While `loading` is true, the user state
 * is unknown (Firebase is still restoring the persisted session). After that,
 * `user` is either the signed-in User or null.
 */
export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthChange((u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  return { user, loading, signOut: signOutUser };
}
