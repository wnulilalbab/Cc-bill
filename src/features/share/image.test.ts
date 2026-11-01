// @vitest-environment jsdom
// Share image: pure layout (lines and positions) and the painting, with a mocked 2D context. Synthetic household.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareCard, type ShareContext } from '../../domain/share/message'
import { BCA_OWNERS, householdLedger, TODAY } from '../../../test/payments/household'
import { paletteOf } from '../look/palettes'
import { downloadBlob, drawShareImage, fit, wrap, font, imageFileName, layoutShareImage, renderSharePng, type ImageLayout, type Op } from './image'

const HH = householdLedger()
const ctx = (statementId: string, extra: Partial<ShareContext> = {}): ShareContext => ({
  ledger: HH,
  card: { name: 'BCA Keluarga' },
  owners: BCA_OWNERS.map((name) => ({ id: name, name })),
  statementId,
  today: TODAY,
  ...extra,
})
const BLUE = paletteOf('blue')
/** 7 px per character at any size: enough to test fitting. */
const measure = (t: string) => [...t].length * 7
const texts = (l: ImageLayout) => l.ops.filter((o): o is Extract<Op, { kind: 'text' }> => o.kind === 'text')
const textOf = (l: ImageLayout, t: string) => texts(l).find((o) => o.text === t)

afterEach(() => vi.restoreAllMocks())

