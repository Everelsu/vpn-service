<script lang="ts">
	import { getContext, untrack } from 'svelte';
	import { SlidersHorizontal } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { checkoutWatcher } from '$lib/client/checkout.svelte';
	import { haptic } from '$lib/client/telegram-haptics';
	import { TELEGRAM_SESSION_KEY, type TelegramSession } from '$lib/client/telegram.svelte';
	import Avatar from '$lib/ui/Avatar.svelte';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import SectionHeading from '$lib/ui/SectionHeading.svelte';
	import ProfileStats from './ProfileStats.svelte';
	import PurchaseHistory from './PurchaseHistory.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const session = getContext<TelegramSession>(TELEGRAM_SESSION_KEY);

	let user = $derived(session.user);
	// Both halves of the name, joined here rather than stored: the DTO keeps them apart because
	// Telegram does, and lastName is optional. A browser visitor with no session gets no name at
	// all — Инкогнито is the honest word for that, not an empty line.
	let fullName = $derived(
		user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : 'Инкогнито'
	);
	// The mock falls back to the Telegram id when somebody has no @username — their own id, shown
	// to them alone, and it beats an empty line under their name. Null hides the line entirely:
	// an anonymous visitor has no handle to show, not an empty one.
	let handle = $derived(
		user ? (user.username ? `@${user.username}` : `ID ${user.telegramId}`) : null
	);

	/**
	 * The watcher is shared with Главная, so a payment started there keeps polling while its person
	 * reads this screen — and its poll is what re-runs this load (both depend on 'app:subscription').
	 */
	$effect(() =>
		checkoutWatcher.attach(() => ({
			subscription: data.subscription,
			latestOrder: data.latestOrder,
			awaitingKey: data.awaitingKey
		}))
	);

	/**
	 * Somebody can also arrive here with the key still being made and no wait running: Telegram
	 * relaunched the app, or they were on Профиль when the money landed. Without this the spinner
	 * below would turn forever — nothing else on this route ever asks the server again, and a mini
	 * app offers no obvious reload gesture.
	 *
	 * untrack keeps the effect from subscribing to `data` through the watcher's own phase, which
	 * would restart the minute on every poll.
	 */
	$effect(() => {
		if (!data.awaitingKey) return;
		untrack(() => {
			if (checkoutWatcher.phase === 'idle') checkoutWatcher.start();
		});
	});

	function choosePlan() {
		haptic();
		goto(resolve('/'));
	}
</script>

<svelte:head>
	<title>Профиль — VPN</title>
</svelte:head>

<div class="px-5 pt-[max(26px,calc(env(safe-area-inset-top)+26px))] pb-32">
	<!--
		The reference centres this screen's title and hangs its one utility off the corner. The admin
		entrance is that utility: an icon, hidden from everyone else, and that is all the hiding is —
		the guard in hooks.server.ts and the isAdmin check inside every admin action are what actually
		refuse the request (tech.md 9).
	-->
	<div class="flex items-center justify-between gap-3">
		<!-- Holds the left corner open so the title stays centred whether or not the admin control is
		     rendered. The reference balances this row with a control on each side; only one of the two
		     has anything real behind it here. -->
		<span class="size-10 shrink-0" aria-hidden="true"></span>

		<h1 class="text-h1 font-bold tracking-[-.02em]">Профиль</h1>

		{#if session.isAdmin}
			<IconButton href={resolve('/profile/admin')} aria-label="Админка">
				<SlidersHorizontal class="size-[19px]" strokeWidth={1.9} aria-hidden="true" />
			</IconButton>
		{:else}
			<span class="size-10 shrink-0" aria-hidden="true"></span>
		{/if}
	</div>

	<!--
		Shown whether or not anybody is signed in: a browser visitor gets the empty avatar and
		Инкогнито rather than the whole profile disappearing behind a single sign-in banner.
	-->
	<div class="mt-6 flex flex-col items-center text-center">
		<Avatar photoUrl={user?.photoUrl ?? null} firstName={user?.firstName ?? null} size="lg" />
		<p class="mt-3.5 max-w-full truncate text-h1 font-bold tracking-[-.02em]">
			{fullName}
		</p>
		{#if handle}
			<p class="mt-0.5 max-w-full truncate text-2xs text-muted">{handle}</p>
		{/if}
	</div>

	<div class="mt-7">
		<ProfileStats
			subscription={data.subscription}
			plan={data.plan}
			trafficUsedBytes={data.trafficUsedBytes}
			history={data.history}
			currency={data.currency}
		/>
	</div>

	{#if !data.subscription}
		<div class="mt-3">
			<EmptyState
				title="Подписки нет"
				description={user
					? 'Выберите тариф — ключ придёт сразу после оплаты.'
					: 'Откройте приложение из Telegram и выберите тариф.'}
			>
				{#snippet action()}
					<Button size="sm" class="w-full" onclick={choosePlan}>Выбрать тариф</Button>
				{/snippet}
			</EmptyState>
		</div>
	{/if}

	{#if data.history.length > 0}
		<!--
			Only once there is something to show. An empty receipts list under a fresh profile is a
			heading explaining that nothing has happened yet, which the empty state above already
			says better.
		-->
		<SectionHeading title="История покупок" />

		<PurchaseHistory orders={data.history} />
	{/if}
</div>
