/**
 * The session grid's row pitch: a measured box divided by the rows drawn in
 * it.
 *
 * The grid (`TracksPanelV6`, the phone's Clips tab) and the scene rail
 * beside it each divide their own section by `renderedRows + 1` — the scene
 * rows plus one stop row — and that matched `+ 1` is the whole argument for
 * their rows landing level (ADR-416). Hosts whose stop control sits outside
 * the measured box (the mini session, the mini rail) pass `extraRows: 0`.
 *
 * 0 while nothing is drawn or measured, which the hosts read as "publish no
 * `--session-row-h` yet".
 */
export function sessionRowPitch(heightPx: number, renderedRows: number, extraRows = 1): number {
	return renderedRows > 0 ? heightPx / (renderedRows + extraRows) : 0;
}
