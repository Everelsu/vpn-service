import { createHash, timingSafeEqual } from 'node:crypto';
import * as v from 'valibot';
import { config } from '$lib/server/config';
import { jobs, tickets, users } from '$lib/server/container';
import { log } from '$lib/server/log';
import type { RequestHandler } from './$types';

/**
 * Inbound updates from Telegram. One of the three public paths (tech.md 9): it arrives with no
 * session by definition and authenticates itself with a shared header instead.
 *
 * Register it with scripts/set-webhook.ts, which passes the same TELEGRAM_WEBHOOK_SECRET this route
 * checks. Until that runs, Telegram has nowhere to deliver and this endpoint is never called.
 *
 * What it does beyond the check is deliberately small. The bot exists so the app can push
 * notifications (the subscription link, expiry reminders, the support relay) — everything a person
 * does, they do in the mini app. Two updates are answered here:
 *
 * - `/start`, because a bot that says nothing when opened is a dead end, and `t.me/<bot>` is a link
 *   people will find.
 * - a reply in the admin's own chat, which is the return path of the support relay. The admin
 *   swipes to reply on the forwarded request and the text reaches its author in this same bot. That
 *   is the whole feature: no second inbox, no ticket ui, and nothing for the admin to learn.
 */

/** Bot API sends the whole update; these are the only fields this route reads. */
const UpdateSchema = v.object({
	update_id: v.number(),
	message: v.optional(
		v.object({
			chat: v.object({ id: v.number(), type: v.string() }),
			text: v.optional(v.string()),
			// Present only when the admin swiped to reply. Its id is what markDelivered stored.
			reply_to_message: v.optional(v.object({ message_id: v.number() }))
		})
	)
});

/** `/start`, `/start@thisbot`, or `/start <payload>` — Telegram appends both in real chats. */
const START_COMMAND = /^\/start(?:@\S+)?(?:\s|$)/;

const WELCOME =
	'Подключим VPN за минуту. Откройте приложение, выберите тариф и получите ключ:\n' +
	config.RETURN_DEEPLINK;

export const POST: RequestHandler = async ({ request, locals }) => {
	const requestLog = log.child({ requestId: locals.requestId });

	/**
	 * tech.md 9: mismatch answers 401 without a single database call. Everything below this line
	 * trusts the sender, so nothing below it may run first.
	 */
	if (!secretMatches(request.headers.get('x-telegram-bot-api-secret-token'))) {
		// No header value in the log, not even a prefix: it is the credential itself.
		requestLog.warn('telegram_webhook_bad_secret');
		return json(401, { code: 'unauthorized' });
	}

	let update: v.InferOutput<typeof UpdateSchema>;
	try {
		update = v.parse(UpdateSchema, await request.json());
	} catch {
		/**
		 * Signed with our secret and still unreadable — a Bot API version we do not model, or junk.
		 * A retry would deliver identical bytes, so answering 200 retires it instead of letting
		 * Telegram redeliver the same failure until it gives up. The body never reaches the log
		 * (CLAUDE.md 2).
		 */
		requestLog.warn('telegram_webhook_unparsable');
		return json(200, { outcome: 'ignored' });
	}

	const message = update.message;
	const text = message?.text?.trim() ?? '';

	/**
	 * The support reply. Only from the admin's own chat: `chat.id` is the one thing here the sender
	 * cannot choose, because the update is already proven to come from Telegram by the secret header
	 * above. Anyone else replying to anything gets the same silence as any other update.
	 */
	if (message && message.chat.id === config.ADMIN_CHAT_ID && message.reply_to_message && text) {
		return relayAdminReply(update.update_id, message.reply_to_message.message_id, text, requestLog);
	}

	const isStart = message?.chat.type === 'private' && START_COMMAND.test(text);

	if (!isStart) {
		requestLog.info('telegram_webhook_ignored', { updateId: update.update_id });
		return json(200, { outcome: 'ignored' });
	}

	/**
	 * Telegram redelivers an update until it gets a 2xx, and `update_id` is stable across those
	 * redeliveries — so it is the idempotency key, and a person who is answered slowly never gets
	 * answered twice. A second genuine `/start` carries a new id and is answered again, which is
	 * what someone pressing the button twice expects.
	 */
	const dedupeKey = `start:${update.update_id}`;
	jobs.enqueue(
		'telegram.send_message',
		{ chatId: message.chat.id, text: WELCOME, dedupeKey },
		`tg:${dedupeKey}`
	);

	requestLog.info('telegram_webhook_start', { updateId: update.update_id });
	return json(200, { outcome: 'start' });
};

/**
 * Hands the admin's words to the person who asked. Everything it can fail on is a fact about our
 * own data, not about the sender, so each miss answers 200: Telegram would otherwise redeliver an
 * update that will fail identically forever.
 */
function relayAdminReply(
	updateId: number,
	repliedToMessageId: number,
	text: string,
	requestLog: ReturnType<typeof log.child>
): Response {
	const ticket = tickets.findByAdminMessageId(repliedToMessageId);
	if (!ticket) {
		// The admin replied to something that is not a forwarded request — their own note, a photo.
		requestLog.info('telegram_webhook_reply_unmatched', { updateId });
		return json(200, { outcome: 'ignored' });
	}

	const author = users.findById(ticket.userId);
	if (!author) {
		requestLog.warn('telegram_webhook_reply_no_author', { updateId, ticketId: ticket.id });
		return json(200, { outcome: 'ignored' });
	}

	/**
	 * `update_id` is stable across Telegram's redeliveries, so a slow answer is never sent twice.
	 * The text itself is never logged: it is one half of a private conversation (CLAUDE.md 2).
	 */
	const dedupeKey = `support_reply:${updateId}`;
	jobs.enqueue(
		'telegram.send_message',
		{
			chatId: author.telegramId,
			text: `Ответ поддержки:

${text}`,
			dedupeKey
		},
		`tg:${dedupeKey}`
	);

	requestLog.info('telegram_webhook_reply_relayed', { updateId, ticketId: ticket.id });
	return json(200, { outcome: 'support_reply' });
}

/**
 * Constant-time comparison over digests rather than over the raw values: timingSafeEqual throws on
 * a length mismatch, and guarding that with an early `length !==` return would leak the secret's
 * length. Hashing first makes both sides 32 bytes whatever arrives.
 */
function secretMatches(provided: string | null): boolean {
	const digest = (value: string) => createHash('sha256').update(value).digest();
	return timingSafeEqual(digest(provided ?? ''), digest(config.TELEGRAM_WEBHOOK_SECRET));
}

const json = (status: number, body: Record<string, string>) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
