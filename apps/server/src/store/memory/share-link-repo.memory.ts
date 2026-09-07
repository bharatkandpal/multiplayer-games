import type { NewShareLink, ShareLink, ShareLinkRepo } from "../ports.js";

export function createMemoryShareLinkRepo(): ShareLinkRepo {
  const store = new Map<string, ShareLink>();

  return {
    async create(input: NewShareLink) {
      const link: ShareLink = {
        id: crypto.randomUUID(),
        token: input.token,
        kind: input.kind,
        targetId: input.targetId,
        ownerToken: input.ownerToken,
        eventId: input.eventId ?? null,
        expiresAt: input.expiresAt ?? null,
        revoked: false,
        createdAt: new Date(),
      };
      store.set(input.token, link);
      return link;
    },

    async findByToken(token) {
      const link = store.get(token);
      if (!link) return undefined;
      if (link.revoked) return undefined;
      if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return undefined;
      return link;
    },

    async revoke(token, ownerToken) {
      const link = store.get(token);
      if (!link || link.ownerToken !== ownerToken) return false;
      store.set(token, { ...link, revoked: true });
      return true;
    },

    async deleteByOwner(ownerToken) {
      let count = 0;
      for (const [key, l] of store) {
        if (l.ownerToken === ownerToken) {
          store.delete(key);
          count++;
        }
      }
      return count;
    },

    async deleteExpired() {
      let count = 0;
      const now = Date.now();
      for (const [key, l] of store) {
        if (l.expiresAt && l.expiresAt.getTime() < now) {
          store.delete(key);
          count++;
        }
      }
      return count;
    },
  };
}
