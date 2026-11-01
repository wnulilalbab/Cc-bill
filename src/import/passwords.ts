// "Remember" for locked PDFs (phase-1 §4, I-04): the password is stored encrypted (AES-GCM) on this device only.
// The key is a non-extractable CryptoKey kept in IndexedDB (the meta table): the browser can use it but never
// reveals it, and the meta table is not part of the JSON backup.
import type { NewDb } from '../data/db'
import { pdfPasswordKey } from '../data/deviceSecrets'

const KEY_ID = 'pdf-password-key'
export { PDF_PASSWORD_PREFIX as PASSWORD_PREFIX } from '../data/deviceSecrets'

interface Sealed {
  iv: Uint8Array<ArrayBuffer>
  data: ArrayBuffer
}

async function deviceKey(db: NewDb): Promise<CryptoKey> {
  const stored = (await db.meta.get(KEY_ID))?.value as CryptoKey | undefined
  if (stored) return stored
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await db.meta.put({ key: KEY_ID, value: key })
  return key
}

export async function rememberPassword(db: NewDb, cardId: string, password: string): Promise<void> {
  const key = await deviceKey(db)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(password))
  const sealed: Sealed = { iv, data }
  await db.meta.put({ key: pdfPasswordKey(cardId), value: sealed })
}

/** The remembered password of a card, or null (none, or it can no longer be decrypted). */
export async function recallPassword(db: NewDb, cardId: string): Promise<string | null> {
  const sealed = (await db.meta.get(pdfPasswordKey(cardId)))?.value as Sealed | undefined
  const key = (await db.meta.get(KEY_ID))?.value as CryptoKey | undefined
  if (!sealed || !key) return null
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.data))
  } catch {
    return null
  }
}

/** True when this card has a remembered password (without decrypting it). */
export async function hasPassword(db: NewDb, cardId: string): Promise<boolean> {
  return (await db.meta.get(pdfPasswordKey(cardId))) !== undefined
}

export async function forgetPassword(db: NewDb, cardId: string): Promise<void> {
  await db.meta.delete(pdfPasswordKey(cardId))
}
