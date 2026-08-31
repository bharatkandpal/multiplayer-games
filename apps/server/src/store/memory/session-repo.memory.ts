import type { Session, SessionRepo, SetUsernameResult } from "../ports.js";

export function createMemorySessionRepo(): SessionRepo {
  const store = new Map<string, Session>();

  return {
    async upsert(token) {
      const existing = store.get(token);
      if (existing) return existing;

      const session: Session = {
        id: crypto.randomUUID(),
        token,
        username: null,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        metadata: null,
      };
      store.set(token, session);
      return session;
    },

    async findByToken(token) {
      return store.get(token);
    },

    async touch(token) {
      const session = store.get(token);
      if (session) {
        // Replace with updated lastSeenAt (readonly DTO — rebuild)
        store.set(token, { ...session, lastSeenAt: new Date() });
      }
    },

    async delete(token) {
      return store.delete(token);
    },

    async setUsername(token, username): Promise<SetUsernameResult> {
      const normalized = username.toLowerCase();
      for (const session of store.values()) {
        if (
          session.token !== token &&
          session.username !== null &&
          session.username.toLowerCase() === normalized
        ) {
          return { ok: false, reason: "taken" };
        }
      }

      const existing = store.get(token);
      const session: Session = existing
        ? { ...existing, username }
        : {
            id: crypto.randomUUID(),
            token,
            username,
            createdAt: new Date(),
            lastSeenAt: new Date(),
            metadata: null,
          };
      store.set(token, session);
      return { ok: true, session };
    },
  };
}
