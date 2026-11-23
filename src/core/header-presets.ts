import type { HttpRequestHeader } from "./model";

/* Header presets: named sets of headers, kept in .carbonwire/header-presets.json. */

export const HEADER_PRESETS_FILE = ".carbonwire/header-presets.json";

export interface HeaderPreset {
	name: string;
	headers: { name: string; value: string }[];
}

export function parsePresets(text: string | undefined): HeaderPreset[] {
	if (!text) return [];
	try {
		const parsed: unknown = JSON.parse(text);
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((p: { name?: unknown; headers?: unknown }) =>
			typeof p?.name === "string" && Array.isArray(p.headers)
				? [{ name: p.name, headers: (p.headers as { name?: unknown; value?: unknown }[]).filter((h) => typeof h?.name === "string").map((h) => ({ name: String(h.name), value: typeof h.value === "string" ? h.value : "" })) }]
				: [],
		);
	} catch {
		return [];
	}
}

export function serializePresets(presets: readonly HeaderPreset[]): string {
	return `${JSON.stringify(presets, null, 2)}\n`;
}

/** Saving under a name that exists replaces that preset. */
export function upsertPreset(presets: readonly HeaderPreset[], preset: HeaderPreset): HeaderPreset[] {
	const out = presets.filter((p) => p.name !== preset.name);
	out.push(preset);
	return out;
}

/** Adds a preset's headers to a request's; a header the request has takes the preset's value. */
export function applyPreset(headers: readonly HttpRequestHeader[], preset: HeaderPreset): HttpRequestHeader[] {
	const out = headers.map((h) => ({ ...h }));
	for (const h of preset.headers) {
		const existing = out.find((e) => e.name.toLowerCase() === h.name.toLowerCase());
		if (existing) {
			existing.value = h.value;
			delete existing.disabled;
		} else {
			out.push({ name: h.name, value: h.value });
		}
	}
	return out;
}
