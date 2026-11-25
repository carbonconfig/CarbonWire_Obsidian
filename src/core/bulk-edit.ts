/** A table row as bulk text holds it. */
export interface BulkRow {
	name: string;
	value: string;
	disabled?: boolean;
}

/** One `name: value` line per row, `//` before a disabled one; empty rows are left out. */
export function toBulkText(rows: readonly BulkRow[]): string {
	return rows
		.filter((r) => r.name !== "" || r.value !== "")
		.map((r) => `${r.disabled ? "// " : ""}${r.name}: ${r.value}`)
		.join("\n");
}

/** Reads lines back into rows; text after the first colon is the value, and a line without one is a name. */
export function fromBulkText(text: string): BulkRow[] {
	const rows: BulkRow[] = [];
	for (const raw of text.split(/\r?\n/)) {
		let line = raw.trim();
		if (!line) continue;
		const disabled = line.startsWith("//");
		if (disabled) line = line.slice(2).trimStart();
		const colon = line.indexOf(":");
		const name = (colon < 0 ? line : line.slice(0, colon)).trim();
		const value = colon < 0 ? "" : line.slice(colon + 1).trim();
		rows.push(disabled ? { name, value, disabled } : { name, value });
	}
	return rows;
}
