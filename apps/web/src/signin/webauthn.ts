/**
 * The browser side of passkey sign-in: turn the server's JSON options into what
 * navigator.credentials.get() expects, and the resulting credential back into JSON (binary as
 * base64url), without relying on the newer parse/toJSON helpers that not every browser has.
 */

type Json = Record<string, unknown>;

export function toBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toBase64url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials?.get;
}

/** Server options (from /api/auth/passkeys/login/options) → PublicKeyCredentialRequestOptions. */
export function requestOptions(options: Json): PublicKeyCredentialRequestOptions {
  const allow =
    (options.allowCredentials as {
      id: string;
      type: 'public-key';
      transports?: AuthenticatorTransport[];
    }[]) ?? [];
  return {
    challenge: toBytes(options.challenge as string),
    rpId: options.rpId as string | undefined,
    timeout: options.timeout as number | undefined,
    userVerification: options.userVerification as UserVerificationRequirement | undefined,
    allowCredentials: allow.map((c) => ({ ...c, id: toBytes(c.id) })),
  };
}

/** The assertion from navigator.credentials.get() → the JSON the server verifies. */
export function assertionJson(credential: PublicKeyCredential): Json {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: toBase64url(response.clientDataJSON),
      authenticatorData: toBase64url(response.authenticatorData),
      signature: toBase64url(response.signature),
      userHandle: response.userHandle ? toBase64url(response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
  };
}

/** Server options (from /api/auth/passkeys/register/options) → PublicKeyCredentialCreationOptions. */
export function creationOptions(options: Json): PublicKeyCredentialCreationOptions {
  const user = options.user as { id: string; name: string; displayName: string };
  const exclude =
    (options.excludeCredentials as {
      id: string;
      type: 'public-key';
      transports?: AuthenticatorTransport[];
    }[]) ?? [];
  return {
    challenge: toBytes(options.challenge as string),
    rp: options.rp as PublicKeyCredentialRpEntity,
    user: { ...user, id: toBytes(user.id) },
    pubKeyCredParams: options.pubKeyCredParams as PublicKeyCredentialParameters[],
    timeout: options.timeout as number | undefined,
    excludeCredentials: exclude.map((c) => ({ ...c, id: toBytes(c.id) })),
    authenticatorSelection: options.authenticatorSelection as AuthenticatorSelectionCriteria | undefined,
    attestation: options.attestation as AttestationConveyancePreference | undefined,
  };
}

/** The new credential from navigator.credentials.create() → the JSON the server verifies. */
export function attestationJson(credential: PublicKeyCredential): Json {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: toBase64url(response.clientDataJSON),
      attestationObject: toBase64url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
  };
}
