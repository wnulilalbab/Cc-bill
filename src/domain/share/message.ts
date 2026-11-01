// The WhatsApp share message (docs/intent/phase-1.md §9; format and wording from the prototype's share preview).
// Plain text with WhatsApp *bold*. One person or everyone on the card, Bahasa (default) or English. Numbers come
// from ownerBill / cardBill, so the amount sent always equals the Bill screen.
//
// Privacy: the message is built only from the card name, owner names, dates, row labels/merchants and amounts.
// Nothing else is read (no card number, holder name, password or API key), and anything that still looks like a
// full card number is masked down to its last 4.
import { cardBill, ownerBill, type BillLine, type OwnerBill } from '../bill'
import { draftIssues } from '../draft'
import { MoneyError, sum } from '../money'
import { statementById } from '../statements'
import { ruleKeyOf } from '../tagging/merchant'
import type { Card, ISODate, Ledger, Owner, Rupiah, Statement, Transaction } from '../types'
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

export interface ShareMessage {
  text: string
  /** What the message asks for: the owner's must-pay, or the sum over everyone. Logged as "Sent before". */
  total: Rupiah
  /** False while the statement is a Draft: the message then says "sementara" / "provisional". */
  final: boolean
}

type Words = (typeof WORDS)[ShareLang]

const statementLabel = (s: Statement, lang: ShareLang) => (s.kind === 'billed' ? monthYear(s.statementDate, lang) : WORDS[lang].unbilled)

/** The row's name in the list: the user's label, else the merchant ("GRAB", "IKEA ALAM"), plus "(cicilan 2/6)". */
function itemName(tx: Transaction, w: Words): string {
  const name = tx.label || ruleKeyOf(tx.description)
  return tx.installment ? `${name} (${w.installment} ${tx.installment.n}/${tx.installment.of})` : name
}

function itemLine(l: BillLine, lang: ShareLang): string {
  const w = WORDS[lang]
  const mark = l.status === 'refund' ? ` (${w.refund})` : l.status === 'paid' ? ` (${w.paidRow})` : ''
  return `- ${dayMonth(l.tx.date, lang)} ${itemName(l.tx, w)}: ${amount(l.tx.amount)}${mark}`
}

const hasRows = (b: OwnerBill) => b.lines.length > 0 || b.older.length > 0

function ownerBlock(b: OwnerBill, name: string, label: string, ctx: ShareContext, lang: ShareLang): string[] {
  const w = WORDS[lang]
  const out = ['', `*${name}: ${rupiah(b.mustPay)}*${b.settled ? ` ${w.paid}` : ''}`]
  if (b.alreadyPaid > 0) out.push(`${w.charges} ${label}: ${rupiah(b.charges)}`, `${w.alreadyPaid}: ${rupiah(b.alreadyPaid)}`)
  // Cancelled purchases and reversals count 0: never listed. Refunds are labelled.
  if (ctx.list !== false) out.push(...b.lines.filter((l) => l.effective !== 0).map((l) => itemLine(l, lang)))
  for (const g of b.older) {
    out.push(`- ${g.remaining < 0 ? w.olderCredit : w.olderUnpaid} ${monthYear(g.statement.statementDate, lang)}: ${amount(g.remaining)}`)
  }
  if (b.credit > 0) out.push(`${w.credit}: ${rupiah(b.credit)}`)
  if (b.depositWaiting > 0) out.push(`${w.deposit}: ${rupiah(b.depositWaiting)}`)
  if (!hasRows(b)) out.push(w.nothing)
  return out
}

/** Builds the message for one owner or for everyone on the card (one block per owner with rows or older unpaid). */
export function shareMessage(ctx: ShareContext, target: ShareTarget): ShareMessage {
  const lang = ctx.lang ?? 'id'
  const w = WORDS[lang]
  const s = statementById(ctx.ledger, ctx.statementId)
  if (!s) throw new MoneyError(`unknown statement ${ctx.statementId}`)
  const nameOf = (id: string | null) => {
    if (id === null) return w.noOwner
    const o = ctx.owners.find((x) => x.id === id)
    if (!o) throw new MoneyError(`unknown owner ${id}`)
    return o.name
  }

  const final = draftIssues(ctx.ledger, s.id).final
  const label = statementLabel(s, lang)
  const due = s.kind === 'billed' ? ` (${w.due} ${dayMonth(s.dueDate, lang)})` : ''
  const lines = [`*${w.bill} ${ctx.card.name} · ${label}*${due}`, `${w.asOf} ${fullDate(ctx.today, lang)}`]
  if (!final) lines.push(w.draft)

  let bills: OwnerBill[]
  if (target === 'all') {
    bills = cardBill(ctx.ledger, ctx.owners.map((o) => o.id), s.id, ctx.today).owners.filter(hasRows)
  } else {
    nameOf(target.ownerId)
    bills = [ownerBill(ctx.ledger, target.ownerId, s.id, ctx.today)]
  }
  for (const b of bills) lines.push(...ownerBlock(b, nameOf(b.ownerId), label, ctx, lang))
  const total = sum(bills.map((b) => b.mustPay))
  if (target === 'all') {
    if (!bills.length) lines.push('', w.nothing)
    lines.push('', `*${w.total}: ${rupiah(total)}*`)
  }
  return { text: maskCardNumbers(lines.join('\n')), total, final }
}
