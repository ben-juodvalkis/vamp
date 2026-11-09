import { expect, it } from 'vitest';
import { reroute } from '../hooks';
import constants from '$config/constants.json';

const at = (href: string) => reroute({ url: new URL(href), fetch });

it('the setlist port shows the setlist page at its root', () => {
	expect(at(`http://x.local:${constants.setlist.port}/`)).toBe('/setlist');
});

it('every other port and path keeps its own page', () => {
	expect(at('http://x.local:8889/')).toBeUndefined();
	expect(at(`http://x.local:${constants.setlist.port}/api/ws-auth`)).toBeUndefined();
});
