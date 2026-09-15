import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { UserService } from '../auth/user-service';
import type { Db } from '../db/client';
import { jobs as jobsTable } from '../db/schema';
import { createTestDb, silentLogger, TestClock } from '../jobs/fixtures';
import { JobQueue } from '../jobs/queue';
import { PlanService } from '../plans';
import { addPlan, addUser } from './fixtures';
import { ManualGrantService } from './grant-service';
import { OrderService } from './order-service';

/**
 * What the owner does now that no money moves through the app: takes payment somewhere else, then
 * hands somebody a term. The criteria are written from that sentence — an order that reads as paid,
 * the ordinary provision job behind it, and two refusals the panel can phrase.
 */

let db: Db;
let clock: TestClock;
let orders: OrderService;
let jobs: JobQueue;
let grants: ManualGrantService;

const provisionJobs = () =>
	db.select().from(jobsTable).where(eq(jobsTable.type, 'subscription.provision')).all();

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock();
	orders = new OrderService(db, { now: clock.now });
	jobs = new JobQueue(db);
	grants = new ManualGrantService(
		orders,
		new PlanService(db, 'rub', { now: clock.now }),
		new UserService(db),
		jobs,
		silentLogger()
	);
});

describe('ManualGrantService.grant', () => {
	it('writes an order that already reads as paid', () => {
		const user = addUser(db, { telegramId: 700_000_111 });
		const plan = addPlan(db, { priceMinor: 49_900 });

		const granted = grants.grant(700_000_111, plan.id);

		expect(granted.ok).toBe(true);
		const order = orders.findById(granted.ok ? granted.value.orderId : 0)!;
		expect(order.status).toBe('paid');
		expect(order.paidAt).not.toBeNull();
		expect(order.userId).toBe(user.id);
		expect(order.provider).toBe('manual');
	});

	it('records the plan price, because that is what was charged somewhere else', () => {
		addUser(db, { telegramId: 700_000_111 });
		const plan = addPlan(db, { priceMinor: 49_900 });

		const granted = grants.grant(700_000_111, plan.id);
		const order = orders.findById(granted.ok ? granted.value.orderId : 0)!;

		// Written as free, it would quietly understate every total the profile adds up.
		expect(order.finalPriceMinor).toBe(49_900);
		expect(order.discountMinor).toBe(0);
	});

	it('hands the rest to the same job a real payment schedules', () => {
		addUser(db, { telegramId: 700_000_111 });
		const plan = addPlan(db);

		const granted = grants.grant(700_000_111, plan.id);
		const [job] = provisionJobs();

		expect(job).toBeDefined();
		expect(job.idempotencyKey).toBe(`provision:order:${granted.ok ? granted.value.orderId : 0}`);
	});

	it('refuses somebody who has never opened the app', () => {
		const plan = addPlan(db);

		// orders.userId references a real row, and a user invented from a bare id would carry no name.
		expect(grants.grant(700_000_999, plan.id)).toEqual({ ok: false, error: 'user_not_found' });
		expect(provisionJobs()).toHaveLength(0);
	});

	it('refuses a plan that is no longer sold', () => {
		addUser(db, { telegramId: 700_000_111 });
		const plan = addPlan(db, { isActive: false });

		expect(grants.grant(700_000_111, plan.id)).toEqual({ ok: false, error: 'plan_unavailable' });
		expect(provisionJobs()).toHaveLength(0);
	});

	it('writes a separate order every time, so two grants are two terms', () => {
		addUser(db, { telegramId: 700_000_111 });
		const plan = addPlan(db);

		const first = grants.grant(700_000_111, plan.id);
		clock.advance(1000);
		const second = grants.grant(700_000_111, plan.id);

		expect(first.ok && second.ok).toBe(true);
		expect(first.ok && second.ok && first.value.orderId).not.toBe(
			second.ok ? second.value.orderId : 0
		);
		expect(provisionJobs()).toHaveLength(2);
	});
});
