import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, test } from "vitest";
import { NodeTransport } from "../../src/core/transport/node";
import { measure, report } from "./measure";

let server: http.Server;
let url = "";
const transport = new NodeTransport();
const agent = new http.Agent({ keepAlive: true });

beforeAll(async () => {
	server = http.createServer((_req, res) => res.end('{"ok":true}'));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => {
	transport.dispose();
	agent.destroy();
	server.close();
});

function plainGet(): Promise<void> {
	return new Promise((resolve, reject) => {
		http.get(url, { agent }, (res) => {
			res.resume();
			res.on("end", resolve);
		}).on("error", reject);
	});
}

test("benchmarks", async () => {
	report("GET to a local server over a kept-alive connection", [
		await measure("Node's http module directly", plainGet),
		await measure("CarbonWire transport (timings, decompression, size cap)", () =>
			transport.send({
				method: "GET",
				url,
				headers: [],
				timeoutMs: 0,
				followRedirects: true,
				maxRedirects: 5,
				forwardAuthorizationHeader: false,
				rejectUnauthorized: true,
				maxBodyBytes: 20 * 1024 * 1024,
			}),
		),
	]);
}, 60_000);
