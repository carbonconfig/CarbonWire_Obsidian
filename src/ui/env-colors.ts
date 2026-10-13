/** Default environment colours, distinct on light and dark themes; new environments cycle through them. */
export const ENV_COLORS = ["#2F80ED", "#27AE60", "#F2994A", "#9B51E0", "#EB5757"] as const;

const [BLUE, GREEN, ORANGE, , RED] = ENV_COLORS;

/* Common environment names, matched at the start of the name, and the colour each suggests. */
const NAMED_COLORS: readonly [RegExp, string][] = [
	[/^(local|dev)/i, GREEN],
	[/^(qa|test)/i, BLUE],
	[/^(stag|uat)/i, ORANGE],
	[/^(prod|live)/i, RED],
];

export function defaultEnvColor(existingCount: number): string {
	return ENV_COLORS[existingCount % ENV_COLORS.length]!;
}

/** The colour a name suggests: green for local or dev, blue for QA or test, orange for staging or UAT, red for production or live. */
export function colorForName(name: string): string | undefined {
	return NAMED_COLORS.find(([pattern]) => pattern.test(name.trim()))?.[1];
}

/** Dark or light text, whichever reads better on the given background colour. */
export function readableTextColor(background: string | undefined): string | undefined {
	const hex = background?.replace("#", "") ?? "";
	const full = hex.length === 3 || hex.length === 4 ? [...hex.slice(0, 3)].map((c) => c + c).join("") : hex.slice(0, 6);
	if (!/^[0-9a-f]{6}$/i.test(full)) return undefined;
	const [r, g, b] = [0, 2, 4].map((i) => {
		const c = parseInt(full.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return luminance > 0.4 ? "#1f1f1f" : "#ffffff";
}
