<script lang="ts">
	import { ChevronDown, ScanLine } from 'lucide-svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import Card from '$lib/ui/Card.svelte';
	import CopyField from '$lib/ui/CopyField.svelte';
	import QrCode from '$lib/ui/QrCode.svelte';
	import SectionHeading from '$lib/ui/SectionHeading.svelte';
	import { clientsFor, type ClientPlatform } from './vpn-clients';

	interface Props {
		/** The owner's subscription link. Absent means there is nothing to connect to yet. */
		subscriptionUrl: string;
		/** Decided on the server from the user agent, so the right buttons render on the first paint. */
		platform: ClientPlatform;
	}

	let { subscriptionUrl, platform }: Props = $props();

	let clients = $derived(clientsFor(platform));

	/**
	 * The code is worth a third of the screen and is useless to the person already holding the phone
	 * the app runs on — they copy the link. So it opens on request instead of by default, and the
	 * link stays the thing the screen leads with.
	 */
	let qrOpen = $state(false);

	/**
	 * Joined here rather than spelled as an array on the icon. Svelte's array-class shorthand is a
	 * DOM-element feature: a component receives the array verbatim, and lucide calls `.trim()` on
	 * what it is given — which throws during SSR and takes the whole page to a 500.
	 */
	let chevronClass = $derived(
		[
			'size-[18px] shrink-0 text-subtle',
			qrOpen ? 'rotate-180' : '',
			prefersReducedMotion.current ? '' : 'transition-transform duration-200'
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

<!--
	The home screen used to end at the plan card and leave a third of itself empty, while the one
	thing a subscriber comes back for — the link that gets them online — sat two taps away behind
	«Инструкция по подключению». It lives here now, and the instructions stay for the first run.
-->
<SectionHeading title="Подключение" />

<Card>
	<!--
		The one-tap path, above the link rather than below it: somebody who already has the app is one
		button away from being online, and the link is the fallback for everybody else.

		Plain anchors, not WebApp.openLink — that method is for http(s). A custom scheme has to reach
		the WebView as a navigation for the OS to hand it to the app.
	-->
	<p class="text-2xs text-muted">Открыть в приложении</p>
	<div class="mt-2.5 flex flex-wrap gap-2">
		<!-- Not a route: resolve() is for paths inside this app, and every href below is a custom
		     scheme the OS hands to another app entirely. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		{#each clients as client (client.id)}
			<a
				href={client.link(subscriptionUrl)}
				class="press rounded-plan border border-line bg-inset px-4 py-2.5 text-2xs font-medium"
			>
				{client.label}
			</a>
		{/each}
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>

	<div class="mt-4 border-t border-line pt-4">
		<CopyField value={subscriptionUrl} label="Ссылка подписки" />
	</div>

	<button
		type="button"
		class="mt-4 flex w-full press items-center justify-between gap-3 rounded-plan bg-inset px-4 py-3 text-left"
		aria-expanded={qrOpen}
		onclick={() => (qrOpen = !qrOpen)}
	>
		<span class="flex items-center gap-2.5 text-2xs font-medium">
			<ScanLine class="size-[18px] text-accent" strokeWidth={1.9} aria-hidden="true" />
			QR-код для другого устройства
		</span>
		<ChevronDown class={chevronClass} strokeWidth={1.9} aria-hidden="true" />
	</button>

	{#if qrOpen}
		<!-- White plate under the code on purpose: a QR inverted onto a near-black card is read by
		     roughly half the scanners out there, and the half that fails does so silently. -->
		<div class="mt-3 grid place-items-center rounded-plan bg-white p-4">
			<QrCode value={subscriptionUrl} size={168} />
		</div>
	{/if}
</Card>
