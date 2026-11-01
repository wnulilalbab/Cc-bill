// Import (minimal; Slice 12 does the look): pick card, type and file → password if locked → review rows and the
// totals check → save. Wording follows docs/prototype/ccbill-prototype.html.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { FetchLike } from '../../ai/client'
import { Picker } from '../../components/Picker'
import { commitImport, resolveNotOnStatement } from '../../import/commit'
import {
  checkTotals,
  decideDuplicate,
  problems,
  setCreditKind,
  setDates,
  setPrinted,
  setRowAmount,
  setTypedTotal,
  confirmTotalsChecked,
  conflictMessage,
  totalsConflicts,
  totalsVerified,
  type ImportDraft,
  type ImportTarget,
} from '../../import/draft'
import type { DraftRow } from '../../import/normalize'
import { PdfPasswordError, type PdfJsLike } from '../../import/pdf'
import { forgetPassword, hasPassword, recallPassword, rememberPassword } from '../../import/passwords'
import type { ImportReport, RowSummary } from '../../import/plan'
import { readImport, type ImportFile } from '../../import/read'
import { setHolderName } from '../../data/cards'
import { useData } from '../data/DataContext'
import { useAppearance } from '../look/Appearance'
import { readAiSettings } from '../settings/aiSettings'
import { rp } from '../settings/format'
import { PATHS } from '../shell/paths'
import { TopBar } from '../shell/TopBar'
import { loadPdfjs } from './pdfjs'

export interface ImportPageProps {
  /** Test seams: pdf.js loader and fetch. The app uses the defaults. */
  pdfjs?: () => Promise<PdfJsLike>
  fetch?: FetchLike
}

type Phase = 'form' | 'reading' | 'review' | 'saving' | 'done'

/** "1.234.567", "1234567" or "Rp 1.234.567" → 1234567; null when empty or not a number. */
export function parseTyped(text: string): number | null {
  const digits = text.replace(/^\s*rp\.?\s*/i, '').replace(/[.\s]/g, '')
  return /^-?\d+$/.test(digits) ? Number(digits) : null
}

const fmt = (n: number) => Math.abs(n).toLocaleString('id-ID')

/** File bytes through FileReader (every browser and jsdom). */
function bytesOf(f: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(f)
  })
}

async function toImportFiles(list: FileList | null): Promise<ImportFile[]> {
  return Promise.all(Array.from(list ?? []).map(async (f) => ({ name: f.name, type: f.type, bytes: await bytesOf(f) })))
}

