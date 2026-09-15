<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Textarea from '$lib/ui/Textarea.svelte';

	interface Props {
		errors?: Record<string, string>;
		values?: Record<string, string>;
	}

	let { errors = {}, values = {} }: Props = $props();

	// Read once, on purpose: after mount these inputs belong to the person typing in them.
	let telegramId = $state(untrack(() => values.telegramId ?? ''));
	let text = $state(untrack(() => values.text ?? ''));
	let sending = $state(false);

	/** Each message stands only while its own field still holds what the server rejected. */
	let idError = $derived(
		errors.telegramId && telegramId === (values.telegramId ?? '') ? errors.telegramId : undefined
	);
	let textError = $derived(errors.text && text === (values.text ?? '') ? errors.text : undefined);
</script>

<form
	method="POST"
	action="?/sendMessage"
	class="space-y-3"
	use:enhance={() => {
		sending = true;

		return async ({ result, update }) => {
			// The text goes, the id stays: reqisites are usually followed by a second line to the same
			// person, and retyping their id every time is the kind of friction that stops it happening.
			if (result.type === 'success') text = '';

			await update({ reset: false });
			sending = false;
		};
	}}
>
	<Input
		bind:value={telegramId}
		name="telegramId"
		label="Telegram ID"
		inputmode="numeric"
		required
		error={idError}
		placeholder="700000111"
	/>

	<Textarea
		bind:value={text}
		name="text"
		label="Сообщение"
		placeholder="Реквизиты для оплаты, ссылка, что угодно — придёт человеку в бот."
		maxlength={2000}
		counter
		rows={4}
		error={textError}
	/>

	<Button type="submit" size="sm" class="w-full" loading={sending}>Отправить в бот</Button>
</form>
