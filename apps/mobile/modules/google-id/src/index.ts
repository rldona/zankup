/**
 * Native "Sign in with Google" (Credential Manager), with the nonce the instance gave: the ID token,
 * or null when the person dismissed the sheet.
 */
import { requireNativeModule } from 'expo';

const GoogleId = requireNativeModule<{
  signIn(webClientId: string, nonce: string): Promise<string | null>;
}>('GoogleId');

export const signInWithGoogle = (webClientId: string, nonce: string) => GoogleId.signIn(webClientId, nonce);
