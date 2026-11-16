// The settings window's pages as Files Enhanced draws them, its own first (test/shared/settings-own-first.mjs).
import { stubs, load } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
import { settingsOrderTests } from "../shared/settings-own-first.mjs";

await settingsOrderTests({ name: NAME, stubs, load });
