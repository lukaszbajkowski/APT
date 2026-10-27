// Pomocnicze funkcje WebAuthn: opcje z serwera (JSON, base64url) <-> obiekty przeglądarki.

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

function fromB64(s: string): ArrayBuffer {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out.buffer;
}

function toB64(buf: ArrayBuffer | null): string | null {
  if (!buf) return null;
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface Descriptor {
  id: string;
  type: "public-key";
  transports?: AuthenticatorTransport[];
}

export async function createPasskey(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const o = options as unknown as {
    challenge: string;
    user: { id: string; name: string; displayName: string };
    excludeCredentials?: Descriptor[];
  } & Record<string, unknown>;
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...(o as object),
      challenge: fromB64(o.challenge),
      user: { ...o.user, id: fromB64(o.user.id) },
      excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({ ...c, id: fromB64(c.id) })),
    } as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Anulowano.");
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: toB64(cred.rawId),
    type: cred.type,
    response: { clientDataJSON: toB64(r.clientDataJSON), attestationObject: toB64(r.attestationObject) },
  };
}

export async function getPasskey(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const o = options as unknown as { challenge: string; allowCredentials?: Descriptor[] } & Record<string, unknown>;
  const cred = (await navigator.credentials.get({
    publicKey: {
      ...(o as object),
      challenge: fromB64(o.challenge),
      allowCredentials: (o.allowCredentials ?? []).map((c) => ({ ...c, id: fromB64(c.id) })),
    } as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Anulowano.");
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: toB64(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: toB64(r.clientDataJSON),
      authenticatorData: toB64(r.authenticatorData),
      signature: toB64(r.signature),
      userHandle: toB64(r.userHandle),
    },
  };
}

/** Czytelny komunikat, gdy użytkownik anulował okno systemowe albo urządzenie nie obsługuje kluczy. */
export function passkeyErrorText(err: unknown): string | null {
  if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")) {
    return "Anulowano albo upłynął czas. Spróbuj jeszcze raz.";
  }
  return null;
}
