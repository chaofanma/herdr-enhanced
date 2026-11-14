// Loaded first by every test that can start a program (itself or through a helper: tmp.mjs,
// render/load.mjs, render/stubs.mjs). The tests run git in folders of their own, but git's variables
// from where the tests were started (GIT_DIR, and GIT_WORK_TREE or GIT_INDEX_FILE, in a hook or under
// `git rebase --exec`) would send every one of those calls to that repository, whatever folder it runs
// in: its config rewritten, refs and commits added to it. They leave this process's environment, so
// the programs it starts don't get them either. GIT_EXEC_PATH stays: it only says where git's own
// programs are. no-outer-git.test.mjs checks that every test file that can start a program loads this.
for (const name of Object.keys(process.env)) if (name.startsWith("GIT_") && name !== "GIT_EXEC_PATH") delete process.env[name];
