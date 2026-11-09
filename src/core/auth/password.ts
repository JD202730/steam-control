/**
 * Hash de contraseñas con PBKDF2-SHA256 (Web Crypto). Formato: pbkdf2$iter$sal$hash (base64).
 * Nunca se guardan contraseñas en claro. Ojo: al ser una app 100% en el navegador esto protege
 * los datos almacenados, pero no equivale a la seguridad de un servidor (ver README).
 */
const ITERATIONS = 100_000
const KEY_BITS = 256

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_BITS)
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, expected] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iterations || !salt || !expected) return false
  const actual = await derive(password, fromBase64(salt), Number(iterations))
  const wanted = fromBase64(expected)
  if (actual.length !== wanted.length) return false
  // Comparación en tiempo constante.
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ wanted[i]
  return diff === 0
}
