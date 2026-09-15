import { fail } from '@sveltejs/kit';
import type { CheckoutError } from '$lib/server/billing';
import { access, checkout, checkoutInput, plans, promoLimiter, users } from '$lib/server/container';
import { AppError, toHttp } from '$lib/server/errors';
import { log } from '$lib/server/log';
import { PROMO_MESSAGES, promoRateLimitMessage } from './promo-copy';
import { platformOf } from './vpn-clients';
import type { Actions, PageServerLoad } from './$types';

/**
 * Reference slice: load returns DTOs from the domain, never DB rows (CLAUDE.md 1.4).
 *
 * Plans are public, so this survives locals.user === null and renders the same list to a signed-out
 * shell (tech.md 9). Exactly one render lives in that state before the cookie lands.
 */
export const load: PageServerLoad = async ({ locals, depends, request }) => {
	/**
	 * The dependency A7 polls on. The client calls invalidate('app:subscription') every few seconds
	 * while it waits for a payment to land, and this is what makes that call re-run this load
	 * rather than do nothing at all.
	 */
	depends('app:subscription');

	const view = locals.user
		? access.forUser(locals.user.id)
		: {
				subscription: null,
				plan: null,
				trafficUsedBytes: Promise.resolve(null),
				latestOrder: null,
				awaitingKey: false
			};

	/**
	 * Read here rather than from `navigator` in the component: the connect block picks which apps to
	 * offer by platform, and deciding that after hydration would render the wrong buttons first and
	 * swap them under the reader's thumb. The header is a hint, not a fact — an unrecognised one
	 * falls back to the desktop list, which is the shortest and never the wrong thing to show.
	 */
	const platform = platformOf(request.headers.get('user-agent') ?? '');

	return { plans: plans.listActive(), platform, ...view };
};

/** What the page gets back from a refused checkout. A success carries the link instead. */
interface CheckoutFailure {
	message: string;
}

/** Same shape, its own name: the sheet renders a refused quote next to the plans, not as a banner. */
interface QuoteFailure {
	message: string;
}

/** Both money actions answer an anonymous caller with the same sentence. */
const PLEASE_SIGN_IN = 'Откройте приложение из Telegram, чтобы оплатить.';

/**
 * Every refusal the domain can hand back, and what each one is worth in HTTP and in Russian.
 *
 * Exhaustive by type: `CheckoutError` gains an arm and this table stops compiling, so a new way to
 * refuse a purchase cannot ship as a generic sentence nobody can act on. The promo lines come from
 * the shared copy, because Профиль answers the same five refusals about the same five codes.
 */
const CHECKOUT_RULES: Record<CheckoutError, { status: number; message: string }> = {
	// A stale card: the plan was hidden or archived while this page sat open.
	plan_unavailable: { status: 409, message: 'Этот тариф больше не продаётся. Выберите другой.' },
	promo_not_found: { status: 400, message: PROMO_MESSAGES.not_found },
	promo_inactive: { status: 400, message: PROMO_MESSAGES.inactive },
	promo_expired: { status: 400, message: PROMO_MESSAGES.expired },
	promo_exhausted: { status: 400, message: PROMO_MESSAGES.exhausted },
	promo_already_used: { status: 400, message: PROMO_MESSAGES.already_used }
};

const isPromoRefusal = (error: CheckoutError) => error.startsWith('promo_');

/**
 * Which refusals count against the attempt budget.
 *
 * Everything a stranger could learn by guessing does: `not_found`, `inactive`, `expired` and
 * `exhausted` each answer "does this code exist". `already_used` cannot be elicited by anybody but
 * the person who already holds the code, so charging for it only punishes a customer — one who
 * abandons a payment page gets it back on every retry for half an hour, and five of those would lock
 * them out of checking any code at all.
 */
const isGuess = (error: CheckoutError) => isPromoRefusal(error) && error !== 'promo_already_used';

