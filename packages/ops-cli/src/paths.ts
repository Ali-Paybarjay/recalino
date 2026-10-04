import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** pnpm --filter changes cwd to the package; documented relative paths start at this workspace. */
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const workspacePath = (path: string): string => resolve(workspaceRoot, path);
