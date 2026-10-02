export interface Session {
  userId: string;
}

/** Who is signed in for an API request (FR-PLT-001). Kept apart so auth and the wrapper share it. */
export interface SessionProvider {
  getSession(request: Request): Promise<Session | null>;
}

/** Nobody has a session; for tests of public routes. */
export const noSessions: SessionProvider = { getSession: async () => null };
