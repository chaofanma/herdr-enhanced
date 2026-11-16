// A page's flow goes on after an answer in a call of the page's own. Herdr runs a mod's code in calls
// (a click, a timer, an exec's result), each a copy's; what a call starts (an exec, a timer) is that
// copy's, and once the copy closes it never comes back. A question (a menu, a dialog, the commit menu,
// the rebase editor) is a copy of its own, so its answer settles the page's promise in the question's
// call (its click): what the flow did next was the question's and went with it when it closed, a git
// read or command that never came back. So the page takes the answer with a timer of its own, started
// in its own call when it asks.
// No Herdr imports: tested with node (test/git-enhanced/onpage.test.mjs).

/** How often (ms) a page looks whether its answer came. */
export const TICK = 25;

/** `promise`'s outcome, handed over in a call of the copy whose call runs now (`cx`: its context; call
 *  this while that call runs, when the question is asked). */
export function onPage(cx, promise) {
  let got = null, done = false;
  promise.then((value) => { got = { value }; }, (error) => { got = { error }; });
  return new Promise((resolve, reject) => {
    const timer = cx.timer.every(TICK, () => {
      if (done || !got) return;
      done = true;
      timer.cancel();
      if ("error" in got) reject(got.error); else resolve(got.value);
    });
  });
}
