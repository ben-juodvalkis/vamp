import type { Reroute } from '@sveltejs/kit';
import constants from '$config/constants.json';

/** The setlist port shows the setlist page at the root too (ADR-519). */
export const reroute: Reroute = ({ url }) => {
	if (url.pathname === '/' && url.port === String(constants.setlist.port)) return '/setlist';
};
