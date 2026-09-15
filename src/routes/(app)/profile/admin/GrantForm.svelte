<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Money from '$lib/ui/Money.svelte';
	import type { PlanDTO } from '$lib/types';

	interface Props {
		/** What is on sale. Empty means there is nothing to grant, and the form says so. */
		plans: PlanDTO[];
		errors?: Record<string, string>;
		values?: Record<string, string>;
	}

	let { plans, errors = {}, values = {} }: Props = $props();

	// Read once, on purpose: after mount these inputs belong to the person typing in them.
	let telegramId = $state(untrack(() => values.telegramId ?? ''));
	let planId = $state(untrack(() => values.planId ?? String(plans[0]?.id ?? '')));
	let granting = $state(false);

	/** A message stands only while the input still holds exactly what the server rejected. */
	let idError = $derived(
		errors.telegramId && telegramId === (values.telegramId ?? '') ? errors.telegramId : undefined
	);

	const CONTROL =
		'h-12 w-full min-w-0 rounded-field border border-line bg-inset px-4 text-sm text-ink appearance-none';
	const LABEL = 'mb-1.5 block px-1 text-2xs font-medium text-muted';
</script>

<form
	method="POST"
	action="?/grant"
	class="space-y-3"
	use:enhance={() => {
		granting = true;

		return async ({ result, update }) => {
			// Granted means the id has done its job. A stale one left in the field invites a second
			// click, and a second grant is a second term — this one is not idempotent by accident.
			if (result.type === 'success') telegramId = '';

			await update({ reset: false });
			granting = false;
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

	<div>
		<label for="grant-plan" class={LABEL}>Тариф</label>
		<select id="grant-plan" name="planId" bind:value={planId} class={CONTROL}>
			{#each plans as plan (plan.id)}
				<option value={String(plan.id)}>{plan.name} · {plan.durationDays} дн.</option>
			{/each}
		</select>
		{#if errors.planId}
			<p class="mt-1.5 px-1 text-3xs text-danger">{errors.planId}</p>
		{/if}
	</div>

	{#if plans.length === 0}
		<p class="px-1 text-3xs text-muted">Сначала заведите хотя бы один активный тариф.</p>
	{/if}

	<Button type="submit" size="sm" class="w-full" loading={granting} disabled={plans.length === 0}>
		Выдать доступ
	</Button>

	{#if plans.length > 0}
		{@const selected = plans.find((plan) => String(plan.id) === planId)}
		{#if selected}
			<!-- The order is written at the plan's price, because that is what was charged somewhere
			     else. Saying so here keeps the totals in the profile from being a surprise. -->
			<p class="px-1 text-3xs text-muted">
				Запишется как оплата <Money minor={selected.priceMinor} currency={selected.currency} />.
			</p>
		{/if}
	{/if}
</form>
