/**
 * The apps a subscription can be handed to, and how each one wants to be handed it.
 *
 * Pure data and two pure functions: no DOM, no navigator, no fetch. The caller passes the user agent
 * in, which is what makes the platform split testable at all — reading `navigator` in here would put
 * the only interesting branch behind a global the tests cannot set.
 */

export type ClientPlatform = 'ios' | 'android' | 'desktop';

export interface VpnClient {
	id: string;
	label: string;
	/** Builds the deep link that adds `subscriptionUrl` to this app. */
	link: (subscriptionUrl: string) => string;
	platforms: readonly ClientPlatform[];
}

/**
 * Two shapes of link, and the difference is not cosmetic. `scheme://verb/<url>` takes the address
 * raw — the apps that use it parse everything after the verb as one string, and percent-encoding it
 * gives them a subscription url that 404s. `?url=` is a query parameter and must be encoded, or the
 * first `&` in the address silently truncates it.
 */
const path = (prefix: string) => (url: string) => `${prefix}${url}`;
const query = (prefix: string) => (url: string) => `${prefix}${encodeURIComponent(url)}`;

export const VPN_CLIENTS: readonly VpnClient[] = [
	/**
	 * Happ is the app the setup screen walks people through, so it leads on both phones.
	 *
	 * Its scheme is the one here that is NOT published: happ.su documents that adding by deep link
	 * works and documents `happ://routing/add/…` and `happ://crypto…`, but never spells the plain
	 * subscription verb. `add` is inferred from INCY, whose own docs call `incy://crypt1/` the
	 * obfuscated variant of `incy://add/` and which mirrors Happ's routing verbs exactly. Check it on
	 * a real device before launch: a deep link that resolves to nothing opens nothing, silently, and
	 * reads to the person as a broken service rather than as a missing app.
	 */
	{ id: 'happ', label: 'Happ', link: path('happ://add/'), platforms: ['ios', 'android'] },

	/**
	 * incy.gitbook.io: `incy://add/{url}` adds a subscription directly.
	 *
	 * iOS only, though it runs on both: three buttons fit one row on a phone and four do not, and on
	 * Android the second slot is better spent on v2RayTun, which is what that audience already has.
	 */
	{ id: 'incy', label: 'INCY', link: path('incy://add/'), platforms: ['ios'] },

	// docs.v2raytun.com: `v2raytun://import-sub?url=…`, a query parameter, so it is encoded.
	{
		id: 'v2raytun',
		label: 'v2RayTun',
		link: query('v2raytun://import-sub?url='),
		platforms: ['android']
	},

	// hiddify/hiddify-app wiki: `hiddify://import/{sublink}`.
	{
		id: 'hiddify',
		label: 'Hiddify',
		link: path('hiddify://import/'),
		platforms: ['android', 'desktop']
	}
];

/**
 * Which phone is this. iOS before Android because iPadOS says "Macintosh" and Android devices never
 * say "iPhone" — testing the other way round files an iPad as a desktop.
 *
 * Anything unrecognised is a desktop, and that is the safe default: the desktop list is the shortest
 * and the link itself is always on the screen above these buttons.
 */
export function platformOf(userAgent: string): ClientPlatform {
	if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
	if (/Android/i.test(userAgent)) return 'android';
	return 'desktop';
}

/** The apps worth offering on this platform, in the order they are offered. */
export function clientsFor(platform: ClientPlatform): VpnClient[] {
	return VPN_CLIENTS.filter((client) => client.platforms.includes(platform));
}