export const actions = {
	/**
	 * The price the buy sheet shows while somebody types a code. Same plan, same code, same
	 * calculator as `createCheckout` — it calls one method on the same service, so the number here
	 * cannot disagree with the order that follows it.
	 *
	 * It spends the promo budget exactly like a purchase does. A preview that validated codes for
	 * free would be an unlimited oracle for guessing them, and the five-attempts rule in CLAUDE.md 2
	 * would hold on one action while the other stood wide open.
	 */
	quotePrice: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: PLEASE_SIGN_IN } satisfies QuoteFailure);

		const parsed = checkoutInput.parse(Object.fromEntries(await request.formData()));
		if (!parsed.ok) return fail(400, { message: parsed.error } satisfies QuoteFailure);

		const user = users.findById(locals.user.id);
		if (!user) return fail(401, { message: PLEASE_SIGN_IN } satisfies QuoteFailure);

		const promoCode = parsed.value.promoCode;
		const limiterKey = String(locals.user.id);

		if (promoCode) {
			const budget = promoLimiter.peek(limiterKey);
			if (!budget.allowed) {
				return fail(429, {
					message: promoRateLimitMessage(budget.retryAfterSec)
				} satisfies QuoteFailure);
			}
		}

		const priced = checkout.previewPrice(user, parsed.value.planId, promoCode);

		if (!priced.ok) {
			const rule = CHECKOUT_RULES[priced.error];

			if (isPromoRefusal(priced.error)) {
				if (isGuess(priced.error)) promoLimiter.consume(limiterKey);
				// The reason, never the code: a working promo code is a bearer secret (CLAUDE.md 2).
				log.info('quote_promo_refused', { requestId: locals.requestId, reason: priced.error });
			}

			return fail(rule.status, { message: rule.message } satisfies QuoteFailure);
		}

		return { quote: priced.value, promoCode: promoCode ?? null };
	},

	/**
	 * tech.md 10, steps 1-5. The form posts what tech.md 10 step 1 says it posts — a plan id and,
	 * optionally, the name of a promo code — and the server prices the order from the rows those two
	 * name. There is deliberately nowhere in this action to say what anything costs (CLAUDE.md 2).
	 */
	createCheckout: async ({ request, locals }) => {
		/**
		 * The guard in hooks.server.ts already 401s a POST without a session. This is the second
		 * check tech.md 9 asks for rather than a copy of the first: an order belongs to a person,
		 * and that person comes off the session, never off the form.
		 */
		if (!locals.user) return fail(401, { message: PLEASE_SIGN_IN } satisfies CheckoutFailure);

		const parsed = checkoutInput.parse(Object.fromEntries(await request.formData()));
		if (!parsed.ok) return fail(400, { message: parsed.error } satisfies CheckoutFailure);

		// The full row: the checkout needs stripeCustomerId, which SessionUser does not carry.
		const user = users.findById(locals.user.id);
		if (!user) return fail(401, { message: PLEASE_SIGN_IN } satisfies CheckoutFailure);

		const promoCode = parsed.value.promoCode;
		const limiterKey = String(locals.user.id);

		/**
		 * CLAUDE.md 2: five promo attempts per ten minutes per person. Peeked here and spent below,
		 * only on a refusal that tells a guesser something — a code that works, or one they have
		 * already used themselves, teaches them nothing they did not already know. A purchase with no
		 * code never touches the budget at all.
		 *
		 * Read once: two calls straddling the window reset would print the wait from a fresh budget
		 * next to a refusal issued against the spent one.
		 */
		if (promoCode) {
			const budget = promoLimiter.peek(limiterKey);
			if (!budget.allowed) {
				return fail(429, {
					message: promoRateLimitMessage(budget.retryAfterSec)
				} satisfies CheckoutFailure);
			}
		}

		try {
			const started = await checkout.start(user, parsed.value.planId, promoCode);

			if (!started.ok) {
				const rule = CHECKOUT_RULES[started.error];

				if (isPromoRefusal(started.error)) {
					if (isGuess(started.error)) promoLimiter.consume(limiterKey);
					// The reason, never the code: a working promo code is a bearer secret (CLAUDE.md 2).
					log.info('checkout_promo_refused', {
						requestId: locals.requestId,
						reason: started.error
					});
				}

				return fail(rule.status, { message: rule.message } satisfies CheckoutFailure);
			}

			return { url: started.value.url, orderId: started.value.orderId };
		} catch (err) {
			const { status, body } = toHttp(err, locals.requestId);

			if (err instanceof AppError) {
				log.warn('checkout_refused', { requestId: locals.requestId, code: err.code, status });
			} else {
				log.error('checkout_failed', { requestId: locals.requestId, error: err });
			}

			// The provider's own words never reach the person: toHttp has already replaced them.
			return fail(status, { message: body.message } satisfies CheckoutFailure);
		}
	}
} satisfies Actions;
