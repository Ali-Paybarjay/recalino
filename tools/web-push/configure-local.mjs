// Local-only VAPID provisioning. Never print either key or copy credentials to cloud settings.
import { appendFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const webPush = requireWeb("web-push");
const files = [
  new URL("../../.env.local", import.meta.url),
  new URL("../../apps/web/.env.local", import.meta.url),
];
const names = [
  "RECALINO_WEB_PUSH_PUBLIC_KEY",
  "RECALINO_WEB_PUSH_PRIVATE_KEY",
  "RECALINO_WEB_PUSH_SUBJECT",
];
function readFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}
function values(text) {
  return Object.fromEntries(
    text.split(/\r?\n/).flatMap((line) => {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
    }),
  );
}
const contents = files.map(readFile);
const environments = contents.map(values);
const existingPair = environments.find(
  (environment) => environment[names[0]] && environment[names[1]],
);
if (environments.some((environment) => !!environment[names[0]] !== !!environment[names[1]])) {
  throw new Error(
    "An incomplete local VAPID pair exists; resolve it without overwriting its keys.",
  );
}
if (
  existingPair &&
  environments.some(
    (environment) =>
      environment[names[0]] &&
      (environment[names[0]] !== existingPair[names[0]] ||
        environment[names[1]] !== existingPair[names[1]]),
  )
) {
  throw new Error("Conflicting local VAPID pairs exist; select one before provisioning.");
}
const keys = existingPair
  ? { publicKey: existingPair[names[0]], privateKey: existingPair[names[1]] }
  : webPush.generateVAPIDKeys();
const appOrigin = environments
  .map((environment) => environment.RECALINO_PUBLIC_APP_URL)
  .find((value) => value?.startsWith("https://"));
const subject =
  environments.map((environment) => environment[names[2]]).find(Boolean) ??
  appOrigin ??
  "https://recalino.invalid/development";
const desired = { [names[0]]: keys.publicKey, [names[1]]: keys.privateKey, [names[2]]: subject };
for (let index = 0; index < files.length; index++) {
  const additions = names.filter((name) => !environments[index][name]);
  if (!additions.length) continue;
  appendFileSync(
    fileURLToPath(files[index]),
    `${contents[index].endsWith("\n") || !contents[index] ? "" : "\n"}\n# Local Web Push (generated once; private key stays server-side)\n${additions.map((name) => `${name}=${desired[name]}`).join("\n")}\n`,
    "utf8",
  );
}
console.log(
  "Local Web Push configuration is ready in .env.local and apps/web/.env.local. No keys printed.",
);
