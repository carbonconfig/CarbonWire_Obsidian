export interface Timing {
	name: string;
	median: number;
	p95: number;
	runs: number;
}

/** Runs `fn` repeatedly for about `budgetMs` after a warm-up and returns per-run times in milliseconds. */
export async function measure(name: string, fn: () => unknown, budgetMs = 1000): Promise<Timing> {
	for (let i = 0; i < 5; i++) await fn();
	const times: number[] = [];
	const end = performance.now() + budgetMs;
	while (performance.now() < end || times.length < 10) {
		const start = performance.now();
		await fn();
		times.push(performance.now() - start);
	}
	times.sort((a, b) => a - b);
	const at = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))]!;
	return { name, median: at(0.5), p95: at(0.95), runs: times.length };
}

export function report(title: string, timings: readonly Timing[]): void {
	const ms = (n: number) => (n < 1 ? `${(n * 1000).toFixed(0)} µs` : `${n.toFixed(2)} ms`);
	const width = Math.max(...timings.map((t) => t.name.length));
	const lines = timings.map((t) => `  ${t.name.padEnd(width)}  median ${ms(t.median).padStart(9)}  p95 ${ms(t.p95).padStart(9)}  (${t.runs} runs)`);
	process.stdout.write(`\n${title}\n${lines.join("\n")}\n`);
}
