<script lang="ts">
	import { icon } from "./actions";
	import { ENV_COLORS } from "./env-colors";

	let { value, onchange }: { value: string | undefined; onchange: (color: string) => void } = $props();

	// Tracks the selection locally so hosts that mount this once still see it update.
	let current = $state<string | undefined>();
	$effect.pre(() => {
		current = value;
	});

	/** Changes the selection without counting as the user's choice, e.g. for a colour suggested by the name. */
	export function suggest(color: string) {
		current = color;
	}

	function pick(color: string) {
		current = color;
		onchange(color);
	}

	const isPreset = $derived(current !== undefined && ENV_COLORS.some((c) => c.toLowerCase() === current!.toLowerCase()));
</script>

<div class="carbonwire-swatches" role="radiogroup" aria-label="Colour">
	{#each ENV_COLORS as color (color)}
		<button
			class="carbonwire-swatch"
			class:is-selected={current?.toLowerCase() === color.toLowerCase()}
			style:--cw-swatch={color}
			role="radio"
			aria-checked={current?.toLowerCase() === color.toLowerCase()}
			aria-label="Colour {color}"
			onclick={() => pick(color)}
		></button>
	{/each}
	<label class="carbonwire-swatch is-custom" class:is-selected={current !== undefined && !isPreset} style:--cw-swatch={current && !isPreset ? current : "transparent"} aria-label="Custom colour">
		<span use:icon={"pipette"}></span>
		<input type="color" value={current ?? ENV_COLORS[0]} oninput={(e) => pick(e.currentTarget.value)} />
	</label>
</div>
