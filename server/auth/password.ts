import argon2 from "argon2";
import { appConfig } from "../../lib/config.ts";

const passwordOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
let dummyHash: Promise<string> | undefined;
let activeHashes = 0;
const waiting: Array<() => void> = [];

async function bounded<T>(work: () => Promise<T>): Promise<T> {
  if (activeHashes >= 4) {
    if (waiting.length >= 16) throw new Error("Password service busy");
    await new Promise<void>((resolve, reject) => {
      const grant = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        const index = waiting.indexOf(grant);
        if (index >= 0) waiting.splice(index, 1);
        reject(new Error("Password service busy"));
      }, 10_000);
      waiting.push(grant);
    });
  } else {
    activeHashes += 1;
  }
  try { return await work(); }
  finally {
    const next = waiting.shift();
    if (next) next(); else activeHashes -= 1;
  }
}

export function validatePassword(value: string): string {
  const normalized = value.normalize("NFC");
  if (normalized.length < appConfig.auth.passwordMinLength || Buffer.byteLength(normalized, "utf8") > appConfig.auth.passwordMaxLength) throw new Error("Invalid password");
  return normalized;
}

export function hashPassword(password: string) { return bounded(() => argon2.hash(validatePassword(password), passwordOptions)); }
export function verifyPassword(hash: string, password: string) { return bounded(() => argon2.verify(hash, password.normalize("NFC"))); }
export async function verifyUnknownPassword(password: string) {
  dummyHash ??= bounded(() => argon2.hash("a fixed dummy password for timing", passwordOptions)).catch((error: unknown) => { dummyHash = undefined; throw error; });
  const hash = await dummyHash;
  await bounded(() => argon2.verify(hash, password.normalize("NFC")));
}
