/** Debounced saving that can be flushed before a send or when the view closes. */
export function createAutosave(save: () => Promise<void>, delayMs = 400) {
	let timer: number | undefined;

	async function flush(): Promise<void> {
		if (timer === undefined) return;
		window.clearTimeout(timer);
		timer = undefined;
		await save();
	}

	function schedule(): void {
		window.clearTimeout(timer);
		timer = window.setTimeout(() => void flush(), delayMs);
	}

	return { schedule, flush };
}
