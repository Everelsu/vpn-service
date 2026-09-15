import type { PlanSnapshot, Result } from '$lib/types';
import type { UserService } from '../auth/user-service';
import type { Logger } from '../log';
import type { PlanService } from '../plans';
import type { JobQueue } from '../jobs/queue';
import type { OrderService } from './order-service';

/**
 * Both refusals are facts about our own rows, and both are things the admin can act on, so they are
 * Results rather than throws (CLAUDE.md 3).
 */
export type GrantError = 'user_not_found' | 'plan_unavailable';

export interface GrantResult {
	orderId: number;
	userId: number;
	planName: string;
}

/**
 * Access granted by hand: the owner takes the money outside the app and hands the person a term.
 *
 * It deliberately goes through an order rather than writing `subscriptions` directly. Every other
 * part of the system is built on paid orders — the end date is folded from them
 * (subscriptions/expiry.ts), the history lists them, the provision job reads one, the expiry notices
 * follow from the subscription it writes. A grant that skipped the order would need a second copy of
 * all of that, and the two would disagree the first time either changed.
 *
 * So the only thing that makes this different from a purchase is who decided the money arrived.
 */
export class ManualGrantService {
	constructor(
		private readonly orders: OrderService,
		private readonly plans: PlanService,
		private readonly users: UserService,
		private readonly jobs: JobQueue,
		private readonly log: Logger
	) {}

	/**
	 * `telegramId`, not our own user id: it is the number the owner can actually see — it is on the
	 * person's profile screen, and it is what they will send when they ask to be connected.
	 */
	grant(telegramId: number, planId: number): Result<GrantResult, GrantError> {
		/**
		 * The person has to have opened the app at least once. There is no way around that and it is
		 * not worth inventing one: `orders.userId` references a real row, and a user invented from a
		 * bare id would carry no name, no language and no proof the id belongs to anybody.
		 */
		const user = this.users.findByTelegramId(telegramId);
		if (!user) return { ok: false, error: 'user_not_found' };

		const plan = this.plans.findSellable(planId);
		if (!plan) return { ok: false, error: 'plan_unavailable' };

		const snapshot: PlanSnapshot = {
			name: plan.name,
			durationDays: plan.durationDays,
			priceMinor: plan.priceMinor,
			currency: plan.currency,
			trafficLimitBytes: plan.trafficLimitBytes
		};

		/**
		 * Priced at the plan's price, not at zero. Money did change hands — just not here — and an
		 * order written as free would quietly understate every total the profile and the history add
		 * up. A grant that really was free is a plan priced at zero, which is the admin's to create.
		 */
		const order = this.orders.create({
			userId: user.id,
			planId: plan.id,
			plan: snapshot,
			quote: {
				basePriceMinor: plan.priceMinor,
				discountMinor: 0,
				finalPriceMinor: plan.priceMinor,
				currency: plan.currency,
				promoCode: null
			},
			provider: 'manual'
		});

		/**
		 * The two provider columns are UNIQUE and there is no provider to fill them from, so they get
		 * a value derived from the order itself: unique by construction, and it reads in the database
		 * as what it is rather than as a payment id somebody might go looking for at Stripe.
		 */
		const marker = `manual:${order.publicId}`;
		this.orders.markPaid({
			orderId: order.id,
			paymentIntentId: marker,
			sessionId: marker
		});

		/**
		 * The same job a real payment schedules, under the same idempotency key. Everything after this
		 * point — Marzban, the subscription row, the message with the link — is the ordinary path.
		 */
		this.jobs.enqueue(
			'subscription.provision',
			{ orderId: order.id },
			`provision:order:${order.id}`
		);

		this.log.info('access_granted_manually', {
			orderId: order.id,
			userId: user.id,
			planId: plan.id
		});

		return { ok: true, value: { orderId: order.id, userId: user.id, planName: plan.name } };
	}
}
