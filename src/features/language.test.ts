// U-04: the app UI is English everywhere; only the WhatsApp share (src/features/share, src/domain/share) has Bahasa.
// A static scan of every screen and component source for common Indonesian UI words. Statement lines shown as data
// (e.g. "PEMBAYARAN - MBCA") come from the database, not from the source, so they never trip this.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const WORDS = /\b(sementara|tagihan|bayar|dibayar|belum|sudah|untuk|dari|jatuh tempo|semua|kartu|simpan|hapus|batal|lanjut|bulan|orang|sisa|total bayar)\b/i
/** Bank terms quoted next to their English label, so the user can find them on the paper statement. */
const ALLOWED = ['New balance (Tagihan baru)']

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'share' ? [] : sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** String literals and JSX text of a source file (comments removed). */
function texts(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const literals = [...code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3])
  const jsx = [...code.matchAll(/>([^<>{}]+)</g)].map((m) => m[1].trim()).filter(Boolean)
  return [...literals, ...jsx]
}

describe('U-04 language', () => {
  it('U-04 no Indonesian words in the app UI outside the share preview', () => {
    const files = [...sources(join(ROOT, 'features')), ...sources(join(ROOT, 'components'))]
    expect(files.length).toBeGreaterThan(30)
    const found = files.flatMap((f) =>
      texts(readFileSync(f, 'utf8'))
        .filter((t) => WORDS.test(t) && !ALLOWED.includes(t))
        .map((t) => `${relative(ROOT, f)}: ${t}`),
    )
    expect(found).toEqual([])
  })

  it('U-04 the scan finds Indonesian text when it is there', () => {
    expect(texts(`const a = 'Simpan'; const b = <b>Tagihan sementara</b>; // dari komentar`).filter((t) => WORDS.test(t))).toEqual(['Simpan', 'Tagihan sementara'])
  })
})
