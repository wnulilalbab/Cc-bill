import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { freshNewDb } from '../../test/data/oldDb'
import { exportNewBackup } from '../data/backup'
import { forgetPassword, PASSWORD_PREFIX, recallPassword, rememberPassword } from './passwords'

describe('I-04 remembered PDF password', () => {
  it('is stored encrypted on this device, recalled for the next import, and Forget clears it', async () => {
    const db = freshNewDb()
    expect(await recallPassword(db, 'card-m')).toBeNull()
    await rememberPassword(db, 'card-m', 'test1234')
    const stored = await db.meta.get(`${PASSWORD_PREFIX}card-m`)
    expect(JSON.stringify(stored)).not.toContain('test1234')
    expect(new TextDecoder().decode(new Uint8Array((stored!.value as { data: ArrayBuffer }).data))).not.toContain('test1234')
    expect(await recallPassword(db, 'card-m')).toBe('test1234')
    expect(await recallPassword(db, 'card-other')).toBeNull()

    // The key cannot be read out, and the backup holds neither key nor password.
    const key = (await db.meta.get('pdf-password-key'))!.value as CryptoKey
    expect(key.extractable).toBe(false)
    expect(await exportNewBackup(db)).not.toContain('pdf-password')

    await rememberPassword(db, 'card-m', 'newer')
    expect(await recallPassword(db, 'card-m')).toBe('newer')
    await forgetPassword(db, 'card-m')
    expect(await recallPassword(db, 'card-m')).toBeNull()
  })

  it('a password that can no longer be decrypted is treated as forgotten', async () => {
    const db = freshNewDb()
    await rememberPassword(db, 'c', 'pw')
    const sealed = (await db.meta.get(`${PASSWORD_PREFIX}c`))!.value as { iv: Uint8Array; data: ArrayBuffer }
    await db.meta.put({ key: `${PASSWORD_PREFIX}c`, value: { ...sealed, data: new Uint8Array(sealed.data.byteLength).buffer } })
    expect(await recallPassword(db, 'c')).toBeNull()
  })
})
