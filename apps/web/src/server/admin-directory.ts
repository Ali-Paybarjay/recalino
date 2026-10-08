import "server-only";
import { createAuthAdmin } from "./auth/supabase";

/** Only called behind the owner guard. Never expose Auth metadata or credentials to views. */
export function adminDirectory() {
  const pending = new Map<
    string,
    Promise<{ email: string | null; name: string | null; language: "en" | "fa" }>
  >();
  return {
    getUser(id: string) {
      let result = pending.get(id);
      if (!result) {
        result = createAuthAdmin()
          .getUserById(id)
          .then(({ data, error }) => {
            if (error) throw new Error("Admin directory unavailable");
            const metadata = data.user?.user_metadata;
            const raw = metadata?.full_name ?? metadata?.name ?? metadata?.first_name;
            return {
              email: data.user?.email ?? null,
              name: typeof raw === "string" ? raw.slice(0, 120) : null,
              language: (metadata?.language === "fa" ? "fa" : "en") as "en" | "fa",
            };
          });
        pending.set(id, result);
      }
      return result;
    },
  };
}
