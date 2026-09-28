/**
 * clipEditorStore — clip-view-mirror M1.
 *
 * Manual device↔clip-editor toggle (plan decision 8). The clip central
 * area can show either the existing button rail (`ClipCentralView`) or
 * the larger interactive canvas (`ClipEditorView`). Focusing a clip
 * never auto-switches between them — the user taps the toggle.
 *
 * This is a single boolean on purpose: the toggle is the entire
 * activation model for v1. Auto-default-on-focus was rejected (decision
 * 8) as a stateful guess that surprises mid-performance.
 */

let _editorActive = $state<boolean>(false);

export const clipEditorStore = {
	get active(): boolean {
		return _editorActive;
	},
	toggle(): void {
		_editorActive = !_editorActive;
	},
	set(active: boolean): void {
		_editorActive = active;
	}
};
