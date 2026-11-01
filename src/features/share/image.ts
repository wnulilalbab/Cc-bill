// The share image (docs/intent/phase-1.md §9 "Image (phone share sheet)"): the share card drawn on a <canvas>,
// in the look of the prototype's share preview (.waimg: white card, bold title with a "who" pill, "Jatuh tempo … ·
// Per …", one row per person, dashed charge lines, paid amounts struck through) with the card's palette.
// `layoutShareImage` is pure (lines and positions); `drawShareImage` only paints them.
import { WORDS } from '../../domain/share/format'
import type { ShareCard } from '../../domain/share/message'

export interface ImagePalette {
  acc: string
  soft: string
  deep: string
}

export type Op =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number; fill: string; stroke?: string }
  | { kind: 'text'; text: string; x: number; y: number; font: string; color: string; align: 'left' | 'right'; strike?: boolean }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; dash: boolean }

export interface ImageLayout {
  width: number
  height: number
  ops: Op[]
}

/** Width of `text` in CSS pixels when drawn with `font`. */
export type Measure = (text: string, font: string) => number

const FAMILY = "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
export const font = (size: number, bold = false) => `${bold ? '700 ' : ''}${size}px ${FAMILY}`
const INK = '#111318'
const MUTED = '#6b7280'
const LINE = '#e3e5ea'
const OK = '#166534'
const WARN_BG = '#fff4d6'
const WARN = '#8a5a00'
const PAD = 20
/** Charge lines drawn per person; the rest become "+N more" (the text message keeps them all). */
export const MAX_IMAGE_ROWS = 40
/** Canvas limits that hold on iOS Safari and Chrome. */
export const MAX_CANVAS_AREA = 16_000_000
export const MAX_CANVAS_HEIGHT = 16_000

/** Device pixels per CSS pixel: `wanted`, lowered so the canvas stays within MAX_CANVAS_AREA and MAX_CANVAS_HEIGHT. */
export function canvasScale(width: number, height: number, wanted: number): number {
  return Math.min(wanted, Math.sqrt(MAX_CANVAS_AREA / (width * height)), MAX_CANVAS_HEIGHT / height)
}

/** `text`, shortened with "…" until it fits in `max` pixels. */
export function fit(text: string, f: string, max: number, measure: Measure): string {
  if (measure(text, f) <= max) return text
  let t = text
  while (t.length > 1 && measure(`${t}…`, f) > max) t = t.slice(0, -1)
  return `${t}…`
}

/**
 * Splits `text` into lines of at most `max` pixels at spaces, never before a number (so "Rp 209.508" and "Okt 2026"
 * stay together); a piece too long on its own is shortened.
 */
