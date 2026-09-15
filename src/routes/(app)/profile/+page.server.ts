import { config } from '$lib/server/config';
import { access } from '$lib/server/container';
import type { PageServerLoad } from './$types';

/**
 * A9 — what has been used and what has been paid. A12 — the purchase history.
 *
 * The plan, the link and the QR moved to Главная, and the promo check moved into the buy sheet
 * beside the prices it changes; this screen reads rather than acts.
 *
 * `subscriptionUrl` is the key itself: whoever holds it holds the VPN. tech.md 7 says it goes to
 * the owner and nobody else, and the only thing standing behind that promise is this line — the
 * subscription is read for `locals.user`, never for an id off the URL or the form.
 */
export const load: PageServerLoad = async ({ locals, depends }) => {
	// A7 polls this key while it waits for a payment to turn into a key (see (app)/+page.server.ts).
	depends('app:subscription');

	// One currency for the whole base (tech.md 5). The promo block shows it; it never submits it.
	const currency = config.PRICE_CURRENCY;

	/**
	 * The shell renders before the cookie lands (tech.md 9), so a load with no user is normal and
	 * answers empty. invalidateAll() after the exchange runs it again with the person in place.
	 */
	if (!locals.user) {
		return {
			subscription: null,
			plan: null,
			trafficUsedBytes: Promise.resolve(null),
			latestOrder: null,
			awaitingKey: false,
			history: [],
			currency
		};
	}

	return {
		...access.forUser(locals.user.id),
		history: access.historyFor(locals.user.id),
		currency
	};
};
