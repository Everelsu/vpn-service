import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { subscriptions, users } from '../src/lib/server/db/schema';

/**
 * Mints a signed initData string for a seeded user and gives them an active subscription, so the
 * filled state of every screen can be looked at without a bot, a tunnel or a real Telegram client.
 *
 * It signs with TELEGRAM_BOT_TOKEN exactly as Telegram does, which is why it is useful and also why
 * it must never run against production: the token it signs with there is the real one, and this
 * would mint a valid login for any account id passed on the command line. The guard below refuses
 * any token that does not carry the placeholder from .env.test.
 *
 *   npm run dev:login              # the seeded admin, 100000001
 *   npm run dev:login -- 100000002 # the other seeded user
 *
 * Paste the printed line into the browser console on the running dev server:
 *
 *   await fetch('/api/auth/telegram', { method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ initData: '<printed>' }) });
 *
 * then reload. The session cookie is set and SSR renders signed in.
 */

try {
	process.loadEnvFile('.env');
} catch {
	// No .env: fall back to the real environment.
}

const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
const databasePath = process.env.DATABASE_PATH;

if (!databasePath) {
	console.error('DATABASE_PATH is required');
	process.exit(1);
}

// The placeholder from .env.test. Anything else is presumed to be a live bot.
if (!botToken.includes('test-bot-token-not-a-real-secret')) {
	console.error('dev-login refuses to sign with a token that is not the .env.test placeholder.');
	process.exit(1);
}

const telegramId = Number(process.argv[2] ?? 100_000_001);
const db = createDb(databasePath);

const user = db.select().from(users).where(eq(users.telegramId, telegramId)).get();
if (!user) {
	console.error(`no seeded user with telegram id ${telegramId} — run npm run db:seed first`);
	process.exit(1);
}

const now = Date.now();
const DAY_MS = 86_400_000;

// Re-runnable: the row is keyed by user and replaced, so repeated runs leave exactly one.
db.delete(subscriptions).where(eq(subscriptions.userId, user.id)).run();
db.insert(subscriptions)
	.values({
		userId: user.id,
		planId: 2,
		marzbanUsername: `tg_${telegramId}`,
		subscriptionUrl: `https://sub.local/sub/tg_${telegramId}`,
		startsAt: new Date(now - 18 * DAY_MS),
		expiresAt: new Date(now + 12 * DAY_MS),
		status: 'active',
		createdAt: new Date(now - 18 * DAY_MS),
		updatedAt: new Date(now)
	})
	.run();

const params = new URLSearchParams({
	auth_date: String(Math.floor(now / 1000)),
	query_id: 'AAHdevQueryId',
	// The raw JSON is what gets signed and what the validator reads back, so it is built once here
	// and never round-tripped through a parse (init-data.ts says why that breaks the hash).
	user: JSON.stringify({
		id: telegramId,
		first_name: user.firstName,
		last_name: user.lastName ?? undefined,
		username: user.username ?? undefined,
		language_code: user.languageCode ?? 'ru'
	})
});

const dataCheckString = [...params.entries()]
	.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
	.map(([key, value]) => `${key}=${value}`)
	.join('\n');

const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));

console.log(`seeded an active subscription for ${user.firstName} (${telegramId})`);
console.log(params.toString());
