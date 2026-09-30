import { timingSafeEqual, createHash } from "node:crypto";

export interface Principal {
  tenantId: string;
  /** Display identity shown in send previews (never an email unless the user configured one). */
  identity: string;
  scopes: ("read" | "write" | "submit")[];
}

export interface AuthConfig {
  /** token → principal. Tokens are compared in constant time via hash. */
  tokens: Map<string, Principal>;
}

/** Parse "token:tenant[:identity],token2:tenant2" from env. */
export function parseTokenEnv(v: string | undefined): AuthConfig {
  const tokens = new Map<string, Principal>();
  for (const part of (v ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [token, tenantId, identity] = part.split(":");
    if (token && tenantId) tokens.set(hashToken(token), { tenantId, identity: identity ?? "none", scopes: ["read", "write", "submit"] });
  }
  return { tokens };
}

export function hashToken(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

export function authenticate(cfg: AuthConfig, authorization: string | undefined): Principal | null {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!m) return null;
  const h = Buffer.from(hashToken(m[1]!));
  for (const [k, p] of cfg.tokens) {
    const kb = Buffer.from(k);
    if (kb.length === h.length && timingSafeEqual(kb, h)) return p;
  }
  return null;
}
