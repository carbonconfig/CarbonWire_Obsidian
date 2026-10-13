import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { requestFromCurl } from "../src/core/import/curl";
import type { TransportResponse } from "../src/core/transport/types";
import { HistoryStore } from "../src/obsidian/history";
import { dayLabel } from "../src/ui/format";

let dbCount = 0;
const response = (body: Uint8Array): TransportResponse => ({
	url: "https://x.test/",
	status: 200,
	statusText: "OK",
	httpVersion: "1.1",
	headers: [["content-type", "application/json"]],
	body,
	bodyBytes: body.byteLength,
	truncated: false,
	timings: { dns: 0, connect: 0, tls: 0, wait: 1, download: 1, total: 2, reusedConnection: false },
	redirects: [],
});

function store(limit: number) {
	const state = { limit, changes: 0 };
	const history = new HistoryStore(`test-${dbCount++}`, () => state.limit, () => state.changes++);
	return { history, state };
}

describe("HistoryStore", () => {
	it("keeps the newest entries up to the limit, with their bodies", async () => {
		const { history } = store(2);
		for (const name of ["a", "b", "c"]) {
			await history.add({ time: Date.now(), name, request: { http: { url: `https://x.test/${name}` } }, response: response(new TextEncoder().encode(name)) });
		}
		const entries = await history.list();
		expect(entries.map((e) => e.name)).toEqual(["c", "b"]);
		const found = await history.get(entries[0]!.id);
		expect(new TextDecoder().decode(found!.body)).toBe("c");
		expect(found!.entry.response).toMatchObject({ status: 200, bodyBytes: 1, truncated: false });
	});

	it("caps stored bodies, records errors, and prunes when the limit drops", async () => {
		const { history, state } = store(10);
		await history.add({ time: 1, name: "big", request: {}, response: response(new Uint8Array(2 * 1024 * 1024)) });
		await history.add({ time: 2, name: "failed", request: {}, error: "ECONNREFUSED" });
		const [failed, big] = await history.list();
		expect(failed).toMatchObject({ name: "failed", error: "ECONNREFUSED", response: undefined });
		expect(big!.response).toMatchObject({ bodyBytes: 2 * 1024 * 1024, truncated: true });
		expect((await history.get(big!.id))!.body.byteLength).toBe(1024 * 1024);

		state.limit = 1;
		await history.prune();
		expect((await history.list()).map((e) => e.name)).toEqual(["failed"]);
		await history.clear();
		expect(await history.list()).toEqual([]);
		expect(state.changes).toBeGreaterThan(0);
	});

	it("finds a request's latest send and follows renames of the request or its folder", async () => {
		const { history } = store(10);
		await history.add({ time: 1, name: "old", source: "API/Users/get.yml", request: {}, response: response(new Uint8Array()) });
		await history.add({ time: 2, name: "other", source: "API/ping.yml", request: {} });
		await history.add({ time: 3, name: "new", source: "API/Users/get.yml", request: {}, error: "timeout" });
		expect((await history.latestFor("API/Users/get.yml"))?.name).toBe("new");

		await history.moveSource("API/Users/get.yml", "API/Users/list.yml");
		await history.moveSource("API/Users", "API/People");
		expect((await history.latestFor("API/People/list.yml"))?.name).toBe("new");
		expect(await history.latestFor("API/Users/get.yml")).toBeUndefined();
		expect((await history.latestFor("API/ping.yml"))?.name).toBe("other");
	});

	it("records nothing when history is off", async () => {
		const { history } = store(0);
		await history.add({ time: 1, name: "x", request: {} });
		expect(await history.list()).toEqual([]);
	});
});

describe("pasting cURL", () => {
	it("gives the request and a name", () => {
		const { name, request } = requestFromCurl(`curl -X POST https://api.test/users -H 'Content-Type: application/json' -d '{"a":1}'`);
		expect(name).toBeTruthy();
		expect(request.http).toMatchObject({ method: "POST", url: "https://api.test/users", body: { type: "json", data: '{"a":1}' } });
	});
});

describe("dayLabel", () => {
	it("names today and yesterday", () => {
		const now = new Date(2026, 9, 12, 15).getTime();
		expect(dayLabel(new Date(2026, 9, 12, 1).getTime(), now)).toBe("Today");
		expect(dayLabel(new Date(2026, 9, 11, 23).getTime(), now)).toBe("Yesterday");
		expect(dayLabel(new Date(2026, 9, 1).getTime(), now)).not.toMatch(/Today|Yesterday/);
	});
});
