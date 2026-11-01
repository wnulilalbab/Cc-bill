// The WhatsApp share (docs/intent/phase-1.md §9; format and wording from the prototype's share preview).
// `shareCard` builds what is shared (one person or everyone on the card, Bahasa (default) or English); the text
// message (`shareMessage`) and the share image (src/features/share/image.ts) are both drawn from it, so they always
// say the same. Numbers come from ownerBill / cardBill, so the amount sent always equals the Bill screen.
//
// Privacy: built only from the card name, owner names, dates, row labels/merchants and amounts. Nothing else is read
// (no card number, holder name, password or API key), and any of those texts that still looks like a full card
// number is masked down to its last 4.
import { cardBill, ownerBill, type BillLine, type OwnerBill } from '../bill'
import { draftIssues } from '../draft'
import { MoneyError, sum } from '../money'
import { statementById } from '../statements'
import { ruleKeyOf } from '../tagging/merchant'
import type { Card, ISODate, Ledger, Owner, Rupiah, Transaction } from '../types'
import { amount, dayMonth, fullDate, maskCardNumbers, monthYear, rupiah, WORDS, type ShareLang } from './format'

export interface ShareContext {
  ledger: Ledger
  card: Pick<Card, 'name'>
  /** The card's owners (archived ones included: they keep history), in display order. */
  owners: readonly Pick<Owner, 'id' | 'name'>[]
  statementId: string
  /** "Per <date>": paid amounts are live as of this day. */
  today: ISODate
  /** Default Bahasa. */
  lang?: ShareLang
  /** Include the list of charges. Default true. */
  list?: boolean
}

/** One owner (`null` = rows without an owner), or everyone on the card. */
export type ShareTarget = { ownerId: string | null } | 'all'

export interface ShareRow {
  /** "15 Okt BLIBLI (cicilan 2/6)". */
  label: string
  /** "729.367", "−381.327". */
  amount: string
  /** Wording of the mark ("lunas", "refund"); null when open. */
  mark: string | null
  paid: boolean
}

export interface ShareBlock {
  name: string
  /** "Rp 928.734". */
  amount: string
  /** Nothing open: the text says "✓ lunas", the image shows `headline`. */
  settled: boolean
  /** The image's big number: the amount, or "Lunas ✓" / "Paid ✓" when settled (as in the prototype preview). */
  headline: string
  /** "Tagihan Nov 2026: Rp …", "Sudah dibayar: Rp …" (only when something is paid). */
  summary: string[]
  /** This statement's rows (cancelled and reversal rows never; empty when the list is off). */
  rows: ShareRow[]
  /** Older bills still open, one per month ("Sisa Sep 2026"). */
  older: { label: string; amount: string }[]
  /** Refund credit and deposit waiting. */
  extras: string[]
  /** No rows and nothing older: "Tidak ada transaksi di tagihan ini." */
  empty: string | null
}

export interface ShareCard {
  lang: ShareLang
  /** "Tagihan BCA Keluarga · Nov 2026". */
  title: string
  /** "jatuh tempo 28 Nov"; null for Unbilled. */
  due: string | null
  /** "Per 1 Nov 2026". */
  asOf: string
  /** Draft only: "SEMENTARA" / "PROVISIONAL" and its note. */
  draft: { label: string; note: string } | null
  /** "Sari" or "Semua" / "Everyone". */
  who: string
  blocks: ShareBlock[]
  /** Everyone only: nobody has anything on this bill. */
  nothing: string | null
  /** Everyone only: "Total semua: Rp …". */
  totalLine: string | null
  /** What it asks for: the owner's must-pay, or the sum over everyone. Logged as "Sent before". */
  total: Rupiah
  /** False while the statement is a Draft. */
  final: boolean
}

export interface ShareMessage {
  text: string
  total: Rupiah
  final: boolean
}

type Words = (typeof WORDS)[ShareLang]

/** The row's name in the list: the user's label, else the merchant ("GRAB", "IKEA ALAM"), plus "(cicilan 2/6)". */
function itemName(tx: Transaction, w: Words): string {
  const name = maskCardNumbers(tx.label || ruleKeyOf(tx.description))
  return tx.installment ? `${name} (${w.installment} ${tx.installment.n}/${tx.installment.of})` : name
}

function row(l: BillLine, lang: ShareLang): ShareRow {
  const w = WORDS[lang]
  const paid = l.status === 'paid'
  return {
    label: `${dayMonth(l.tx.date, lang)} ${itemName(l.tx, w)}`,
    amount: amount(l.tx.amount),
    mark: l.status === 'refund' ? w.refund : paid ? w.paidRow : null,
    paid,
  }
}

