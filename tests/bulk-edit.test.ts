import { describe, expect, it } from "vitest";
import { fromBulkText, toBulkText } from "../src/core/bulk-edit";

describe("bulk edit", () => {
	it("writes one line per row, disabled ones commented, empty ones left out", () => {
		expect(toBulkText([{ name: "Accept", value: "application/json" }, { name: "X-Debug", value: "1", disabled: true }, { name: "", value: "" }])).toBe("Accept: application/json\n// X-Debug: 1");
	});

	it("reads lines back, splitting at the first colon", () => {
		expect(fromBulkText("Accept: application/json\n\n  // X-Debug: 1\nurl: https://x.test:8443/a\nflag\n  Authorization:Bearer {{token}}  ")).toEqual([
			{ name: "Accept", value: "application/json" },
			{ name: "X-Debug", value: "1", disabled: true },
			{ name: "url", value: "https://x.test:8443/a" },
			{ name: "flag", value: "" },
			{ name: "Authorization", value: "Bearer {{token}}" },
		]);
	});

	it("round-trips what it writes", () => {
		const rows = [{ name: "a", value: "1" }, { name: "b", value: "x: y", disabled: true }];
		expect(fromBulkText(toBulkText(rows))).toEqual(rows);
	});
});
