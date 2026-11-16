// The settings window's drop-downs as Git Enhanced draws them (test/shared/settings-dropdown.mjs).
import { stubs, load } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
import { settingsDropdownTests } from "../shared/settings-dropdown.mjs";

await settingsDropdownTests({ name: NAME, stubs, load });
