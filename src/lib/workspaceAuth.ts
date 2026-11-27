import { GoogleAuthProvider, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from './firebase';

export const SCOPES = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/tasks.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

let scopesConfigured = false;
function ensureProviderScopes() {
  if (scopesConfigured) return;
  for (const scope of SCOPES) {
    googleProvider.addScope(scope);
  }
  scopesConfigured = true;
}
ensureProviderScopes();

// Strictly in-memory OAuth access token cache (never localStorage or sessionStorage).
let cachedAccessToken: string | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

function notifyTokenListeners() {
  for (const listener of tokenListeners) {
    listener(cachedAccessToken);
  }
}

export function getWorkspaceAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearWorkspaceAccessToken(): void {
  cachedAccessToken = null;
  notifyTokenListeners();
}

export function subscribeWorkspaceAccessToken(
  listener: (token: string | null) => void
): () => void {
  tokenListeners.add(listener);
  listener(cachedAccessToken);
  return () => {
    tokenListeners.delete(listener);
  };
}

export async function signInWithGoogleWorkspace(options?: {
  forceConsent?: boolean;
}): Promise<{ user: User; accessToken: string | null }> {
  ensureProviderScopes();
  if (options?.forceConsent) {
    googleProvider.setCustomParameters({
      prompt: 'consent select_account',
      include_granted_scopes: 'true',
    });
  } else {
    googleProvider.setCustomParameters({
      prompt: 'select_account',
      include_granted_scopes: 'true',
    });
  }

  const result = await signInWithPopup(auth, googleProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const token = credential?.accessToken ?? null;
  if (token) {
    cachedAccessToken = token;
    notifyTokenListeners();
  }
  return { user: result.user, accessToken: token };
}

export async function signOutGoogleWorkspace(): Promise<void> {
  clearWorkspaceAccessToken();
  await signOut(auth);
}
