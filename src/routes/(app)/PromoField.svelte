<script lang="ts">
	import { enhance } from '$app/forms';
	import { haptic } from '$lib/client/telegram-haptics';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';
	import type { PriceQuote } from '$lib/types';

	interface Props {
		/** The plan the quote is asked about. Null disables the field: there is nothing to price. */
		planId: number | null;
		/** A checkout is in flight; a code cannot be changed under an order being created. */
		disabled?: boolean;
		/** Raised with the server's quote, or null when the code was refused or the field emptied. */
		onquote: (quote: PriceQuote | null, code: string) => void;
	}

	let { planId, disabled = false, onquote }: Props = $props();

	let code = $state('');
	let checking = $state(false);
	/** The refusal, and the exact string it was about — see `answer` below. */
	let refusal = $state<{ message: string; code: string } | null>(null);

	const normalise = (value: string) => value.trim().toUpperCase();

	/**
	 * A refusal stands only while the field still holds the code the server answered about. Editing
	 * it retires the answer: a message that survives the correction tells somebody their fix did not
	 * take. Both sides are normalised the way the schema normalises them, or a code retyped in lower
	 * case would clear an error it did not fix.
	 */
	let answer = $derived(refusal && normalise(code) === normalise(refusal.code) ? refusal : null);
</script>

<!--
	The promo lives here, beside the prices it changes, and not on a second screen. It used to be
	entered twice — once in Профиль, which told you what the code was worth and then said «введите
	его при покупке на главной», and again in a sheet of its own that checked nothing and showed no
	price. Nobody saw what they would pay until the payment page.
-->
<form
	method="POST"
	action="?/quotePrice"
	class="mt-4 flex gap-2"
	use:enhance={() => {
		checking = true;

		/**
		 * The result is read here instead of through `update()`, deliberately: this route's `form`
		 * prop belongs to the checkout failure banner, and letting a quote land in it would clear
		 * that banner — or replace it — every time somebody tried a code.
		 */
		return async ({ result }) => {
			checking = false;
			haptic();

			if (result.type === 'success' && result.data) {
				refusal = null;
				onquote(result.data.quote as PriceQuote, normalise(code));
				return;
			}

			const message =
				result.type === 'failure' && typeof result.data?.message === 'string'
					? result.data.message
					: 'Не удалось проверить промокод. Попробуйте ещё раз.';

			refusal = { message, code };
			onquote(null, normalise(code));
		};
	}}
>
	<input type="hidden" name="planId" value={planId ?? ''} />
	<Input
		bind:value={code}
		name="promoCode"
		aria-label="Промокод"
		placeholder="Промокод"
		maxlength={32}
		uppercase
		error={answer?.message}
	/>
	<Button
		type="submit"
		variant="ghost"
		size="md"
		loading={checking}
		disabled={disabled || planId === null || normalise(code) === ''}
	>
		Применить
	</Button>
</form>
