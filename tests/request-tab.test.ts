import { describe, expect, it } from "vitest";
import type { HttpRequestDetails } from "../src/core/model";
import { initialTab } from "../src/ui/request-tab";

describe("The tab a request opens on", () => {
	const base: HttpRequestDetails = { method: "GET", url: "https://example.com" };
	const params = [{ name: "q", value: "1", type: "query" as const }];
	const headers = [{ name: "Accept", value: "*/*" }];

	it("prefers Body, then Params, Auth and Headers", () => {
		const all: HttpRequestDetails = { ...base, body: { type: "json", data: "{}" }, params, auth: { type: "bearer", token: "t" }, headers };
		expect(initialTab(all)).toBe("body");
		expect(initialTab({ ...all, body: undefined })).toBe("params");
		expect(initialTab({ ...all, body: undefined, params: [] })).toBe("auth");
		expect(initialTab({ ...all, body: undefined, params: [], auth: "inherit" })).toBe("headers");
	});

	it("skips empty bodies and falls back to Params", () => {
		expect(initialTab(base)).toBe("params");
		expect(initialTab(undefined)).toBe("params");
		expect(initialTab({ ...base, body: { type: "json", data: "  \n" }, headers })).toBe("headers");
		expect(initialTab({ ...base, body: { type: "form-urlencoded", data: [] }, headers: [{ name: "", value: "" }] })).toBe("params");
	});

	it("looks at the selected body variant", () => {
		const body = [
			{ title: "Empty", body: { type: "text" as const, data: "" } },
			{ title: "Full", selected: true, body: { type: "text" as const, data: "hi" } },
		];
		expect(initialTab({ ...base, body })).toBe("body");
		expect(initialTab({ ...base, body: [{ ...body[0]!, selected: true }, { ...body[1]!, selected: false }] })).toBe("params");
	});
});
