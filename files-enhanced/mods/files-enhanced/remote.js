// "Open with" in a space on another machine: the editors that open files over ssh need the machine's
// ssh target, which only Herdr knows (`hc machine ls`). Everything else (each item's remote form,
// which items a menu offers there, the command each runs) is openwith.js's (shared, pure).
import { hc } from "herdr";
import { hostIn } from "./openwith.js";

let HOSTS = null; // { at, promise }
export function hostOf(on) {
  if (!on) return Promise.resolve(null);
  if (!HOSTS || Date.now() - HOSTS.at > 60000) {
    HOSTS = { at: Date.now(), promise: hc(["machine", "ls", "--json"]).then(r => JSON.parse(r.stdout || "{}").machines ?? [], () => []) };
  }
  return HOSTS.promise.then(list => hostIn(list, on));
}
