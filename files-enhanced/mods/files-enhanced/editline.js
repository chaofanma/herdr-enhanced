// The line under the preview bar while a file is edited. Warnings first, in their old order: changed on
// disk, unsaved edits about to go, a failed save. Otherwise, until the editor has had the keys once, a
// quiet hint: Herdr can't move the keys into the editor (EditorState has no focus()), so after Edit
// they stay on the tree, where typing does nothing (the tree ignores j / k / h / l while editing).
export const HINT = "Click the text to start typing";

export function editLine(edit) {
  if (!edit) return null;
  if (edit.conflict) return { text: "Changed on disk", warn: true };
  if (edit.warn) return { text: "Unsaved changes — press again to discard", warn: true };
  if (edit.error) return { text: String(edit.error), warn: true };
  if (!edit.focused) return { text: HINT, warn: false };
  return null;
}
