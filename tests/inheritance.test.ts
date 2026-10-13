import { describe, expect, it } from "vitest";
import { mergeHeaders, resolveAuth, resolveSettings } from "../src/core/inheritance";
import type { DefaultsChain } from "../src/core/model";

describe("resolveAuth", () => {
	const chain: DefaultsChain = [
		{ auth: { type: "bearer", token: "collection" } },
		{ auth: { type: "basic", username: "folder" } },
		{ auth: "inherit" },
		undefined,
	];

	it("uses the request's own auth", () => {
		expect(resolveAuth({ type: "apikey", key: "k" }, chain)).toEqual({ type: "apikey", key: "k" });
	});

	it("treats a missing request auth as no auth", () => {
		expect(resolveAuth(undefined, chain)).toBeUndefined();
	});

	it("walks up past inheriting folders and folders without a folder.yml", () => {
		expect(resolveAuth("inherit", chain)).toEqual({ type: "basic", username: "folder" });
		expect(resolveAuth("inherit", [chain[0], { auth: "inherit" }, undefined])).toEqual({ type: "bearer", token: "collection" });
		expect(resolveAuth("inherit", [])).toBeUndefined();
	});

	it("stops at a folder whose folder.yml has no auth, as Bruno does", () => {
		expect(resolveAuth("inherit", [chain[0], { headers: [] }])).toBeUndefined();
	});
});

describe("mergeHeaders", () => {
	it("lets inner levels override outer headers case-insensitively and skips disabled ones", () => {
		const chain: DefaultsChain = [
			{ headers: [{ name: "X-Tenant", value: "acme" }, { name: "Accept", value: "text/plain" }] },
			{ headers: [{ name: "accept", value: "application/json" }, { name: "X-Off", value: "1", disabled: true }] },
		];
		expect(mergeHeaders(chain, [{ name: "X-Req", value: "r" }])).toEqual([
			["X-Tenant", "acme"],
			["accept", "application/json"],
			["X-Req", "r"],
		]);
	});
});

describe("resolveSettings", () => {
	it("falls back through inherit to defaults", () => {
		const settings = resolveSettings([{ settings: { http: { timeout: 5000, followRedirects: false } } }], { timeout: "inherit", maxRedirects: 2 });
		expect(settings).toMatchObject({ timeout: 5000, followRedirects: false, maxRedirects: 2, encodeUrl: true });
	});
});
