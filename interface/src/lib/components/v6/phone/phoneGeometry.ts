/**
 * The phone layout's column geometry (ADR-503), in one place for the CSS
 * (published as custom properties on the layout's root) and for the ribbon's
 * arithmetic, which must agree with it to the pixel.
 *
 * 64px is the iPad's own strip floor (`--track-min-w`): the narrowest a strip
 * keeps its edge ticks and its name. With an 8px gap and a 12px inset, five
 * strips and a sliver of the sixth fit a 393-point iPhone, so the row reads
 * as one that scrolls.
 */
export const PHONE_COLUMN_WIDTH = 64;
export const PHONE_COLUMN_GAP = 8;
export const PHONE_ROW_INSET = 12;
export const PHONE_COLUMN_PITCH = PHONE_COLUMN_WIDTH + PHONE_COLUMN_GAP;
/** The scene rail pinned at the Clips tab's right edge, its gap included. */
export const PHONE_RAIL_WIDTH = 64;

/** Scenes on screen at once on the Clips tab, which is all grid. */
export const PHONE_SCENE_ROWS = 4;

export const PHONE_GEOMETRY_STYLE =
	`--phone-col-w: ${PHONE_COLUMN_WIDTH}px; --phone-gap: ${PHONE_COLUMN_GAP}px; ` +
	`--phone-inset: ${PHONE_ROW_INSET}px; --phone-rail-w: ${PHONE_RAIL_WIDTH}px;`;