describe('layoutShareImage', () => {
  it('one person: card, palette band, title + who pill, "Due … · As of …", Draft, rows, marks and struck paid amounts', () => {
    const card = shareCard(ctx('bca-2026-08', { lang: 'en' }), { ownerId: 'Andi' })
    const l = layoutShareImage(card, BLUE, measure)
    expect(l.width).toBe(360)
    expect(l.ops[0]).toEqual({ kind: 'rect', x: 0.5, y: 0.5, w: 359, h: l.height - 1, r: 16, fill: '#ffffff', stroke: '#e3e5ea' })
    expect(l.ops[1]).toEqual({ kind: 'rect', x: 0, y: 0, w: 360, h: 6, r: 0, fill: BLUE.acc })
    expect(l.ops[2]).toMatchObject({ kind: 'rect', fill: BLUE.soft, w: 4 * 7 + 20, x: 340 - 48 })
    expect(textOf(l, 'Andi')).toMatchObject({ align: 'right', color: BLUE.deep, x: 330 })
    expect(textOf(l, 'Bill BCA Keluarga · Aug 2026')).toMatchObject({ x: 20, font: font(16, true) })
    expect(textOf(l, 'Due 28 Aug · As of 1 Nov 2026')).toBeTruthy()
    expect(textOf(l, '⚠ PROVISIONAL — numbers may change')).toMatchObject({ color: '#8a5a00' })
    expect(textOf(l, 'Paid ✓')).toMatchObject({ align: 'right', x: 340, font: font(22, true), color: '#166534' })
    expect(textOf(l, '9.000 (paid)')).toMatchObject({ strike: true, align: 'right' })
    expect(textOf(l, '499.917')).not.toHaveProperty('strike')
    expect(textOf(l, '−381.327 (refund)')).toBeTruthy()
    expect(textOf(l, 'Refund credit (lowers the next bill):')).toMatchObject({ color: '#6b7280' })
    expect(textOf(l, 'Rp 209.508')!.y).toBe(textOf(l, 'Refund credit (lowers the next bill):')!.y + 16)
    // Cancelled/reversal rows are not in the card, so not in the image either.
    expect(l.ops.filter((o) => o.kind === 'line' && o.dash)).toHaveLength(4)
    const ys = texts(l).map((o) => o.y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    expect(l.height).toBe(Math.max(...ys) + 20)
  })

  it('everyone: smaller amounts, older unpaid per month, and the total under a rule', () => {
    const l = layoutShareImage(shareCard(ctx('bca-2026-11'), 'all'), BLUE, measure, 400)
    expect(textOf(l, 'Rp 535.000')).toMatchObject({ font: font(15, true), color: '#111318', x: 380 })
    expect(textOf(l, 'Sisa Okt 2026')).toBeTruthy()
    expect(textOf(l, 'Jatuh tempo 28 Nov · Per 1 Nov 2026')).toBeTruthy()
    const rule = l.ops.find((o) => o.kind === 'line' && !o.dash)
    expect(rule).toMatchObject({ x1: 20, x2: 380, color: '#111318' })
    const total = texts(l).at(-1)!
    expect(total.text).toBe('Total semua: Rp 5.125.380')
    expect(total.y).toBe((rule as { y1: number }).y1 + 24)
  })

  it('Unbilled has only "Per <date>"; an empty card says so; a Final card has no Draft line', () => {
    const l = layoutShareImage(shareCard(ctx('bca-unb'), { ownerId: 'Sari' }), BLUE, measure)
    expect(textOf(l, 'Per 1 Nov 2026')).toBeTruthy()
    expect(texts(l).some((o) => o.text.startsWith('⚠'))).toBe(false)
    const empty = layoutShareImage(shareCard(ctx('bca-2026-07'), { ownerId: 'Sari' }), BLUE, measure)
    expect(textOf(empty, 'Tidak ada transaksi di tagihan ini.')).toBeTruthy()
    expect(textOf(empty, 'Lunas ✓')).toBeTruthy()
    const none = shareCard({ ...ctx('bca-2026-07'), ledger: { ...HH, transactions: [] } }, 'all')
    expect(textOf(layoutShareImage(none, BLUE, measure), 'Tidak ada transaksi di tagihan ini.')).toBeTruthy()
  })

  it('long labels are shortened so the amount always fits', () => {
    const l = layoutShareImage(shareCard(ctx('bca-2026-11'), { ownerId: 'Andi' }), BLUE, measure, 200)
    for (const o of texts(l).filter((x) => x.align === 'left')) expect(measure(o.text)).toBeLessThanOrEqual(160)
    expect(texts(l).some((o) => o.text.endsWith('…'))).toBe(true)
  })
})

describe('wrap', () => {
  it('breaks at spaces, never before a number, and shortens a piece that is too long', () => {
    expect(wrap('Sisa Okt 2026', 'f', 1000, measure)).toEqual(['Sisa Okt 2026'])
    expect(wrap('aa bb cc Rp 1.000', 'f', 42, measure)).toEqual(['aa bb', 'cc', 'Rp 1.000'.slice(0, 5) + '…'])
    expect(wrap('aaaaaaaaaa b', 'f', 35, measure)).toEqual(['aaaa…', 'b'])
  })
})

describe('fit', () => {
  it('keeps text that fits and shortens the rest with an ellipsis', () => {
    expect(fit('abcdef', 'f', 42, measure)).toBe('abcdef')
    expect(fit('abcdefgh', 'f', 42, measure)).toBe('abcde…')
    expect(fit('abc', 'f', 1, measure)).toBe('a…')
  })
})

function mockCtx() {
  const calls: unknown[][] = []
  const rec = (name: string) => vi.fn((...a: unknown[]) => void calls.push([name, ...a]))
  const c = {
    setTransform: rec('setTransform'),
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arcTo: rec('arcTo'),
    closePath: rec('closePath'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    fillText: rec('fillText'),
    setLineDash: rec('setLineDash'),
    measureText: vi.fn((t: string) => ({ width: measure(t) })),
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textAlign: '',
    textBaseline: '',
  }
  return { c, calls }
}

describe('drawShareImage', () => {
  it('paints rounded rects, texts (struck when paid) and dashed lines', () => {
    const { c, calls } = mockCtx()
    const layout: ImageLayout = {
      width: 100,
      height: 50,
      ops: [
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50, r: 10, fill: '#fff', stroke: '#eee' },
        { kind: 'rect', x: 0, y: 0, w: 10, h: 5, r: 0, fill: '#00f' },
        { kind: 'text', text: 'Andi', x: 10, y: 20, font: 'f1', color: '#111', align: 'left' },
        { kind: 'text', text: '9.000', x: 90, y: 30, font: 'f2', color: '#222', align: 'right', strike: true },
        { kind: 'text', text: 'ab', x: 5, y: 40, font: 'f3', color: '#333', align: 'left', strike: true },
        { kind: 'line', x1: 0, y1: 45, x2: 100, y2: 45, color: '#ccc', dash: true },
        { kind: 'line', x1: 0, y1: 46, x2: 100, y2: 46, color: '#000', dash: false },
      ],
    }
    drawShareImage(c as unknown as CanvasRenderingContext2D, layout, 2)
    expect(calls[0]).toEqual(['setTransform', 2, 0, 0, 2, 0, 0])
    expect(c.textBaseline).toBe('alphabetic')
    expect(calls.filter((x) => x[0] === 'arcTo')).toHaveLength(8)
    expect(calls.slice(1, 8)).toEqual([['beginPath'], ['moveTo', 10, 0], ['arcTo', 100, 0, 100, 50, 10], ['arcTo', 100, 50, 0, 50, 10], ['arcTo', 0, 50, 0, 0, 10], ['arcTo', 0, 0, 100, 0, 10], ['closePath']])
    expect(calls.filter((x) => x[0] === 'fill')).toHaveLength(2)
    expect(calls.filter((x) => x[0] === 'fillText')).toEqual([['fillText', 'Andi', 10, 20], ['fillText', '9.000', 90, 30], ['fillText', 'ab', 5, 40]])
    // Right-aligned strike runs from x − width to x, 4 px above the baseline; left-aligned from x.
    expect(calls).toContainEqual(['moveTo', 90 - 35, 26])
    expect(calls).toContainEqual(['lineTo', 90, 26])
    expect(calls).toContainEqual(['moveTo', 5, 36])
    expect(calls).toContainEqual(['lineTo', 19, 36])
    expect(calls.filter((x) => x[0] === 'setLineDash')).toEqual([['setLineDash', []], ['setLineDash', []], ['setLineDash', [3, 3]], ['setLineDash', []]])
    expect(calls).toContainEqual(['moveTo', 0, 45])
    expect(calls).toContainEqual(['lineTo', 100, 46])
    expect(calls.filter((x) => x[0] === 'stroke')).toHaveLength(5)
    expect([c.strokeStyle, c.lineWidth, c.fillStyle, c.font, c.textAlign]).toEqual(['#000', 1, '#333', 'f3', 'left'])
  })

  it('defaults to scale 1', () => {
    const { c, calls } = mockCtx()
    drawShareImage(c as unknown as CanvasRenderingContext2D, { width: 1, height: 1, ops: [] })
    expect(calls).toEqual([['setTransform', 1, 0, 0, 1, 0, 0]])
  })
})

describe('renderSharePng', () => {
  const card = () => shareCard(ctx('bca-2026-11'), { ownerId: 'Sari' })

  it('draws at 2× on a canvas and exports PNG', async () => {
    const { c } = mockCtx()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(c as never)
    const png = new Blob(['png'], { type: 'image/png' })
    let size: number[] = []
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb, type) {
      size = [this.width, this.height]
      expect(type).toBe('image/png')
      cb(png)
    })
    expect(await renderSharePng(card(), BLUE)).toBe(png)
    const layout = layoutShareImage(card(), BLUE, measure)
    expect(size).toEqual([720, Math.ceil(layout.height * 2)])
    expect(c.measureText).toHaveBeenCalled()
    expect(c.fillText).toHaveBeenCalledWith('Sari', expect.any(Number), expect.any(Number))
    expect(toBlob).toHaveBeenCalledTimes(1)
  })

  it('fails clearly without a 2D context or when the export fails', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    await expect(renderSharePng(card(), BLUE)).rejects.toThrow('This browser cannot draw the image.')
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx().c as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(null))
    await expect(renderSharePng(card(), BLUE, 1)).rejects.toThrow('Could not make the image.')
  })
})

describe('files', () => {
  it('names the image after the bill and the person', () => {
    expect(imageFileName(shareCard(ctx('bca-2026-11'), { ownerId: 'Sari' }))).toBe('tagihan-bca-keluarga-nov-2026-sari.png')
    expect(imageFileName(shareCard(ctx('bca-unb', { lang: 'en' }), 'all'))).toBe('bill-bca-keluarga-unbilled-everyone.png')
  })

  it('downloads a blob through a temporary link', () => {
    vi.useFakeTimers()
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect([this.download, this.getAttribute('href')]).toEqual(['a.png', 'blob:x'])
    })
    const blob = new Blob(['x'])
    downloadBlob('a.png', blob)
    expect(create).toHaveBeenCalledWith(blob)
    expect(click).toHaveBeenCalledTimes(1)
    expect(document.querySelector('a[download]')).toBeNull()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:x')
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
})
