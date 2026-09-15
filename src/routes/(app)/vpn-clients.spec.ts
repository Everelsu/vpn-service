import { describe, expect, it } from 'vitest';
import { clientsFor, platformOf, VPN_CLIENTS } from './vpn-clients';

const SUB = 'https://sub.example.com/sub/tg_1?token=a&b=c';

describe('platformOf', () => {
	it('files an iPhone and an iPad as ios', () => {
		expect(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
		// iPadOS reports itself as a Macintosh apart from this token, which is why it is tested.
		expect(platformOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('ios');
	});

	it('files an Android phone as android', () => {
		expect(platformOf('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
	});

	it('falls back to desktop for anything it does not know', () => {
		expect(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
		expect(platformOf('')).toBe('desktop');
	});
});

describe('clientsFor', () => {
	it('offers something on every platform', () => {
		for (const platform of ['ios', 'android', 'desktop'] as const) {
			expect(clientsFor(platform).length, platform).toBeGreaterThan(0);
		}
	});

	it('leads with Happ on both phones', () => {
		expect(clientsFor('ios')[0].id).toBe('happ');
		expect(clientsFor('android')[0].id).toBe('happ');
	});
});

describe('the deep links themselves', () => {
	it('hands the address raw to the apps that parse a path', () => {
		// Encoding it here is the bug worth pinning: these apps take everything after the verb as
		// one string, and a percent-encoded address reaches them as a url that resolves to nothing.
		expect(VPN_CLIENTS.find((c) => c.id === 'happ')!.link(SUB)).toBe(`happ://add/${SUB}`);
		expect(VPN_CLIENTS.find((c) => c.id === 'incy')!.link(SUB)).toBe(`incy://add/${SUB}`);
		expect(VPN_CLIENTS.find((c) => c.id === 'hiddify')!.link(SUB)).toBe(`hiddify://import/${SUB}`);
	});

	it('encodes the address for the app that takes a query parameter', () => {
		// Not encoding here is the mirror bug: the first & would end the parameter and truncate it.
		const link = VPN_CLIENTS.find((c) => c.id === 'v2raytun')!.link(SUB);

		expect(link).toBe(`v2raytun://import-sub?url=${encodeURIComponent(SUB)}`);
		expect(new URL(link).searchParams.get('url')).toBe(SUB);
	});

	it('gives every client a distinct id', () => {
		expect(new Set(VPN_CLIENTS.map((c) => c.id)).size).toBe(VPN_CLIENTS.length);
	});
});
