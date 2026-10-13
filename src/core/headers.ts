import type { Header } from "./model";

export function findHeader(headers: readonly Header[], name: string): string | undefined {
	const lower = name.toLowerCase();
	return headers.find(([n]) => n.toLowerCase() === lower)?.[1];
}

export function hasHeader(headers: readonly Header[], name: string): boolean {
	return findHeader(headers, name) !== undefined;
}

export function setHeader(headers: Header[], name: string, value: string): void {
	const lower = name.toLowerCase();
	const i = headers.findIndex(([n]) => n.toLowerCase() === lower);
	if (i >= 0) headers[i] = [name, value];
	else headers.push([name, value]);
}
