// The diff's own sideways scrolling (main.js, "Scroll" mode): only the code moves, by an offset
// in px, so the line numbers and the @@ rows' buttons stay put. A thin bar under the diff shows
// it (drag the thumb, press the track to page); the wheel moves it too.
// No Herdr imports: tested with node (test/git-enhanced/hscroll.test.mjs).

/** The bar's height, and its thumb's least length. */
export const BAR = 10, MIN_THUMB = 24;

/** `x` kept within [0, max]. */
export const clamp = (x, max) => Math.min(Math.max(0, x), Math.max(0, max));

/** How far the code can scroll: the widest line past the visible code width (0: all fit). */
export const maxScroll = (widest, visible) => Math.max(0, Math.ceil(widest - visible));

/** The thumb on a `track` px bar for code `visible` px wide out of `total`, scrolled `offset`:
 *  `{ start, size }` in px from the track's start, its size the visible share. */
export function thumb({ track, visible, total, offset }) {
  const size = Math.min(track, Math.max(MIN_THUMB, total > 0 ? (track * visible) / total : track));
  const max = Math.max(0, total - visible), room = Math.max(0, track - size);
  return { start: max > 0 ? (room * clamp(offset, max)) / max : 0, size };
}

/** The offset for a thumb `size` px long dragged `dx` px along a `track` px bar since the offset
 *  was `from`: the thumb follows the pointer. */
export function dragOffset({ from, dx, track, size, max }) {
  const room = track - size;
  return room > 0 ? clamp(from + (dx * max) / room, max) : clamp(from, max);
}

/** A press at `x` on the track: on the thumb null (a drag starts), else one page (the visible
 *  width) towards the press. */
export function pageOffset({ x, thumb, offset, visible, max }) {
  if (x >= thumb.start && x <= thumb.start + thumb.size) return null;
  return clamp(offset + (x < thumb.start ? -visible : visible), max);
}

/** The sideways part of a wheel event (gpui-kit's ScrollWheelEvent) in px, positive towards the
 *  line ends. GPUI's delta is the content's move, so a swipe to the left (to see further right)
 *  is a negative x. Only a mostly sideways gesture counts, so a vertical scroll doesn't drift;
 *  with Shift a vertical wheel scrolls sideways. 0 leaves the event to the list. */
export function wheelDx(e) {
  const x = e?.delta?.x ?? 0, y = e?.delta?.y ?? 0;
  if (x && Math.abs(x) > Math.abs(y)) return -x;
  if (!x && y && e?.modifiers?.shift) return -y;
  return 0;
}
