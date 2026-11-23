import { createHash } from "node:crypto";
import { get } from "node:http";
import { describe, expect, it } from "vitest";
import { authenticate, md4, negotiate, ntowfV2, parseChallenge, responses } from "../src/core/auth/ntlm";
import { authorizationUrl, listen, pkce } from "../src/core/auth/oauth2-browser";
import { signRequest, type Signable } from "../src/core/auth/sign";
import { findHeader } from "../src/core/headers";
import type { Header } from "../src/core/model";
import { flattenPostmanAuth, toPostmanAuth } from "../src/core/storage/sidecar";

const at = (now: number, nonce = "") => ({ now, nonce });
const signable = (method: string, url: string, headers: Header[] = [], body = ""): Signable => ({ method, url, headers, body: new TextEncoder().encode(body) });

describe("signing", () => {
	it("matches Twitter's OAuth 1.0 HMAC-SHA1 example", () => {
		const r = signable("POST", "https://api.twitter.com/1.1/statuses/update.json?include_entities=true", [["Content-Type", "application/x-www-form-urlencoded"]], "status=Hello%20Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21");
		signRequest(
			{
				type: "oauth1",
				consumerKey: "xvz1evFS4wEEPTGEFPHBog",
				consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
				accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
				accessTokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
				signatureMethod: "HMAC-SHA1",
				timestamp: "1318622958",
				nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
			},
			r,
			at(0),
		);
		const value = findHeader(r.headers, "authorization")!;
		expect(value.startsWith('OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"')).toBe(true);
		expect(value).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
	});

	it("matches the AWS SigV4 suite's get-vanilla", () => {
		const r = signable("GET", "https://example.amazonaws.com/");
		signRequest({ type: "awsv4", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", region: "us-east-1", service: "service" }, r, at(1_440_938_160));
		expect(findHeader(r.headers, "x-amz-date")).toBe("20150830T123600Z");
		expect(findHeader(r.headers, "authorization")).toBe(
			"AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
		);
	});

	it("matches the Hawk README's examples", () => {
		const auth = { type: "hawk", authId: "dh37fgj492je", authKey: "werxhqb98rpaxn39848xrunpaw3489ruxnpa98w4rxn", algorithm: "sha256", timestamp: "1353832234", nonce: "j4h3g2", extraData: "some-app-ext-data" };
		const r = signable("GET", "http://example.com:8000/resource/1?b=1&a=2");
		signRequest(auth, r, at(0));
		expect(findHeader(r.headers, "authorization")).toBe('Hawk id="dh37fgj492je", ts="1353832234", nonce="j4h3g2", ext="some-app-ext-data", mac="6R4rV5iE+NPoym+WwjeHzjAGXUtLNIxmo1vpMofpLAE="');
		const p = signable("POST", "http://example.com:8000/resource/1?b=1&a=2", [["Content-Type", "text/plain"]], "Thank you for flying Hawk");
		signRequest({ ...auth, includePayloadHash: true }, p, at(0));
		const value = findHeader(p.headers, "authorization")!;
		expect(value).toContain('hash="Yi9LfIIFRtBEPt74PVmbTF/xVAwPn7ub15ePICfgnuY="');
		expect(value).toContain('mac="aSe1DERmZuRl3pI36/9BdZmnErTw3sNzOOAUlfeKjVw="');
	});

	it("matches jwt.io's HS256 example", () => {
		const auth = { type: "jwt", algorithm: "HS256", secret: "your-256-bit-secret", payload: '{"sub":"1234567890","name":"John Doe","iat":1516239022}' };
		const r = signable("GET", "https://x.test/");
		signRequest(auth, r, at(0));
		expect(findHeader(r.headers, "authorization")).toBe(
			"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
		);
		const q = signable("GET", "https://x.test/a?b=1");
		signRequest({ ...auth, addTokenTo: "queryParam" }, q, at(0));
		expect(q.url.startsWith("https://x.test/a?b=1&token=eyJ")).toBe(true);
	});

	it("gives EdgeGrid, WSSE and ASAP their shapes", () => {
		const e = signable("POST", "https://akab.luna.akamaiapis.net/path?x=1", [], "{}");
		signRequest({ type: "edgegrid", accessToken: "at", clientToken: "ct", clientSecret: "cs", nonce: "n-1", timestamp: "20260101T00:00:00+0000" }, e, at(0));
		const value = findHeader(e.headers, "authorization")!;
		expect(value.startsWith("EG1-HMAC-SHA256 client_token=ct;access_token=at;timestamp=20260101T00:00:00+0000;nonce=n-1;signature=")).toBe(true);
		expect(value.split("signature=").pop()).toHaveLength(44);

		const w = signable("GET", "https://x.test/");
		signRequest({ type: "wsse", username: "u", password: "p" }, w, at(0, "abc"));
		expect(findHeader(w.headers, "authorization")).toBe('WSSE profile="UsernameToken"');
		expect(findHeader(w.headers, "x-wsse")).toContain('Created="1970-01-01T00:00:00Z"');

		expect(() => signRequest({ type: "asap", issuer: "i", audience: "a", kid: "k", privateKey: "" }, signable("GET", "https://x.test/"), at(0))).toThrow("The private key isn't PEM (-----BEGIN ...).");
	});

	it("round-trips Postman's auth form through the flat one", () => {
		const raw = { type: "hawk", hawk: [{ key: "authId", value: "id", type: "string" }, { key: "includePayloadHash", value: true, type: "boolean" }] };
		const flat = flattenPostmanAuth(raw);
		expect(flat).toEqual({ type: "hawk", authId: "id", includePayloadHash: true });
		expect(toPostmanAuth(flat)).toEqual(raw);
	});
});

describe("NTLM", () => {
	const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

	it("computes MD4 as RFC 1320 does", () => {
		expect(hex(md4(new Uint8Array()))).toBe("31d6cfe0d16ae931b73c59d7e0c089c0");
		expect(hex(md4(Buffer.from("abc")))).toBe("a448017aaf21d8525fc10ae87aa6729d");
		expect(hex(md4(Buffer.from("12345678901234567890123456789012345678901234567890123456789012345678901234567890")))).toBe("e33b4ddc9c38f2199c3e7b164fcc0536");
	});

	it("matches MS-NLMP 4.2.4's NTLMv2 example", () => {
		expect(hex(md4(Buffer.from("Password", "utf16le")))).toBe("a4f49c406510bdcab6824ee7c30fd852");
		const key = ntowfV2("User", "Password", "Domain");
		expect(hex(key)).toBe("0c868a403bfd7a93a3001ef22ef02e3f");
		const targetInfo = Buffer.concat([Buffer.from([0x02, 0, 0x0c, 0]), Buffer.from("Domain", "utf16le"), Buffer.from([0x01, 0, 0x0c, 0]), Buffer.from("Server", "utf16le"), Buffer.alloc(4)]);
		const { nt } = responses(key, { serverChallenge: Buffer.from("0123456789abcdef", "hex"), targetInfo, flags: 0 }, Buffer.alloc(8, 0xaa), 0n);
		expect(hex(nt.subarray(0, 16))).toBe("68cd0ab851e51c96aabc927bebef6a1c");
	});

	it("builds and reads its messages", () => {
		expect(negotiate().subarray(0, 8).toString("latin1")).toBe("NTLMSSP\0");
		const type2 = Buffer.concat([Buffer.from("NTLMSSP\0", "latin1"), Buffer.from([2, 0, 0, 0]), Buffer.alloc(8), Buffer.from([0x05, 0x82, 0x88, 0xa2]), Buffer.alloc(8, 9), Buffer.alloc(8), Buffer.from([4, 0, 4, 0, 48, 0, 0, 0]), Buffer.alloc(4)]);
		const challenge = parseChallenge(type2)!;
		expect(challenge.serverChallenge).toEqual(Buffer.alloc(8, 9));
		const message = authenticate({ username: "u", password: "p", domain: "D", workstation: "W" }, challenge, Buffer.alloc(8, 1), 1n);
		expect(message.readUInt32LE(8)).toBe(3);
		expect(message.length).toBeGreaterThan(64);
	});
});

/** Requests a page as the browser would after the redirect; resolves to its text. */
const visit = (url: string) =>
	new Promise<string>((resolve, reject) => {
		get(url, (res) => {
			let body = "";
			res.on("data", (c: Buffer) => (body += c.toString()));
			res.on("end", () => resolve(body));
		}).on("error", reject);
	});

describe("OAuth 2.0 in the browser", () => {
	it("hashes the PKCE verifier", () => {
		const p = pkce(false);
		expect(p.method).toBe("S256");
		expect(p.verifier.length).toBeGreaterThanOrEqual(43);
		expect(p.challenge).toBe(createHash("sha256").update(p.verifier).digest("base64url"));
		const plain = pkce(true);
		expect(plain).toMatchObject({ method: "plain", challenge: plain.verifier });
	});

	it("catches the redirect and checks its state", async () => {
		const callback = await listen(undefined);
		expect(callback.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
		const url = authorizationUrl({ type: "oauth2", flow: "authorization_code", authorizationUrl: "https://id.test/authorize", credentials: { clientId: "c" }, scope: "read" }, "code", callback.redirectUri, "s1");
		expect(url).toContain("response_type=code&client_id=c&redirect_uri=http%3A%2F%2F127.0.0.1");
		const waiting = callback.wait("s1");
		const page = await visit(`${callback.redirectUri}?code=abc&state=s1`);
		expect(page).toContain("Signed in");
		expect((await waiting).get("code")).toBe("abc");

		const other = await listen(undefined);
		const refused = expect(other.wait("expected")).rejects.toThrow("different state");
		await visit(`${other.redirectUri}?code=abc&state=forged`);
		await refused;
		await expect(listen("https://example.com/cb")).rejects.toThrow("must be http://127.0.0.1");
	});
});
