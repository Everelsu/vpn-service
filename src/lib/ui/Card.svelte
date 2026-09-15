<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		padded?: boolean;
		interactive?: boolean;
		/** `brand` is the screen's subject and there is at most one per screen. See `classes` below. */
		tone?: 'default' | 'brand';
		onclick?: (event: MouseEvent) => void;
		class?: string;
		children: Snippet;
	}

	let {
		padded = true,
		interactive = false,
		tone = 'default',
		onclick,
		class: className = '',
		children
	}: Props = $props();

	/**
	 * A card is interactive or it is not: the affordance and the element that carries it must never
	 * disagree. `interactive` alone used to render a div with a pointer cursor and press feedback —
	 * something that looks clickable but is unreachable from a keyboard. `onclick` alone used to
	 * render a button with no press feedback, the only affordance a WebView has (there is no hover).
	 */
	let clickable = $derived(interactive || Boolean(onclick));

	/**
	 * Two tones, and the second one is rationed. Every card is the same dark surface over a hairline;
	 * `brand` adds a low purple wash and an accent-tinted edge, and it belongs to the one card a
	 * screen is actually about. A second one on the same screen cancels the first — then nothing is
	 * the subject and the wash is just texture.
	 *
	 * The tone classes are mutually exclusive rather than layered, so which one wins never depends on
	 * the order two utilities happen to sit in the compiled stylesheet. Both live in app.css: the
	 * fill, the border and the radius travel together, because that trio is what makes a card read as
	 * one on this palette — the fill alone is a two-step lift nobody sees.
	 */
	let classes = $derived(
		[
			tone === 'brand' ? 'card-brand' : 'card',
			padded ? 'p-5' : '',
			clickable ? 'press cursor-pointer' : '',
			className
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

{#if clickable}
	<!-- A clickable card is a real button: div + onclick is unreachable from a keyboard. -->
	<button type="button" {onclick} class="block w-full text-left {classes}">
		{@render children()}
	</button>
{:else}
	<div class={classes}>
		{@render children()}
	</div>
{/if}
