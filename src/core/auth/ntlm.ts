import { createHmac, randomBytes } from "node:crypto";

/*
 * NTLMv2 (MS-NLMP): the negotiate message, the server's challenge, and the authenticate message.
 * MD4 is written in, since Node's OpenSSL 3 and Electron's BoringSSL don't reliably offer it.
 */

const SIGNATURE = Buffer.from("NTLMSSP\0", "latin1");
// Unicode, OEM, request target, NTLM, always sign, extended session security, 128, 56.
const FLAGS = (0x00000001 | 0x00000002 | 0x00000004 | 0x00000200 | 0x00008000 | 0x00080000 | 0x20000000 | 0x80000000) >>> 0;

/** MD4 (RFC 1320). */
export function md4(input: Uint8Array): Buffer {
	const f = (x: number, y: number, z: number) => (x & y) | (~x & z);
	const g = (x: number, y: number, z: number) => (x & y) | (x & z) | (y & z);
	const h = (x: number, y: number, z: number) => x ^ y ^ z;
	const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
	const padded = Math.ceil((input.length + 9) / 64) * 64;
	const message = Buffer.alloc(padded);
	message.set(input);
	message[input.length] = 0x80;
	message.writeUInt32LE((input.length * 8) >>> 0, padded - 8);
	message.writeUInt32LE(Math.floor((input.length * 8) / 2 ** 32), padded - 4);
	const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
	const x = new Array<number>(16);
	for (let offset = 0; offset < padded; offset += 64) {
		for (let i = 0; i < 16; i++) x[i] = message.readUInt32LE(offset + i * 4);
		let [a, b, c, d] = state as [number, number, number, number];
		for (const i of [0, 4, 8, 12]) {
			a = rotl((a + f(b, c, d) + x[i]!) | 0, 3);
			d = rotl((d + f(a, b, c) + x[i + 1]!) | 0, 7);
			c = rotl((c + f(d, a, b) + x[i + 2]!) | 0, 11);
			b = rotl((b + f(c, d, a) + x[i + 3]!) | 0, 19);
		}
		for (const i of [0, 1, 2, 3]) {
			const k = 0x5a827999;
			a = rotl((a + g(b, c, d) + x[i]! + k) | 0, 3);
			d = rotl((d + g(a, b, c) + x[i + 4]! + k) | 0, 5);
			c = rotl((c + g(d, a, b) + x[i + 8]! + k) | 0, 9);
			b = rotl((b + g(c, d, a) + x[i + 12]! + k) | 0, 13);
		}
		for (const i of [0, 2, 1, 3]) {
			const k = 0x6ed9eba1;
			a = rotl((a + h(b, c, d) + x[i]! + k) | 0, 3);
			d = rotl((d + h(a, b, c) + x[i + 8]! + k) | 0, 9);
			c = rotl((c + h(d, a, b) + x[i + 4]! + k) | 0, 11);
			b = rotl((b + h(c, d, a) + x[i + 12]! + k) | 0, 15);
		}
		state[0] = (state[0]! + a) | 0;
		state[1] = (state[1]! + b) | 0;
		state[2] = (state[2]! + c) | 0;
		state[3] = (state[3]! + d) | 0;
	}
	const out = Buffer.alloc(16);
	state.forEach((word, i) => out.writeUInt32LE(word >>> 0, i * 4));
	return out;
}

const hmacMd5 = (key: Uint8Array, data: Uint8Array) => createHmac("md5", key).update(data).digest();
const utf16 = (text: string) => Buffer.from(text, "utf16le");

/** The negotiate (type 1) message. */
export function negotiate(): Buffer {
	const m = Buffer.alloc(32);
	SIGNATURE.copy(m, 0);
	m.writeUInt32LE(1, 8);
	m.writeUInt32LE(FLAGS, 12);
	return m;
}

export interface Challenge {
	serverChallenge: Buffer;
	targetInfo: Buffer;
	flags: number;
}

/** Reads a challenge (type 2) message. */
export function parseChallenge(message: Buffer): Challenge | undefined {
	if (message.length < 32 || !message.subarray(0, 8).equals(SIGNATURE) || message.readUInt32LE(8) !== 2) return undefined;
	const flags = message.readUInt32LE(20);
	const serverChallenge = Buffer.from(message.subarray(24, 32));
	let targetInfo = Buffer.alloc(0);
	if (message.length >= 48) {
		const len = message.readUInt16LE(40);
		const offset = message.readUInt32LE(44);
		if (offset + len > message.length) return undefined;
		targetInfo = Buffer.from(message.subarray(offset, offset + len));
	}
	return { serverChallenge, targetInfo, flags };
}

/** NTOWFv2: HMAC-MD5 of the user and domain, keyed by the password's MD4. */
export function ntowfV2(username: string, password: string, domain: string): Buffer {
	return hmacMd5(md4(utf16(password)), utf16(`${username.toUpperCase()}${domain}`));
}

/** The LMv2 and NTLMv2 responses for a challenge. */
export function responses(key: Buffer, challenge: Challenge, clientChallenge: Buffer, timestamp: bigint): { lm: Buffer; nt: Buffer } {
	const time = Buffer.alloc(8);
	time.writeBigUInt64LE(timestamp);
	const blob = Buffer.concat([Buffer.from([1, 1, 0, 0, 0, 0, 0, 0]), time, clientChallenge, Buffer.alloc(4), challenge.targetInfo, Buffer.alloc(4)]);
	const proof = hmacMd5(key, Buffer.concat([challenge.serverChallenge, blob]));
	const lm = Buffer.concat([hmacMd5(key, Buffer.concat([challenge.serverChallenge, clientChallenge])), clientChallenge]);
	return { lm, nt: Buffer.concat([proof, blob]) };
}

export interface NtlmCredentials {
	username: string;
	password: string;
	domain: string;
	workstation: string;
}

/** Windows FILETIME: 100 ns since 1601. */
export function filetime(epochMs: number): bigint {
	return BigInt(epochMs) * 10_000n + 116_444_736_000_000_000n;
}

/** The authenticate (type 3) message. */
export function authenticate(credentials: NtlmCredentials, challenge: Challenge, clientChallenge = randomBytes(8), timestamp = filetime(Date.now())): Buffer {
	const key = ntowfV2(credentials.username, credentials.password, credentials.domain);
	const { lm, nt } = responses(key, challenge, clientChallenge, timestamp);
	const fields = [lm, nt, utf16(credentials.domain), utf16(credentials.username), utf16(credentials.workstation), Buffer.alloc(0)];
	const header = Buffer.alloc(64);
	SIGNATURE.copy(header, 0);
	header.writeUInt32LE(3, 8);
	let offset = 64;
	fields.forEach((f, i) => {
		header.writeUInt16LE(f.length, 12 + i * 8);
		header.writeUInt16LE(f.length, 14 + i * 8);
		header.writeUInt32LE(offset, 16 + i * 8);
		offset += f.length;
	});
	header.writeUInt32LE(((challenge.flags & FLAGS) | 0x00000001) >>> 0, 60);
	return Buffer.concat([header, ...fields]);
}

/** The challenge from a 401's WWW-Authenticate: NTLM <base64> headers. */
export function challengeFromHeaders(values: readonly string[]): Challenge | undefined {
	for (const value of values) {
		const m = /^\s*NTLM\s+([A-Za-z0-9+/=]+)\s*$/i.exec(value);
		if (m) return parseChallenge(Buffer.from(m[1]!, "base64"));
	}
	return undefined;
}