export function wrap(text: string, f: string, max: number, measure: Measure): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/ (?!\d)/)) {
    const next = line ? `${line} ${word}` : word
    if (line && measure(next, f) > max) {
      lines.push(line)
      line = word
    } else line = next
  }
  lines.push(line)
  return lines.map((l) => fit(l, f, max, measure))
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function layoutShareImage(card: ShareCard, palette: ImagePalette, measure: Measure, width = 360): ImageLayout {
  const ops: Op[] = []
  const left = PAD
  const right = width - PAD
  const inner = right - left
  let y = PAD + 8
  /** A paragraph: wrapped, 16 px between lines; the first line goes `gap` below the previous one. */
  const para = (t: string, gap: number, f: string, color: string) =>
    wrap(t, f, inner, measure).forEach((l, i) => {
      y += i ? 16 : gap
      text(l, left, f, color)
    })
  const text = (t: string, x: number, f: string, color: string, align: 'left' | 'right' = 'left', strike = false) =>
    ops.push({ kind: 'text', text: t, x, y, font: f, color, align, ...(strike && { strike }) })
  /** A line with a label on the left and an amount on the right; the label gives way. */
  const pair = (label: string, value: string, f: string, color: string, valueFont = f, valueColor = color, strike = false) => {
    const vw = measure(value, valueFont)
    text(fit(label, f, inner - vw - 10, measure), left, f, color)
    text(value, right, valueFont, valueColor, 'right', strike)
  }

  // Accent band (card palette), then the header: title + who pill, due and "Per <date>".
  ops.push({ kind: 'rect', x: 0, y: 0, w: width, h: 6, r: 0, fill: palette.acc })
  y += 16
  const pillFont = font(12, true)
  // A long name must not push the title out: the pill takes at most 40% of the width.
  const who = fit(card.who, pillFont, inner * 0.4 - 20, measure)
  const pillW = measure(who, pillFont) + 20
  ops.push({ kind: 'rect', x: right - pillW, y: y - 15, w: pillW, h: 22, r: 11, fill: palette.soft })
  text(who, right - 10, pillFont, palette.deep, 'right')
  text(fit(card.title, font(16, true), inner - pillW - 8, measure), left, font(16, true), INK)
  para(card.due ? `${cap(card.due)} · ${card.asOf}` : card.asOf, 20, font(12), MUTED)

  if (card.draft) {
    y += 14
    ops.push({ kind: 'rect', x: left, y, w: inner, h: 28, r: 8, fill: WARN_BG })
    y += 18
    text(fit(`⚠ ${card.draft.label} — ${card.draft.note}`, font(12, true), inner - 20, measure), left + 10, font(12, true), WARN)
    y += 10
  }

  const amountFont = font(card.blocks.length > 1 || card.totalLine ? 15 : 22, true)
  for (const b of card.blocks) {
    y += 30
    pair(b.name, b.headline, font(14, true), palette.deep, amountFont, b.settled ? OK : INK)
    for (const s of b.summary) para(s, 18, font(12), MUTED)
    // Only charge rows are capped: older unpaid per month must always match the text message.
    const lines = b.rows.map((r) => ({ label: r.label, value: r.mark ? `${r.amount} (${r.mark})` : r.amount, strike: r.paid }))
    const hidden = lines.length - MAX_IMAGE_ROWS
    if (hidden > 0) lines.splice(MAX_IMAGE_ROWS, hidden, { label: `+${hidden} ${WORDS[card.lang].more}`, value: '', strike: false })
    lines.push(...b.older.map((g) => ({ label: g.label, value: g.amount, strike: false })))
    for (const l of lines) {
      y += 20
      pair(l.label, l.value, font(12), INK, font(12), INK, l.strike)
      ops.push({ kind: 'line', x1: left, y1: y + 6, x2: right, y2: y + 6, color: LINE, dash: true })
    }
    for (const e of [...b.extras, ...(b.empty ? [b.empty] : [])]) para(e, 18, font(12), MUTED)
  }
  if (card.nothing) para(card.nothing, 28, font(12), MUTED)
  if (card.totalLine) {
    y += 16
    ops.push({ kind: 'line', x1: left, y1: y, x2: right, y2: y, color: INK, dash: false })
    para(card.totalLine, 24, font(15, true), INK)
  }
  const height = y + PAD
  // White card with a thin border behind everything.
  ops.unshift({ kind: 'rect', x: 0.5, y: 0.5, w: width - 1, h: height - 1, r: 16, fill: '#ffffff', stroke: LINE })
  return { width, height, ops }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Paints a layout. `scale` = device pixels per CSS pixel. */
export function drawShareImage(ctx: CanvasRenderingContext2D, layout: ImageLayout, scale = 1): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.textBaseline = 'alphabetic'
  for (const op of layout.ops) {
    if (op.kind === 'rect') {
      roundRect(ctx, op.x, op.y, op.w, op.h, op.r)
      ctx.fillStyle = op.fill
      ctx.fill()
      if (op.stroke) {
        ctx.strokeStyle = op.stroke
        ctx.lineWidth = 1
        ctx.stroke()
      }
    } else if (op.kind === 'text') {
      ctx.font = op.font
      ctx.fillStyle = op.color
      ctx.textAlign = op.align
      ctx.fillText(op.text, op.x, op.y)
      if (op.strike) {
        const w = ctx.measureText(op.text).width
        const x0 = op.align === 'right' ? op.x - w : op.x
        ctx.strokeStyle = op.color
        ctx.lineWidth = 1
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(x0, op.y - 4)
        ctx.lineTo(x0 + w, op.y - 4)
        ctx.stroke()
      }
    } else {
      ctx.strokeStyle = op.color
      ctx.lineWidth = 1
      ctx.setLineDash(op.dash ? [3, 3] : [])
      ctx.beginPath()
      ctx.moveTo(op.x1, op.y1)
      ctx.lineTo(op.x2, op.y2)
      ctx.stroke()
    }
  }
}

/** Draws the card on a fresh canvas and exports it as PNG. */
export async function renderSharePng(card: ShareCard, palette: ImagePalette, scale = 2): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw the image.')
  await document.fonts?.ready
  const measure: Measure = (t, f) => {
    ctx.font = f
    return ctx.measureText(t).width
  }
  const layout = layoutShareImage(card, palette, measure)
  const k = canvasScale(layout.width, layout.height, scale)
  canvas.width = Math.floor(layout.width * k)
  canvas.height = Math.floor(layout.height * k)
  drawShareImage(ctx, layout, k)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image.'))), 'image/png'))
}

/** "tagihan-bca-keluarga-nov-2026-sari.png". */
export const imageFileName = (card: ShareCard) =>
  `${`${card.title} ${card.who}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}.png`

/** Saves a file through a temporary link. */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
