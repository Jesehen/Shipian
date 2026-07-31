const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase, salt) {
  const sourceKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 210_000,
      hash: "SHA-256"
    },
    sourceKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptBytes(bytes, passphrase) {
  if (!passphrase || passphrase.length < 8) throw new Error("加密口令至少需要 8 位");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes)
  );
  return JSON.stringify({
    v: 1,
    alg: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: 210000,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(cipher)
  });
}

export async function decryptBytes(envelopeText, passphrase) {
  const envelope = JSON.parse(envelopeText);
  if (envelope.v !== 1) throw new Error("暂不支持这个加密版本");
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const cipher = base64ToBytes(envelope.data);
  const key = await deriveKey(passphrase, salt);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new Uint8Array(plain);
}

export async function encryptJson(value, passphrase) {
  return encryptBytes(encoder.encode(JSON.stringify(value)), passphrase);
}

export async function decryptJson(value, passphrase) {
  return JSON.parse(decoder.decode(await decryptBytes(value, passphrase)));
}