export function ImportPage({ pdfjs = loadPdfjs, fetch }: ImportPageProps) {
  const { db } = useData()
  const { cards, selected } = useAppearance()
  const [cardId, setCardId] = useState<string | null>(null)
  const [target, setTarget] = useState<ImportTarget>('statement')
  const [files, setFiles] = useState<ImportFile[]>([])
  const [password, setPassword] = useState('')
  const [holder, setHolder] = useState('')
  const [remember, setRemember] = useState(false)
  const [saved, setSaved] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [draft, setDraft] = useState<ImportDraft | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [resolved, setResolved] = useState<Record<string, string>>({})

  const card = cards?.find((c) => c.card.id === cardId) ?? selected
  const pdf = files.length === 1 && /\.pdf$/i.test(files[0].name)
  const savedCardId = card?.card.id
  /** First PDF import of a card without a holder name: ask for it once (it is removed before the AI call). */
  const askHolder = pdf && target === 'statement' && !!card && !card.card.holderName

  // Whether the selected card has a remembered PDF password (shows "Forget saved password").
  useEffect(() => {
    let live = true
    if (savedCardId) hasPassword(db, savedCardId).then((v) => live && setSaved(v), () => {})
    return () => {
      live = false
    }
  }, [db, savedCardId, phase])

  async function forget() {
    if (!card) return
    await forgetPassword(db, card.card.id)
    setSaved(false)
  }

  async function read() {
    if (!card) return
    setError('')
    setPhase('reading')
    try {
      if (askHolder && holder.trim()) await setHolderName(db, card.card.id, holder)
      const typed = password || (pdf ? await recallPassword(db, card.card.id) : null) || undefined
      const ai = { ...readAiSettings(), fetch }
      const d = await readImport({ db, ai, pdfjs: pdf ? await pdfjs() : undefined }, { cardId: card.card.id, target, files, password: typed })
      if (pdf && password && remember) await rememberPassword(db, card.card.id, password)
      setDraft(d)
      setPhase('review')
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        setLocked(true)
        if (!password) await forgetPassword(db, card.card.id) // a remembered password that no longer works
      }
      setError(e instanceof Error ? e.message : String(e))
      setPhase('form')
    }
  }

  async function save(acceptDifference: boolean) {
    if (!draft) return
    setPhase('saving')
    setError('')
    try {
      setReport(await commitImport(db, draft, { acceptDifference }))
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('review')
    }
  }

  function restart() {
    setFiles([])
    setPassword('')
    setLocked(false)
    setDraft(null)
    setReport(null)
    setResolved({})
    setError('')
    setPhase('form')
  }

  if (cards !== undefined && cards.length === 0)
    return (
      <div className="screen">
        <Top />
        <div className="box empty small">
          Add a card first in <Link to={PATHS.settings}>Settings</Link>.
        </div>
        </div>
    )

  return (
    <div className="screen">
      <Top />
      {(phase === 'form' || phase === 'reading') && (
        <div className="box">
          <div className="field">
            <span className="fl">Card</span>
            <Picker
              title="Card"
              field
              value={card?.card.id ?? ''}
              options={(cards ?? []).map((c) => ({ value: c.card.id, label: c.card.name, sub: `${c.card.bank}${c.card.last4 ? ` •••• ${c.card.last4}` : ''}` }))}
              onChange={(v) => {
                setCardId(v)
                setLocked(false)
                setError('')
              }}
            />
          </div>
          <div className="field">
            <span className="fl">What are you uploading?</span>
            <div className="chips">
              {(
                [
                  ['statement', 'Statement'],
                  ['unbilled', 'Unbilled screenshots'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} type="button" className="chip" aria-pressed={target === v} onClick={() => setTarget(v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="impFile">{target === 'statement' ? 'Statement PDF, or screenshots of its pages' : 'Screenshots from the bank app'}</label>
            <input
              id="impFile"
              type="file"
              multiple
              accept={target === 'statement' ? 'application/pdf,image/*' : 'image/*'}
              onChange={async (e) => {
                setFiles(await toImportFiles(e.target.files))
                setLocked(false)
                setError('')
              }}
            />
          </div>
          {askHolder && (
            <div className="field">
              <label htmlFor="impHolder">Card holder name, as printed on the statement</label>
              <input id="impHolder" className="inp" autoComplete="off" placeholder="e.g. ANDI PRATAMA" value={holder} onChange={(e) => setHolder(e.target.value)} />
              <div className="xs muted">Asked once for {card?.card.name}. It is removed on this phone before anything goes to the AI. Leave it empty and the app guesses it from page 1; change it later in Settings → Cards.</div>
            </div>
          )}
          {target === 'unbilled' && <div className="xs muted">Charges and payment lines go to Unbilled. When the statement arrives, both move into it with their owners and assignments.</div>}
          {locked && (
            <div className="status draft">
              <h3>This PDF is locked</h3>
              <input className="inp" type="password" aria-label="PDF password" placeholder="PDF password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <label className="small">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => {
                    setRemember(e.target.checked)
                    if (!e.target.checked) void forget() // unticking also removes a password saved earlier
                  }}
                />{' '}
                Remember for this card (encrypted, kept on this phone only)
              </label>
            </div>
          )}
          {saved && (
            <div className="row small">
              <span>A PDF password is saved for {card?.card.name} on this phone.</span>
              <button type="button" className="link" onClick={forget}>
                Forget saved password
              </button>
            </div>
          )}
          {error && (
            <div className="small err" role="alert">
              {error}
            </div>
          )}
          <div className="xs muted">Your name, address and card number are removed on this phone first. Only transaction lines and totals are sent to the AI.</div>
          <button type="button" className="btn acc" disabled={!files.length || !card || phase === 'reading'} onClick={read}>
            {phase === 'reading' ? 'Reading…' : locked ? 'Unlock and read' : target === 'statement' ? 'Read statement' : 'Read screenshots'}
          </button>
          {phase === 'reading' && <div className="xs muted">One AI request. Usually 20 to 40 seconds.</div>}
        </div>
      )}

      {(phase === 'review' || phase === 'saving') && draft && (
        <Review draft={draft} onChange={setDraft} onSave={save} onCancel={restart} saving={phase === 'saving'} error={error} />
      )}

      {phase === 'done' && report && (
        <Done
          report={report}
          resolved={resolved}
          onResolve={async (id, choice) => {
            await resolveNotOnStatement(db, id, choice)
            setResolved((r) => ({ ...r, [id]: choice === 'delete' ? 'Deleted.' : 'OK. It stays in Unbilled for the next statement.' }))
          }}
          onAgain={restart}
        />
      )}
    </div>
  )
}

function Top() {
  return <TopBar title="Import" />
}

function Review({ draft, onChange, onSave, onCancel, saving, error }: { draft: ImportDraft; onChange(d: ImportDraft): void; onSave(acceptDifference: boolean): void; onCancel(): void; saving: boolean; error: string }) {
  const [fixing, setFixing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const check = checkTotals(draft)
  const conflicts = totalsConflicts(draft)
  /** Totals differ (and the printed figures themselves are not in question). */
  const differs = check !== null && !check.ok && conflicts.length === 0
  const asking = confirming && differs
  const todo = problems(draft)
  const isStatement = draft.target === 'statement'
  const dupOf = (key: string) => draft.duplicates.find((q) => q.rowKey === key)
  const credits = draft.rows.filter((r) => r.amount < 0)
  const count = (k: string) => credits.filter((r) => r.kind === k).length

  return (
    <>
      {isStatement && (
        <div className="box tight">
          <div className="field">
            <label htmlFor="impDate">Statement date</label>
            <input id="impDate" className="inp" type="date" value={draft.statementDate ?? ''} onChange={(e) => onChange(setDates(draft, { statementDate: e.target.value || null }))} />
          </div>
          <div className="field">
            <label htmlFor="impDue">Due date</label>
            <input id="impDue" className="inp" type="date" value={draft.dueDate ?? ''} onChange={(e) => onChange(setDates(draft, { dueDate: e.target.value || null }))} />
          </div>
          {draft.format === 'screenshots' && (
            <AmountField id="impTotal" label="Bank's total on page 1 (for the totals check)" value={draft.typedTotal} onChange={(n) => onChange(setTypedTotal(draft, n === null ? null : Math.abs(n)))} />
          )}
          {draft.format === 'pdf' && draft.printed.newBalance === null && <AmountField id="impNew" label="New balance (Tagihan baru)" value={null} onChange={(n) => onChange(setPrinted(draft, { newBalance: n }))} />}
          {draft.printed.prevBalance === null && <AmountField id="impPrev" label="Previous balance" value={null} onChange={(n) => onChange(setPrinted(draft, { prevBalance: n }))} />}
        </div>
      )}
      {draft.replaces && (
        <div className="status draft">
          <div className="xs">
            <b>This month is already imported.</b> Saving replaces it: rows that match keep their owners and payments, and anything different is listed for you to check.
          </div>
        </div>
      )}
      {draft.alreadyImported && !draft.replaces && <div className="status draft xs">This file was imported before ({draft.alreadyImported.at.slice(0, 10)}).</div>}

      {draft.warnings.map((w) => (
        <div key={w} className="status draft xs">
          {w}
        </div>
      ))}
      {conflicts.length > 0 && (
        <div className="status bad">
          <h3>Totals can&apos;t be confirmed</h3>
          {conflicts.map((c) =>
            c.reason === 'differs' ? (
              <div key={c.field} className="small">
                The AI read the {c.field === 'newBalance' ? 'new balance' : 'previous balance'} as {c.ai === null ? 'nothing' : rp(c.ai)}, but the statement prints {rp(c.printed!)}.{' '}
                <button type="button" className="link" onClick={() => onChange(setPrinted(draft, { [c.field]: c.printed }))}>
                  Use the printed figure
                </button>
              </div>
            ) : (
              <div key={c.field} className="small">
                {conflictMessage(c)} The AI read {c.ai === null ? 'nothing' : rp(c.ai)}.
              </div>
            ),
          )}
          {conflicts.some((c) => c.reason !== 'differs') && (
            <button type="button" className="btn sm" onClick={() => onChange(confirmTotalsChecked(draft))}>
              I checked these against the statement
            </button>
          )}
        </div>
      )}
      {check && conflicts.length === 0 && (
        <div className="box tight" aria-label="Totals check">
          <div className="row">
            <b>{check.ok ? (totalsVerified(draft) ? 'Totals match the bank ✓' : 'Totals match the figures you checked') : `Totals differ by ${rp(Math.abs(check.difference))}`}</b>
            <span className={`pill${check.ok ? ' ok' : ''}`}>{rp(check.computed.newBalance)}</span>
          </div>
          <div className="row small">
            <span className="muted">Previous balance</span>
            <span className="num">{fmt(draft.printed.prevBalance ?? 0)}</span>
          </div>
          <div className="row small">
            <span className="muted">− Payments and credits</span>
            <span className="num">{fmt(check.computed.credits)}</span>
          </div>
          <div className="row small">
            <span className="muted">+ Charges, fees, interest</span>
            <span className="num">{fmt(check.computed.purchases + check.computed.feesInterest)}</span>
          </div>
          {!check.ok && <div className="xs muted">The bank printed {rp(check.computed.newBalance - check.difference)}. Fix the row the AI misread; the check runs again.</div>}
        </div>
      )}

      {credits.length > 0 && (
        <div className="box tight">
          <div className="lbl">Credit (CR) lines, sorted</div>
          <div className="row small">
            <span>Payments</span>
            <b>{count('payment')}</b>
          </div>
          <div className="row small">
            <span>Refunds</span>
            <b>{count('refund')}</b>
          </div>
          <div className="row small">
            <span>Reversals</span>
            <b>{count('reversal')}</b>
          </div>
        </div>
      )}

      <div className="lbl">
        {draft.rows.length} {draft.rows.length === 1 ? 'line' : 'lines'} found{draft.fromCache ? ' (read before, no new AI request)' : ''}
      </div>
      {draft.overlapMerged > 0 && <div className="xs muted">{draft.overlapMerged} lines seen on two screenshots were counted once.</div>}
      {draft.rows.length === 0 && <div className="box empty small">No transactions on this file.</div>}
      {draft.rows.map((r) => (
        <RowItem
          key={r.key}
          row={r}
          fixing={fixing === r.key}
          onFix={() => setFixing(fixing === r.key ? null : r.key)}
          onAmount={(n) => onChange(setRowAmount(draft, r.key, n))}
          onCredit={(k) => onChange(setCreditKind(draft, r.key, k))}
          duplicate={dupOf(r.key)}
          onDuplicate={(d) => onChange(decideDuplicate(draft, r.key, d))}
        />
      ))}

      {todo.length > 0 && (
        <ul className="small warn-text">
          {todo.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {error && (
        <div className="small err" role="alert">
          {error}
        </div>
      )}
      {asking ? (
        <div className="status draft" role="alertdialog" aria-label="Save with a difference?">
          <div className="small">
            The totals differ from the bank by <b>{rp(Math.abs(check!.difference))}</b>. The bill for this statement may be wrong until a row is fixed. Save anyway?
          </div>
          <div className="btns">
            <button type="button" className="btn danger" disabled={saving} onClick={() => onSave(true)}>
              Save anyway
            </button>
            <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
              Go back
            </button>
          </div>
        </div>
      ) : null}
      <div className="btns">
        <button
          type="button"
          className="btn acc"
          disabled={todo.length > 0 || saving || asking}
          onClick={() => (differs ? setConfirming(true) : onSave(false))}
        >
          {saving ? 'Saving…' : !isStatement ? 'Save to Unbilled' : differs ? `Save with a difference of ${rp(Math.abs(check!.difference))}` : 'Save statement'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  )
}

function AmountField({ id, label, value, onChange }: { id: string; label: string; value: number | null; onChange(n: number | null): void }) {
  const [text, setText] = useState(value === null ? '' : fmt(value))
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="inp"
        inputMode="numeric"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(parseTyped(e.target.value))
        }}
      />
    </div>
  )
}

const KIND_LABEL: Record<string, string> = { installment: 'Installment', fee: 'Fee', interest: 'Interest', refund: 'Refund', reversal: 'Reversal', payment: 'Payment', unknownCredit: 'Credit' }

function RowItem(props: {
  row: DraftRow
  fixing: boolean
  onFix(): void
  onAmount(n: number): void
  onCredit(k: 'payment' | 'refund'): void
  duplicate?: { where: string; decision?: 'keep' | 'skip' }
  onDuplicate(d: 'keep' | 'skip'): void
}) {
  const { row: r, duplicate } = props
  const [text, setText] = useState(fmt(r.amount))
  return (
    <div className="orow" aria-label={`${r.description} ${fmt(r.amount)}`}>
      <div className="row">
        <span className="small">
          <span className="muted">{r.date.slice(5)}</span> {r.description}
        </span>
        <b className="num">
          {r.amount < 0 ? '−' : ''}
          {fmt(r.amount)}
        </b>
      </div>
      <div className="row xs muted">
        <span>
          {KIND_LABEL[r.kind] ?? ''}
          {r.installment ? ` ${r.installment.n}/${r.installment.of}` : ''}
        </span>
        <button type="button" className="link" onClick={props.onFix}>
          Fix amount
        </button>
      </div>
      {props.fixing && (
        <div className="row">
          <input className="inp" aria-label={`Amount for ${r.description}`} inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} />
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              const n = parseTyped(text)
              if (n !== null) props.onAmount(r.amount < 0 ? -Math.abs(n) : Math.abs(n))
              props.onFix()
            }}
          >
            Save amount
          </button>
        </div>
      )}
      {r.kind === 'unknownCredit' && (
        <div className="chips">
          <span className="xs">What is this credit?</span>
          <button type="button" className="chip mini" onClick={() => props.onCredit('payment')}>
            Payment
          </button>
          <button type="button" className="chip mini" onClick={() => props.onCredit('refund')}>
            Refund
          </button>
        </div>
      )}
      {duplicate && (
        <div className="status draft">
          <div className="small">
            <b>Looks like a duplicate:</b> {r.description} {fmt(r.amount)} on {r.date} is already in {duplicate.where}. Same amount, same day. Two real ones, or the same one seen twice?
          </div>
          <div className="chips">
            <button type="button" className="chip mini" aria-pressed={duplicate.decision === 'keep'} onClick={() => props.onDuplicate('keep')}>
              Keep both
            </button>
            <button type="button" className="chip mini" aria-pressed={duplicate.decision === 'skip'} onClick={() => props.onDuplicate('skip')}>
              Skip this one
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const line = (r: RowSummary) => `${r.date.slice(5)} · ${r.description} · ${fmt(r.amount)}`

function Done({ report, resolved, onResolve, onAgain }: { report: ImportReport; resolved: Record<string, string>; onResolve(id: string, c: 'delete' | 'keepWaiting'): void; onAgain(): void }) {
  const isStatement = report.target === 'statement'
  return (
    <>
      <div className="status final">
        <h3>Saved ✓</h3>
        <div className="xs">
          {report.added.length} new {report.added.length === 1 ? 'row' : 'rows'}
          {report.kept ? `, ${report.kept} kept` : ''}
          {report.skippedDuplicates ? `, ${report.skippedDuplicates} skipped as duplicates` : ''}
          {report.difference ? `. Totals differ by ${rp(Math.abs(report.difference))}` : isStatement ? '. Totals match the bank' : ''}.
        </div>
      </div>
      {report.backfill && <div className="note">Backfill: this created the older statement only. Unbilled wasn&apos;t touched.</div>}
      {(report.moved.length > 0 || report.movedPayments.length > 0) && (
        <div className="box tight">
          <div className="lbl">Moved from Unbilled</div>
          <div className="small">
            {report.moved.length} charges and {report.movedPayments.length} payment lines were already in Unbilled. They now belong to this statement with the same owners and payment assignments.
          </div>
        </div>
      )}
      {report.removed.length > 0 && (
        <div className="box tight">
          <div className="lbl">Not in the new file (removed)</div>
          {report.removed.map((r, i) => (
            <div key={i} className="small">
              {line(r)}
            </div>
          ))}
        </div>
      )}
      {report.notOnStatement.length > 0 && (
        <div className="box tight">
          <div className="lbl">Unbilled that wasn&apos;t billed</div>
          {report.notOnStatement.map((r, i) => {
            const id = report.notOnStatementRowIds[i]
            return (
              <div key={i}>
                <div className="small">{line(r)} was in Unbilled but isn&apos;t on this statement (maybe cancelled or pending).</div>
                {id && (resolved[id] ? <div className="xs">{resolved[id]}</div> : (
                  <div className="chips">
                    <button type="button" className="chip mini" onClick={() => onResolve(id, 'keepWaiting')}>
                      Keep waiting
                    </button>
                    <button type="button" className="chip mini" onClick={() => onResolve(id, 'delete')}>
                      Delete it
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
      {(report.newPayments.length > 0 || report.links.length > 0 || report.missingPayments.length > 0) && (
        <div className="box tight">
          <div className="lbl">Payments</div>
          {report.newPayments.map((p, i) => (
            <div key={i} className="small">
              {line(p)} · <b>new, needs assigning</b>
            </div>
          ))}
          {report.links.length > 0 && <div className="small">{report.links.length} payment recorded by hand matched a bank line (counted once).</div>}
          {report.missingPayments.map((p, i) => (
            <div key={i} className="small">
              {line(p)} was recorded by hand but isn&apos;t on a statement.
            </div>
          ))}
        </div>
      )}
      {report.conversions.length > 0 && (
        <div className="box tight">
          <div className="lbl">Installment conversions</div>
          {report.conversions.map((c, i) => (
            <div key={i} className="small">
              {c.description}: {c.ok ? 'the original purchase moved to installment 1, not counted.' : 'the original purchase was not found (import the earlier statement first).'}
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn" onClick={onAgain}>
        Import another
      </button>
    </>
  )
}
