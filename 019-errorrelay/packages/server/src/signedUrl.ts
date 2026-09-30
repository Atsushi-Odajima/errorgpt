import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignedRef {
  tenantId: string;
  blobId: string;
  exp: number; // unix seconds
  sig: string;
}

export function signBlobUrl(secret: string, tenantId: string, blobId: string, ttlSeconds: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const sig = createHmac("sha256", secret).update(`${tenantId}|${blobId}|${exp}`).digest("base64url");
  return `/api/blobs/${encodeURIComponent(blobId)}?exp=${exp}&sig=${sig}&t=${encodeURIComponent(tenantId)}`;
}

export function verifyBlobSignature(secret: string, tenantId: string, blobId: string, exp: number, sig: string, now = Date.now()): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const expect = createHmac("sha256", secret).update(`${tenantId}|${blobId}|${exp}`).digest("base64url");
  const a = Buffer.from(expect);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
