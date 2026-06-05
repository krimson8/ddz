import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  User,
  AuthError,
} from 'firebase/auth';
import { getFirebaseAuth } from './firebase';
import { destroyAllSockets } from './socket';

/**
 * Sign in with email + password. If the account doesn't exist yet, automatically
 * create it with the same password (only allowed for emails on the backend
 * allowlist — backend's WS guard rejects non-allowlisted emails after sign-in
 * so an unauthorized signup here is harmless on the client but locked out
 * from the game).
 */
export async function signInOrCreate(email: string, password: string): Promise<User> {
  const auth = getFirebaseAuth();
  try {
    console.log('[auth] attempting sign-in for', email);
    const result = await signInWithEmailAndPassword(auth, email, password);
    console.log('[auth] sign-in succeeded for', email, 'uid:', result.user.uid);
    return result.user;
  } catch (err) {
    const authErr = err as AuthError;
    console.warn('[auth] sign-in failed for', email, 'code:', authErr.code, 'message:', authErr.message);

    // Codes that mean "no such user" — try to create the account.
    if (
      authErr.code === 'auth/user-not-found' ||
      authErr.code === 'auth/invalid-credential' ||
      authErr.code === 'auth/invalid-login-credentials'
    ) {
      try {
        console.log('[auth] attempting createUser for', email);
        const result = await createUserWithEmailAndPassword(auth, email, password);
        console.log('[auth] createUser succeeded for', email, 'uid:', result.user.uid);
        return result.user;
      } catch (createErr) {
        const createAuthErr = createErr as AuthError;
        console.warn('[auth] createUser failed for', email, 'code:', createAuthErr.code, 'message:', createAuthErr.message);

        // If the account already exists, it was created without a password
        // (e.g. legacy magic-link signup). Tell the user to use a different
        // account or reset; we cannot set a password without re-auth.
        if (createAuthErr.code === 'auth/email-already-in-use') {
          throw new Error(
            '此 email 已存在但沒有設定密碼（之前用 magic link 註冊過）。請聯絡管理員重設。',
          );
        }
        throw createErr;
      }
    }
    throw err;
  }
}

/** Subscribe to auth changes. Returns unsubscribe. Use in a useEffect. */
export function onAuthChange(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(getFirebaseAuth(), cb);
}

/** Get the current ID token (auto-refreshed by Firebase). Returns null if not signed in. */
export async function getCurrentIdToken(): Promise<string | null> {
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export async function signOutUser(): Promise<void> {
  destroyAllSockets();
  await signOut(getFirebaseAuth());
}
