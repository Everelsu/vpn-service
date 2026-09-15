import * as v from 'valibot';
import type { Result } from '$lib/types';

/**
 * The subscriptions domain owns its own input contract: the reconcile form under /profile/admin
 * hands raw FormData here and receives either a parsed input or field-level messages (CLAUDE.md 2 —
 * unparsed data never reaches the domain).
 *
 * ## Why the form takes a Telegram id and not a subscription id
 *
 * tech.md 6 keys `marzban.reconcile` by `subscriptionId`, and nothing in the panel tech.md 11
 * describes ever shows one: there is no subscriptions list, and the id is an internal
 * autoincrement the admin has no way to learn. The Telegram id, by contrast, is in front of them
 * already — every relayed support request prints `@username` or `ID <telegramId>`
 * (jobs/handlers/support-notify-admin.ts).
 *
 * So the screen asks for the id a human actually holds and the action resolves it to the id the
 * contract wants. The queue key stays exactly `reconcile:<subscriptionId>:<hour>`.
 */

/**
 * Every field starts optional and falls back to '', so a key the form did not send fails our own
 * rule instead of valibot's — the default message would otherwise reach the admin in English,
 * quoting a schema they cannot see. Same construction as plans/input.ts.
 */
const textField = (message: string) => v.optional(v.string(message), '');

/** Telegram ids are positive and comfortably inside the safe integer range. */
const MAX_TELEGRAM_ID = Number.MAX_SAFE_INTEGER;

const ReconcileSchema = v.object({
	telegramId: v.pipe(
		textField('Telegram ID: введите число'),
		v.trim(),
		v.regex(/^\d+$/, 'Telegram ID: введите число'),
		// Length first: 400 digits pass the regex and come out of Number() as Infinity, which fails
		// v.integer() before either bound is reached. Rejecting on length keeps that impossible.
		v.maxLength(String(MAX_TELEGRAM_ID).length, 'Telegram ID: слишком длинный'),
		v.transform(Number),
		v.integer('Telegram ID: введите число'),
		v.minValue(1, 'Telegram ID: введите число больше нуля'),
		v.maxValue(MAX_TELEGRAM_ID, 'Telegram ID: слишком большой')
	)
});

export type ReconcileInput = v.InferOutput<typeof ReconcileSchema>;

/** Field name -> first message for that field, so the form shows one line per input. */
function fieldErrors(
	issues: [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]]
): Record<string, string> {
	const errors: Record<string, string> = {};

	for (const issue of issues) {
		const field = issue.path?.map((segment) => String(segment.key)).join('.') ?? '';
		if (field && !(field in errors)) errors[field] = issue.message;
	}

	return errors;
}

/** Pure input logic: no DB, no clock, no HTTP. */
export class ReconcileInputParser {
	parse(raw: unknown): Result<ReconcileInput, Record<string, string>> {
		const result = v.safeParse(ReconcileSchema, raw);

		return result.success
			? { ok: true, value: result.output }
			: { ok: false, error: fieldErrors(result.issues) };
	}
}

/**
 * The two forms the owner uses to run the shop by hand, both keyed on the same Telegram id and for
 * the same reason as reconcile above: it is the number a human actually holds.
 *
 * They live here rather than in billing because what they name is a person and a term of access,
 * not a payment — no money passes through this app any more (grant-service.ts says what does).
 */
const MAX_MESSAGE_LENGTH = 2000;

const planIdField = v.pipe(
	textField('Тариф: выберите значение'),
	v.trim(),
	v.regex(/^\d+$/, 'Тариф: выберите значение'),
	v.maxLength(16, 'Тариф: выберите значение'),
	v.transform(Number),
	v.integer('Тариф: выберите значение'),
	v.minValue(1, 'Тариф: выберите значение')
);

const GrantSchema = v.object({
	telegramId: ReconcileSchema.entries.telegramId,
	planId: planIdField
});

export type GrantInput = v.InferOutput<typeof GrantSchema>;

export class GrantInputParser {
	parse(raw: unknown): Result<GrantInput, Record<string, string>> {
		const result = v.safeParse(GrantSchema, raw);

		return result.success
			? { ok: true, value: result.output }
			: { ok: false, error: fieldErrors(result.issues) };
	}
}

const AdminMessageSchema = v.object({
	telegramId: ReconcileSchema.entries.telegramId,
	/**
	 * Trimmed before the length checks, so a field holding only spaces is empty rather than long
	 * enough. The ceiling is Telegram's own message limit at 4096 minus room for the prefix the
	 * sender adds; 2000 matches what a support request may be, which keeps one number in the head.
	 */
	text: v.pipe(
		textField('Сообщение: заполните поле'),
		v.trim(),
		v.minLength(1, 'Сообщение: заполните поле'),
		v.maxLength(MAX_MESSAGE_LENGTH, `Сообщение: не длиннее ${MAX_MESSAGE_LENGTH} символов`)
	)
});

export type AdminMessageInput = v.InferOutput<typeof AdminMessageSchema>;

export class AdminMessageInputParser {
	parse(raw: unknown): Result<AdminMessageInput, Record<string, string>> {
		const result = v.safeParse(AdminMessageSchema, raw);

		return result.success
			? { ok: true, value: result.output }
			: { ok: false, error: fieldErrors(result.issues) };
	}
}
