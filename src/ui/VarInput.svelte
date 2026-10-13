<script lang="ts">
	import { onMount } from "svelte";
	import type { HTMLInputAttributes } from "svelte/elements";
	import { templateSegments } from "../core/variables";
	import { isDefined, useVariables } from "./variables-context";

	let {
		value,
		oninput,
		class: className = "",
		...rest
	}: { value: string; oninput: (value: string) => void; class?: string } & Omit<HTMLInputAttributes, "value" | "oninput" | "class"> = $props();

	const variables = useVariables();
	let input: HTMLInputElement;
	let mirror = $state<HTMLDivElement>();

	const segments = $derived(templateSegments(value));
	const highlight = $derived(variables?.names !== undefined && segments.some((s) => s.variable !== undefined));

	/**
	 * The mirror draws the visible text over the input, so it copies every metric that affects
	 * glyph positions. The `font` shorthand is often empty in computed styles, hence the longhands.
	 */
	const METRICS = [
		"fontFamily",
		"fontSize",
		"fontWeight",
		"fontStyle",
		"fontStretch",
		"fontKerning",
		"fontFeatureSettings",
		"fontVariantLigatures",
		"fontVariantNumeric",
		"letterSpacing",
		"wordSpacing",
		"textIndent",
		"textTransform",
		"paddingLeft",
		"paddingRight",
		"borderLeftWidth",
		"borderRightWidth",
	] as const;

	function copyMetrics() {
		if (!mirror) return;
		const cs = getComputedStyle(input);
		for (const prop of METRICS) mirror.style[prop] = cs[prop];
		mirror.scrollLeft = input.scrollLeft;
	}

	function syncScroll() {
		if (mirror) mirror.scrollLeft = input.scrollLeft;
	}

	onMount(copyMetrics);
	// Fonts and themes can change after mount; refresh the metrics whenever the field gains focus.
	const refresh = () => copyMetrics();
	$effect(() => {
		if (highlight) copyMetrics();
	});
</script>

<div class="carbonwire-var-input {className}" class:is-highlighting={highlight}>
	<input
		bind:this={input}
		type="text"
		spellcheck="false"
		{...rest}
		{value}
		oninput={(e) => {
			oninput(e.currentTarget.value);
			requestAnimationFrame(syncScroll);
		}}
		onscroll={syncScroll}
		onkeyup={syncScroll}
		onfocus={refresh}
	/>
	{#if highlight && variables?.names}
		{@const names = variables.names}
		<div class="carbonwire-var-mirror" bind:this={mirror} aria-hidden="true"><span>{#each segments as s, i (i)}{#if s.variable !== undefined}<mark class={isDefined(names, s.variable) ? "is-defined" : "is-undefined"}>{s.text}</mark>{:else}{s.text}{/if}{/each}</span></div>
	{/if}
</div>
