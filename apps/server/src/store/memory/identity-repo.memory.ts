import type { AdoptResult, ClaimResult, Identity, IdentityRepo } from "../ports.js";

interface StoredIdentity extends Identity {
  readonly recoveryCodeHash: string;
}

/**
 * In-memory IdentityRepo. The session→identity link lives here (a `byToken`
 * map), mirroring what `sessions.identity_id` is in Postgres — nothing outside
 * the repo reads that column, so keeping the relationship self-contained keeps
 * the two adapters behaviourally identical under the contract tests.
 */
export function createMemoryIdentityRepo(): IdentityRepo {
  const byId = new Map<string, StoredIdentity>();
  const byToken = new Map<string, string>(); // session token → identity id
  const handlesLower = new Set<string>();

  function toPublic(identity: StoredIdentity): Identity {
    return { id: identity.id, handle: identity.handle, createdAt: identity.createdAt };
  }

  return {
    async claim(token, handle, recoveryCodeHash): Promise<ClaimResult> {
      if (byToken.has(token)) return { ok: false, reason: "already_claimed" };
      if (handlesLower.has(handle.toLowerCase())) return { ok: false, reason: "handle_taken" };

      const identity: StoredIdentity = {
        id: crypto.randomUUID(),
        handle,
        recoveryCodeHash,
        createdAt: new Date(),
      };
      byId.set(identity.id, identity);
      handlesLower.add(handle.toLowerCase());
      byToken.set(token, identity.id);
      return { ok: true, identity: toPublic(identity) };
    },

    async adopt(token, recoveryCodeHash): Promise<AdoptResult> {
      for (const identity of byId.values()) {
        if (identity.recoveryCodeHash === recoveryCodeHash) {
          byToken.set(token, identity.id);
          return { ok: true, identity: toPublic(identity) };
        }
      }
      return { ok: false, reason: "invalid_code" };
    },

    async findByToken(token) {
      const id = byToken.get(token);
      if (!id) return undefined;
      const identity = byId.get(id);
      return identity ? toPublic(identity) : undefined;
    },

    async tokensForIdentity(identityId) {
      const tokens: string[] = [];
      for (const [token, id] of byToken) {
        if (id === identityId) tokens.push(token);
      }
      return tokens;
    },
  };
}
