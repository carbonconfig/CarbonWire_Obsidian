import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { digestAuthorization, parseDigestChallenge } from "../src/core/auth/digest";
import { OAuth2Tokens, tokenPlacement } from "../src/core/auth/oauth2";
import type { Auth } from "../src/core/model";
import { buildRequest } from "../src/core/request-builder";
import { sendRequest, type SendContext } from "../src/core/sender";
import { NodeTransport } from "../src/core/transport/node";

describe("digest", () => {
	it("matches the RFC 2617 example", () => {
		const challenge = parseDigestChallenge(
			'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
		)!;
		const header = digestAuthorization(challenge, {
			username: "Mufasa",
			password: "Circle Of Life",
			method: "GET",
			uri: "/dir/index.html",
			cnonce: "0a4f113b",
			nc: 1,
		});
		expect(header).toContain('response="6629fae49393a05397450978507c4ef1"');
		expect(header).toContain("qop=auth, nc=00000001");
		expect(header).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
	});

	it("ignores non-digest challenges", () => {
		expect(parseDigestChallenge('Basic realm="x"')).toBeUndefined();
	});
});

describe("tokenPlacement", () => {
	const token = { accessToken: "at", idToken: "it" };
	it("defaults to a Bearer Authorization header and honours prefix, query and id_token", () => {
		expect(tokenPlacement({ type: "oauth2", flow: "client_credentials" }, token)).toEqual({ header: ["Authorization", "Bearer at"] });
		expect(tokenPlacement({ type: "oauth2", flow: "client_credentials", tokenConfig: { placement: { header: "" } } }, token)).toEqual({ header: ["Authorization", "at"] });
		expect(tokenPlacement({ type: "oauth2", flow: "client_credentials", tokenConfig: { placement: { query: "key" }, source: "id_token" } }, token)).toEqual({ query: ["key", "it"] });
	});
});

let server: http.Server;
let base: string;
let tokenRequests: { auth?: string; body: string }[] = [];
const transport = new NodeTransport();

beforeAll(async () => {
	server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			const body = Buffer.concat(chunks).toString();
			if (req.url === "/token") {
				tokenRequests.push({ auth: req.headers.authorization, body });
				const params = new URLSearchParams(body);
				if (params.get("client_id") === "bad") {
					res.writeHead(401, { "Content-Type": "application/json" }).end('{"error":"invalid_client"}');
					return;
				}
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify({ access_token: `tok${tokenRequests.length}`, expires_in: 3600, token_type: "Bearer" }));
			} else if (req.url === "/digest") {
				const auth = req.headers.authorization;
				if (auth?.startsWith("Digest ") && auth.includes('username="u"')) res.end("digest ok");
				else res.writeHead(401, { "WWW-Authenticate": 'Digest realm="r", nonce="n1", qop="auth"' }).end();
			} else {
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify({ url: req.url, authorization: req.headers.authorization, contentType: req.headers["content-type"], body }));
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
	transport.dispose();
	server.close();
});

function context(oauth2 = new OAuth2Tokens(transport)): SendContext {
	return {
		transport,
		oauth2,
		readFile: async (p) => new TextEncoder().encode(`file:${p}`),
		rejectUnauthorized: true,
		maxBodyBytes: 1_000_000,
	};
}

async function send(auth: Auth | undefined, ctx = context(), body?: { type: "json"; data: string }) {
	const resolved = buildRequest({ http: { method: body ? "POST" : "GET", url: `${base}/echo`, auth, body } }, [], new Map([["secret", "s3"]]));
	const result = await sendRequest(resolved, ctx);
	return JSON.parse(new TextDecoder().decode(result.response.body)) as { url: string; authorization?: string; contentType?: string; body: string };
}

describe("sendRequest", () => {
	it("fetches an OAuth 2.0 client-credentials token once and reuses it", async () => {
		tokenRequests = [];
		const auth: Auth = {
			type: "oauth2",
			flow: "client_credentials",
			accessTokenUrl: `${base}/token`,
			credentials: { clientId: "id", clientSecret: "{{secret}}" },
			scope: "read",
		};
		const ctx = context();
		expect((await send(auth, ctx)).authorization).toBe("Bearer tok1");
		expect((await send(auth, ctx)).authorization).toBe("Bearer tok1");
		expect(tokenRequests).toHaveLength(1);
		expect(tokenRequests[0]!.auth).toBe(`Basic ${Buffer.from("id:s3").toString("base64")}`);
		expect(new URLSearchParams(tokenRequests[0]!.body).get("grant_type")).toBe("client_credentials");
		expect(new URLSearchParams(tokenRequests[0]!.body).get("scope")).toBe("read");
	});

	it("sends password-flow credentials in the body when configured and places the token in the query", async () => {
		tokenRequests = [];
		const auth: Auth = {
			type: "oauth2",
			flow: "resource_owner_password_credentials",
			accessTokenUrl: `${base}/token`,
			credentials: { clientId: "id", placement: "body" },
			resourceOwner: { username: "alice", password: "pw" },
			tokenConfig: { placement: { query: "access_token" } },
		};
		const echoed = await send(auth);
		expect(echoed.url).toBe("/echo?access_token=tok1");
		const form = new URLSearchParams(tokenRequests[0]!.body);
		expect([form.get("grant_type"), form.get("username"), form.get("client_id")]).toEqual(["password", "alice", "id"]);
		expect(tokenRequests[0]!.auth).toBeUndefined();
	});

	it("reports token endpoint errors", async () => {
		const auth: Auth = { type: "oauth2", flow: "client_credentials", accessTokenUrl: `${base}/token`, credentials: { clientId: "bad", placement: "body" } };
		await expect(send(auth)).rejects.toThrow("Token request failed (401): invalid_client");
	});

	it("answers a digest challenge with a second request", async () => {
		const resolved = buildRequest({ http: { url: `${base}/digest`, auth: { type: "digest", username: "u", password: "p" } } }, [], new Map());
		const result = await sendRequest(resolved, context());
		expect(result.response.status).toBe(200);
		expect(result.sent.headers.find(([n]) => n === "Authorization")?.[1]).toMatch(/^Digest username="u"/);
	});

	it("encodes the body and sets its content type", async () => {
		const echoed = await send(undefined, context(), { type: "json", data: '{"a":1}' });
		expect(echoed.contentType).toBe("application/json");
		expect(echoed.body).toBe('{"a":1}');
	});
});