const hasRows = (b: OwnerBill) => b.lines.length > 0 || b.older.length > 0

function block(b: OwnerBill, name: string, label: string, list: boolean, lang: ShareLang): ShareBlock {
  const w = WORDS[lang]
  const extras: string[] = []
  if (b.credit > 0) extras.push(`${w.credit}: ${rupiah(b.credit)}`)
  if (b.depositWaiting > 0) extras.push(`${w.deposit}: ${rupiah(b.depositWaiting)}`)
  return {
    name,
    amount: rupiah(b.mustPay),
    settled: b.settled,
    headline: b.settled ? w.paidShort : rupiah(b.mustPay),
    summary: b.alreadyPaid > 0 ? [`${w.charges} ${label}: ${rupiah(b.charges)}`, `${w.alreadyPaid}: ${rupiah(b.alreadyPaid)}`] : [],
    // Cancelled purchases and reversals count 0: never listed. Refunds are marked.
    rows: list ? b.lines.filter((l) => l.effective !== 0).map((l) => row(l, lang)) : [],
    older: b.older.map((g) => ({
      label: `${g.remaining < 0 ? w.olderCredit : w.olderUnpaid} ${monthYear(g.statement.statementDate, lang)}`,
      amount: amount(g.remaining),
    })),
    extras,
    empty: hasRows(b) ? null : w.nothing,
  }
}

/** What is shared with one owner or with everyone on the card (one block per owner with rows or older unpaid). */
export function shareCard(ctx: ShareContext, target: ShareTarget): ShareCard {
  const lang = ctx.lang ?? 'id'
  const w = WORDS[lang]
  const s = statementById(ctx.ledger, ctx.statementId)
  if (!s) throw new MoneyError(`unknown statement ${ctx.statementId}`)
  const nameOf = (id: string | null) => {
    if (id === null) return w.noOwner
    const o = ctx.owners.find((x) => x.id === id)
    if (!o) throw new MoneyError(`unknown owner ${id}`)
    return maskCardNumbers(o.name)
  }

  const all = target === 'all'
  const who = all ? w.everyone : nameOf(target.ownerId)
  const bills = all
    ? cardBill(ctx.ledger, ctx.owners.map((o) => o.id), s.id, ctx.today).owners.filter(hasRows)
    : [ownerBill(ctx.ledger, target.ownerId, s.id, ctx.today)]
  const label = s.kind === 'billed' ? monthYear(s.statementDate, lang) : w.unbilled
  const final = draftIssues(ctx.ledger, s.id).final
  const total = sum(bills.map((b) => b.mustPay))
  return {
    lang,
    title: `${w.bill} ${maskCardNumbers(ctx.card.name)} · ${label}`,
    due: s.kind === 'billed' ? `${w.due} ${dayMonth(s.dueDate, lang)}` : null,
    asOf: `${w.asOf} ${fullDate(ctx.today, lang)}`,
    draft: final ? null : { label: w.draftLabel, note: w.draftNote },
    who,
    blocks: bills.map((b) => block(b, nameOf(b.ownerId), label, ctx.list !== false, lang)),
    nothing: all && !bills.length ? w.nothing : null,
    totalLine: all ? `${w.total}: ${rupiah(total)}` : null,
    total,
    final,
  }
}

/** The card as WhatsApp text (with *bold*). */
export function shareText(card: ShareCard): string {
  const w = WORDS[card.lang]
  const lines = [`*${card.title}*${card.due ? ` (${card.due})` : ''}`, card.asOf]
  if (card.draft) lines.push(`⚠️ *${card.draft.label}* — ${card.draft.note}`)
  for (const b of card.blocks) {
    lines.push('', `*${b.name}: ${b.amount}*${b.settled ? ` ${w.paid}` : ''}`, ...b.summary)
    lines.push(...b.rows.map((r) => `- ${r.label}: ${r.amount}${r.mark ? ` (${r.mark})` : ''}`))
    lines.push(...b.older.map((g) => `- ${g.label}: ${g.amount}`), ...b.extras)
    if (b.empty) lines.push(b.empty)
  }
  if (card.nothing) lines.push('', card.nothing)
  if (card.totalLine) lines.push('', `*${card.totalLine}*`)
  return lines.join('\n')
}

/** The text message for one owner or everyone. */
export function shareMessage(ctx: ShareContext, target: ShareTarget): ShareMessage {
  const card = shareCard(ctx, target)
  return { text: shareText(card), total: card.total, final: card.final }
}
