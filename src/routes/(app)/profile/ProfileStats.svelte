<script lang="ts">
	import type { Currency, OrderDTO, PlanDTO, SubscriptionDTO } from '$lib/types';
	import Card from '$lib/ui/Card.svelte';
	import Money from '$lib/ui/Money.svelte';
	import SectionHeading from '$lib/ui/SectionHeading.svelte';
	import Skeleton from '$lib/ui/Skeleton.svelte';
	import { formatDays } from '../plan-value';
	import { formatTrafficCompact } from '../traffic';

	interface Props {
		subscription: SubscriptionDTO | null;
		/** The plan behind `subscription`, for its traffic limit. Null exactly when it is. */
		plan: PlanDTO | null;
		trafficUsedBytes: Promise<number | null>;
		/** Paid orders only; a refused attempt is not a purchase and must not be counted as one. */
		history: OrderDTO[];
		currency: Currency;
	}

	let { subscription, plan, trafficUsedBytes, history, currency }: Props = $props();

	let paid = $derived(history.filter((order) => order.status === 'paid'));
	let spentMinor = $derived(paid.reduce((sum, order) => sum + order.finalPriceMinor, 0));
	let active = $derived(subscription?.status === 'active');
</script>

<!--
	What the subscription block used to be. The plan, the link and the QR moved to the home screen —
	repeating them here made the profile a second copy of the first screen, and a person reading two
	places for one fact eventually finds them disagreeing.

	What is left is the part only this screen can answer: how much has been used, and what has been
	paid. It reads as a record rather than as a control.
-->
<SectionHeading title="Статистика" />

<Card>
	<dl class="grid grid-cols-2 gap-x-4 gap-y-5">
		<div class="min-w-0">
			<dt class="text-3xs text-subtle">Трафик</dt>
			<dd class="mt-1 truncate text-md font-bold">
				{#if plan}
					<!-- Streamed: Marzban is asked for it best-effort, and the rest of the screen must not
					     wait on a panel that may be slow or down. -->
					{#await trafficUsedBytes}
						<Skeleton height="1.25rem" />
					{:then usedBytes}
						{formatTrafficCompact(usedBytes, plan.trafficLimitBytes)}
					{:catch}
						Нет данных
					{/await}
				{:else}
					—
				{/if}
			</dd>
		</div>

		<div class="min-w-0">
			<dt class="text-3xs text-subtle">Доступ</dt>
			<dd class="mt-1 truncate text-md font-bold">
				{#if active && subscription}
					Ещё {formatDays(subscription.daysLeft)}
				{:else if subscription}
					Закончился
				{:else}
					Нет подписки
				{/if}
			</dd>
		</div>

		<div class="min-w-0">
			<dt class="text-3xs text-subtle">Покупок</dt>
			<dd class="mt-1 text-md font-bold">{paid.length}</dd>
		</div>

		<div class="min-w-0">
			<dt class="text-3xs text-subtle">Потрачено</dt>
			<dd class="mt-1 truncate text-md font-bold">
				<Money minor={spentMinor} {currency} />
			</dd>
		</div>
	</dl>
</Card>
