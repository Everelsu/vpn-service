<script lang="ts">
	import { resolve } from '$app/paths';
	import { prefersReducedMotion } from 'svelte/motion';
	import { haptic } from '$lib/client/telegram-haptics';
	import type { Section } from './nav';

	let { sections, activeIndex }: { sections: readonly Section[]; activeIndex: number } = $props();

	/**
	 * The pill is exactly one column wide, so one step is 100% of its own width. Spelling the travel
	 * as a percentage rather than a pixel stride is what lets the rail stretch to the screen: the
	 * previous version hard-coded 52px tabs 6px apart and would have parked the pill off-centre the
	 * moment the bar stopped being that exact size.
	 */
	let pillTransform = $derived(`transform: translate3d(${activeIndex * 100}%, 0, 0);`);
</script>

<!-- The wrapper stays transparent to the pointer so the page keeps scrolling under the island;
     only the rail itself takes events.
     Absolute, not fixed: the layout frame is the mini app. On a phone the frame is the viewport and
     the two agree, but on desktop the frame is a phone mock-up and `fixed` hangs the island off the
     viewport bottom, far below the rounded edge it belongs to. -->
<nav
	class="pointer-events-none absolute inset-x-0 bottom-0 z-40 px-4 pb-[max(14px,calc(env(safe-area-inset-bottom)+14px))]"
	aria-label="Разделы"
>
	<!--
		A full-width bar with three equal columns, not a hugging cluster of icons. Three unlabelled
		glyphs asked the reader to guess which one is support and which is the profile; a tab that
		spans a third of the screen has room for its own name, and the name is what makes the bar
		navigable on first open.
	-->
	<div class="pointer-events-auto island grid grid-cols-3 rounded-card p-1.5">
		<!--
			The travelling pill is a tint, not a fill: the active tab lifts a few percent out of the
			rail and takes the accent on its icon and label, so the accent stays a highlight instead of
			becoming a third button-sized block of colour at the bottom of every screen.
		-->
		<span
			class={[
				'pointer-events-none absolute inset-y-1.5 left-1.5 w-[calc((100%-0.75rem)/3)] rounded-plan bg-accent/12 will-change-transform',
				!prefersReducedMotion.current &&
					'transition-transform duration-[420ms] ease-[var(--ease-spring)]'
			]}
			style={pillTransform}
			aria-hidden="true"
		></span>

		{#each sections as section (section.index)}
			{@const Icon = section.icon}
			{@const active = section.index === activeIndex}
			<!-- Anchors, not buttons: navigation works without JS and SvelteKit can preload on tap. -->
			<a
				href={resolve(section.href)}
				data-sveltekit-preload-data="tap"
				class={[
					'relative z-10 flex flex-col items-center justify-center gap-[5px] rounded-plan py-2',
					active ? 'text-accent' : 'text-subtle',
					!prefersReducedMotion.current && 'transition-colors duration-[420ms]'
				]}
				aria-current={active ? 'page' : undefined}
				onclick={() => haptic()}
			>
				<Icon class="size-[22px]" strokeWidth={1.8} aria-hidden="true" />
				<!-- The visible label is the accessible name. An aria-label here would shadow it and hand
				     a screen reader a second, unsynchronised copy of the same word. -->
				<span class="text-4xs leading-none font-medium tracking-[-.01em]">{section.label}</span>
			</a>
		{/each}
	</div>
</nav>
