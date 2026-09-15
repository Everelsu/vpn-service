<script lang="ts">
	import { ChevronDown, ScanLine } from 'lucide-svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import Card from '$lib/ui/Card.svelte';
	import CopyField from '$lib/ui/CopyField.svelte';
	import QrCode from '$lib/ui/QrCode.svelte';
	import SectionHeading from '$lib/ui/SectionHeading.svelte';

	interface Props {
		/** The owner's subscription link. Absent means there is nothing to connect to yet. */
		subscriptionUrl: string;
	}

	let { subscriptionUrl }: Props = $props();

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
	<CopyField value={subscriptionUrl} label="Ссылка подписки" />

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
