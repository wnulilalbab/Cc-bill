import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, generateId, UNBILLED_PERIOD_ID, ensureUnbilledPeriod } from '../db'
import { extractTextFromPDF, fileToBase64 } from '../lib/pdf'
import { parsePDFText, parseImageFile, detectReversalPairs } from '../lib/claude'
import { buildMergePlan, deduplicateUnbilled } from '../lib/merge'
import { formatRupiah, formatDateShort, TX_TYPE_LABEL, TX_TYPE_COLOR } from '../lib/format'
import type { ParsedTransaction, BillPeriod, Transaction } from '../types'
import type { MatchPair, MergePlan } from '../lib/merge'

type Step = 'select' | 'parsing' | 'merge' | 'review' | 'saving'

interface QueuedFile {
  file: File
  id: string
}

function defaultPeriod() {
  const now = new Date()
  const month = now.getMonth() === 0 ? 12 : now.getMonth()
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  return { month, year }
}

function fileIcon(file: File) {
  return file.type === 'application/pdf' ? '📄' : '📱'
}

export default function Import() {
  const navigate = useNavigate()
  // Only billed periods for the period picker
  const periods = useLiveQuery(
    () => db.periods.orderBy('year').reverse().filter((p) => p.type !== 'unbilled').toArray(),
    []
  ) ?? []

  const pdfInputRef = useRef<HTMLInputElement>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('select')
  const [error, setError] = useState('')
  const [queue, setQueue] = useState<QueuedFile[]>([])
  const [context, setContext] = useState('')
  const [progress, setProgress] = useState({ current: 0, total: 0, filename: '' })

  // Screenshot review state
  const [parsed, setParsed] = useState<(ParsedTransaction & { _hidden?: boolean })[]>([])
  const [hiddenCount, setHiddenCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)
  const [showHidden, setShowHidden] = useState(false)

  // Merge state (PDF statement flow)
  const [mergePlan, setMergePlan] = useState<MergePlan>({ matched: [], newOnes: [] })
  const [hiddenParsed, setHiddenParsed] = useState<ParsedTransaction[]>([])
  const [brokenMatches, setBrokenMatches] = useState<Set<string>>(new Set())

  // Period state — only used for statement (PDF) imports
  const [useNewPeriod, setUseNewPeriod] = useState(true)
  const [periodId, setPeriodId] = useState('')
  const [newPeriodMonth, setNewPeriodMonth] = useState(defaultPeriod().month)
  const [newPeriodYear, setNewPeriodYear] = useState(defaultPeriod().year)
  const [newPeriodDue, setNewPeriodDue] = useState('')

  // Derived: are any PDFs in the queue?
  const isStatementImport = queue.some((q) => q.file.type === 'application/pdf')

  function addFiles(files: FileList | null) {
    if (!files) return
    const accepted = Array.from(files).filter(
      (f) => f.type === 'application/pdf' || f.type.startsWith('image/')
    )
    if (accepted.length === 0) {
      setError('Only PDF and image files are supported.')
      return
    }
    setError('')
    setQueue((prev) => [...prev, ...accepted.map((file) => ({ file, id: generateId() }))])
  }

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((q) => q.id !== id))
  }

  function selectedPeriodLabel() {
    if (!useNewPeriod) return periods.find((p) => p.id === periodId)?.label ?? '—'
    return new Date(newPeriodYear, newPeriodMonth - 1).toLocaleDateString('id-ID', {
      month: 'long', year: 'numeric',
    })
  }

  // ── Start import ────────────────────────────────────────────────
  async function startImport() {
    if (isStatementImport) {
      if (useNewPeriod && !newPeriodMonth) { setError('Please select the report period first.'); return }
      if (!useNewPeriod && !periodId) { setError('Please select an existing period first.'); return }
    }
    if (queue.length === 0) { setError('Please add at least one file.'); return }

    setError('')
    setStep('parsing')

    const allRaw: ParsedTransaction[] = []

    for (let i = 0; i < queue.length; i++) {
      const { file } = queue[i]
      setProgress({ current: i + 1, total: queue.length, filename: file.name })

      try {
        if (file.type === 'application/pdf') {
          const text = await extractTextFromPDF(file)
          const rows = await parsePDFText(text, context || undefined)
          allRaw.push(...rows)
        } else if (file.type.startsWith('image/')) {
          const base64 = await fileToBase64(file)
          const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
          const rows = await parseImageFile(base64, mediaType, context || undefined)
          allRaw.push(...rows)
        }
      } catch (err) {
        setError(`Error on "${file.name}": ${err instanceof Error ? err.message : err}`)
        setStep('select')
        return
      }
    }

    if (isStatementImport) {
      await handleStatementParsed(allRaw)
    } else {
      await handleScreenshotParsed(allRaw)
    }
  }

  async function handleScreenshotParsed(allRaw: ParsedTransaction[]) {
    // Dedup against the shared unbilled pool
    const existingUnbilled: Transaction[] = await db.transactions
      .where('periodId').equals(UNBILLED_PERIOD_ID)
      .toArray()

    const { kept, skipped } = deduplicateUnbilled(allRaw, existingUnbilled)
    setSkippedCount(skipped.length)

    const withFlags = detectReversalPairs(kept) as (ParsedTransaction & { _hidden?: boolean })[]
    setHiddenCount(withFlags.filter((t) => (t as any)._hidden).length)
    setParsed(withFlags)
    setStep('review')
  }

  async function handleStatementParsed(allRaw: ParsedTransaction[]) {
    const withFlags = detectReversalPairs(allRaw) as (ParsedTransaction & { _hidden?: boolean })[]
    const visible = withFlags.filter((t) => !(t as any)._hidden)
    const hidden = withFlags.filter((t) => (t as any)._hidden)

    setHiddenParsed(hidden)

    // Load the shared unbilled pool
    const pool: Transaction[] = await db.transactions
      .where('periodId').equals(UNBILLED_PERIOD_ID)
      .filter((t) => !t.hidden)
      .toArray()

    const plan = buildMergePlan(visible, pool)
    setMergePlan(plan)
    setBrokenMatches(new Set())
    setStep('merge')
  }

  function breakMatch(unbilledId: string) {
    setBrokenMatches((prev) => new Set([...prev, unbilledId]))
  }

  function restoreMatch(unbilledId: string) {
    setBrokenMatches((prev) => { const s = new Set(prev); s.delete(unbilledId); return s })
  }

  const effectiveMatched = mergePlan.matched.filter((p) => !brokenMatches.has(p.unbilled.id))
  const effectiveNew = [
    ...mergePlan.newOnes,
    ...mergePlan.matched.filter((p) => brokenMatches.has(p.unbilled.id)).map((p) => p.parsed),
  ]

  function removeTransaction(idx: number) {
    setParsed((prev) => prev.filter((_, i) => i !== idx))
  }

  // ── Save: screenshot → shared unbilled pool ─────────────────────
  async function saveScreenshot() {
    setStep('saving')
    try {
      await ensureUnbilledPeriod()

      const visible = parsed.filter((t) => !(t as any)._hidden)
      const hidden = parsed.filter((t) => (t as any)._hidden)

      await db.transactions.bulkPut([
        ...visible.map((t) => ({
          id: generateId(), periodId: UNBILLED_PERIOD_ID,
          date: t.date, description: t.description, amount: t.amount,
          type: t.type, hidden: false, source: 'screenshot' as const, raw: t.description,
        })),
        ...hidden.map((t) => ({
          id: generateId(), periodId: UNBILLED_PERIOD_ID,
          date: t.date, description: t.description, amount: t.amount,
          type: t.type, hidden: true, source: 'screenshot' as const, raw: t.description,
        })),
      ])

      navigate('/transactions')
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
      setStep('review')
    }
  }

  // ── Save: statement/merge flow ──────────────────────────────────
  async function saveStatement() {
    setStep('saving')
    try {
      let pid = periodId
      if (useNewPeriod || !pid) {
        pid = generateId()
        await db.periods.put({
          id: pid,
          label: selectedPeriodLabel(),
          month: newPeriodMonth,
          year: newPeriodYear,
          dueDate: newPeriodDue || undefined,
          importedAt: new Date().toISOString(),
          type: 'billed',
        } as BillPeriod)
      }

      for (const pair of effectiveMatched) {
        await db.transactions.update(pair.unbilled.id, { periodId: pid, source: 'statement' })
      }

      await db.transactions.bulkPut([
        ...effectiveNew.map((t) => ({
          id: generateId(), periodId: pid,
          date: t.date, description: t.description, amount: t.amount,
          type: t.type, hidden: false, source: 'statement' as const, raw: t.description,
        })),
        ...hiddenParsed.map((t) => ({
          id: generateId(), periodId: pid,
          date: t.date, description: t.description, amount: t.amount,
          type: t.type, hidden: true, source: 'statement' as const, raw: t.description,
        })),
      ])

      navigate('/transactions')
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
      setStep('merge')
    }
  }

  // ── Screens ─────────────────────────────────────────────────────

  if (step === 'parsing') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-800 font-semibold text-base">
          Parsing with AI… ({progress.current}/{progress.total})
        </p>
        <p className="text-sm text-gray-500 max-w-xs truncate">{progress.filename}</p>
        <p className="text-xs text-gray-400">10–20 seconds per file</p>
      </div>
    )
  }

  if (step === 'saving') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-600 font-medium">Saving transactions…</p>
      </div>
    )
  }

  // ── Merge screen ────────────────────────────────────────────────
  if (step === 'merge') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-blue-700 text-white px-4 py-4">
          <h1 className="text-lg font-bold">Merge Preview</h1>
          <p className="text-sm text-blue-200 mt-0.5">
            {effectiveMatched.length} matched · {effectiveNew.length} new
            {hiddenParsed.length > 0 && ` · ${hiddenParsed.length} reversals`}
            {' · '}<span className="text-blue-100 font-medium">{selectedPeriodLabel()}</span>
          </p>
        </div>

        <div className="px-4 pt-4 pb-36 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {mergePlan.matched.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Matched from Unbilled — labels &amp; payments preserved
              </p>
              <div className="space-y-2">
                {mergePlan.matched.map((pair) => (
                  <MatchCard
                    key={pair.unbilled.id}
                    pair={pair}
                    broken={brokenMatches.has(pair.unbilled.id)}
                    onBreak={() => breakMatch(pair.unbilled.id)}
                    onRestore={() => restoreMatch(pair.unbilled.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {effectiveNew.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                New — will need labeling
              </p>
              <div className="space-y-2">
                {effectiveNew.map((t, idx) => (
                  <div key={idx} className="bg-white rounded-xl shadow-sm p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-gray-400">{formatDateShort(t.date)}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${TX_TYPE_COLOR[t.type]}`}>
                        {TX_TYPE_LABEL[t.type]}
                      </span>
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">new</span>
                    </div>
                    <p className="text-sm text-gray-800 truncate">{t.description}</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">
                      {formatRupiah(Math.abs(t.amount))}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {mergePlan.matched.length === 0 && effectiveNew.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-3">🤔</p>
              <p>No transactions found in the PDF.</p>
            </div>
          )}
        </div>

        <div className="fixed bottom-16 left-0 right-0 px-4 pb-2">
          <div className="bg-white rounded-xl shadow-lg p-3 flex items-center gap-3">
            <button onClick={() => setStep('select')}
              className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm">Back</button>
            <button onClick={saveStatement}
              className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium">
              Confirm Import
              {effectiveMatched.length > 0 && ` · ${effectiveMatched.length} merged`}
              {effectiveNew.length > 0 && ` · ${effectiveNew.length} new`}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Review screen (screenshot) ──────────────────────────────────
  if (step === 'review') {
    const visibleParsed = parsed.filter((t) => showHidden || !(t as any)._hidden)
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-orange-500 text-white px-4 py-4">
          <h1 className="text-lg font-bold">Review — Unbilled Pool</h1>
          <p className="text-sm text-orange-100 mt-0.5">
            {parsed.filter((t) => !(t as any)._hidden).length} to save
            {skippedCount > 0 && <span className="text-orange-200"> · {skippedCount} duplicates skipped</span>}
            {hiddenCount > 0 && ` · ${hiddenCount} reversal pairs hidden`}
          </p>
        </div>

        {hiddenCount > 0 && (
          <div className="mx-4 mt-3">
            <button onClick={() => setShowHidden(!showHidden)}
              className="text-xs text-gray-400 underline">
              {showHidden ? 'Hide' : 'Show'} {hiddenCount} auto-hidden reversal entries
            </button>
          </div>
        )}

        <div className="mx-4 mt-3 mb-32 space-y-2">
          {visibleParsed.map((t, idx) => {
            const hidden = (t as any)._hidden
            return (
              <div key={idx}
                className={`bg-white rounded-xl shadow-sm p-3 flex items-start gap-3 ${hidden ? 'opacity-40' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs text-gray-400">{formatDateShort(t.date)}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${TX_TYPE_COLOR[t.type]}`}>
                      {TX_TYPE_LABEL[t.type]}
                    </span>
                    <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Pending</span>
                    {hidden && <span className="text-xs text-gray-400">(hidden)</span>}
                  </div>
                  <p className="text-sm text-gray-800 truncate">{t.description}</p>
                  <p className={`text-sm font-semibold mt-0.5 ${t.amount < 0 ? 'text-green-600' : 'text-gray-900'}`}>
                    {t.amount < 0 ? '-' : ''}{formatRupiah(Math.abs(t.amount))}
                  </p>
                </div>
                {!hidden && (
                  <button onClick={() => removeTransaction(parsed.indexOf(t))}
                    className="text-red-400 text-lg leading-none px-1 flex-shrink-0">×</button>
                )}
              </div>
            )
          })}
        </div>

        <div className="fixed bottom-16 left-0 right-0 px-4 pb-2">
          <div className="bg-white rounded-xl shadow-lg p-3 flex items-center gap-3">
            {error && <p className="text-xs text-red-500 flex-1">{error}</p>}
            <button onClick={() => setStep('select')}
              className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm">Back</button>
            <button onClick={saveScreenshot}
              className="flex-1 bg-orange-500 text-white rounded-lg py-2.5 text-sm font-medium">
              Save {parsed.filter((t) => !(t as any)._hidden).length} to Unbilled
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Select step ─────────────────────────────────────────────────
  const periodValid = useNewPeriod ? !!newPeriodMonth : !!periodId
  const canImport = queue.length > 0 && (!isStatementImport || periodValid)

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="bg-blue-700 text-white px-4 py-4">
        <h1 className="text-lg font-bold">Import</h1>
        <p className="text-sm text-blue-200 mt-0.5">
          {isStatementImport
            ? 'Statement PDF — will merge with Unbilled pool'
            : 'Screenshots — saved to shared Unbilled pool'}
        </p>
      </div>

      <div className="px-4 py-4 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Step 1 — Period (statement only) or Unbilled info */}
        {isStatementImport ? (
          <section className="bg-white rounded-xl shadow-sm p-4">
            <h2 className="font-semibold text-gray-900 mb-1">1. Bill Period</h2>
            <p className="text-xs text-gray-400 mb-3">Which month's official bill is this?</p>

            <div className="flex gap-2 mb-3">
              <button onClick={() => setUseNewPeriod(true)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border ${useNewPeriod ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                New Period
              </button>
              <button onClick={() => setUseNewPeriod(false)} disabled={periods.length === 0}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border ${!useNewPeriod ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'} disabled:opacity-40`}>
                Existing
              </button>
            </div>

            {useNewPeriod ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500">Month</label>
                    <select value={newPeriodMonth}
                      onChange={(e) => setNewPeriodMonth(Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-0.5">
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {new Date(2000, i).toLocaleDateString('id-ID', { month: 'long' })}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500">Year</label>
                    <input type="number" value={newPeriodYear}
                      onChange={(e) => setNewPeriodYear(Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-0.5" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Due Date (optional)</label>
                  <input type="date" value={newPeriodDue}
                    onChange={(e) => setNewPeriodDue(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-0.5" />
                </div>
              </div>
            ) : (
              <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Select period…</option>
                {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            )}
          </section>
        ) : (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3">
            <span className="text-2xl shrink-0">⏳</span>
            <div>
              <p className="text-sm font-semibold text-orange-800">Saved to Unbilled Pool</p>
              <p className="text-xs text-orange-600 mt-0.5">
                All screenshots share one pool — no month needed.
                When the statement PDF arrives, transactions will be matched and merged automatically.
              </p>
            </div>
          </div>
        )}

        {/* Files */}
        <section className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold text-gray-900 mb-1">
            {isStatementImport ? '2.' : '1.'} Add Files
          </h2>
          <p className="text-xs text-gray-400 mb-3">
            PDF = statement import · Images = screenshot (unbilled)
          </p>

          <div className="flex gap-2 mb-3">
            <button onClick={() => pdfInputRef.current?.click()}
              className="flex-1 flex flex-col items-center gap-1.5 py-3 border-2 border-dashed border-blue-200 hover:border-blue-400 rounded-xl text-blue-600 transition-colors">
              <span className="text-2xl">📄</span>
              <span className="text-xs font-medium">PDF Statement</span>
            </button>
            <button onClick={() => imgInputRef.current?.click()}
              className="flex-1 flex flex-col items-center gap-1.5 py-3 border-2 border-dashed border-orange-200 hover:border-orange-400 rounded-xl text-orange-600 transition-colors">
              <span className="text-2xl">📱</span>
              <span className="text-xs font-medium">Screenshot</span>
            </button>
          </div>

          <input ref={pdfInputRef} type="file" accept="application/pdf" multiple className="hidden"
            onChange={(e) => addFiles(e.target.files)} />
          <input ref={imgInputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => addFiles(e.target.files)} />

          {queue.length > 0 ? (
            <div className="space-y-1.5">
              {queue.map((q) => (
                <div key={q.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-base">{fileIcon(q.file)}</span>
                  <span className="flex-1 text-sm text-gray-700 truncate">{q.file.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">
                    {q.file.type === 'application/pdf' ? 'PDF' : 'Image'}
                  </span>
                  <button onClick={() => removeFromQueue(q.id)}
                    className="text-red-400 text-base leading-none px-1 shrink-0">×</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-center text-gray-400 py-2">No files added yet</p>
          )}
        </section>

        {/* Context */}
        <section className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold text-gray-900 mb-1">
            {isStatementImport ? '3.' : '2.'} Context (optional)
          </h2>
          <p className="text-xs text-gray-400 mb-2">Extra hints for AI — card name, year, notes</p>
          <textarea value={context} onChange={(e) => setContext(e.target.value)}
            placeholder="e.g. BCA Platinum card, transactions from March 2026"
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
        </section>

        <button onClick={startImport} disabled={!canImport}
          className={`w-full disabled:bg-gray-300 text-white rounded-xl py-3.5 text-base font-semibold shadow-sm transition-colors ${isStatementImport ? 'bg-blue-600' : 'bg-orange-500'}`}>
          {queue.length === 0
            ? 'Add Files to Import'
            : `Import ${queue.length} File${queue.length > 1 ? 's' : ''}`}
        </button>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-800 font-medium mb-1">First time?</p>
          <p className="text-xs text-amber-700">
            Set your Anthropic API key in Settings before importing.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Match card ──────────────────────────────────────────────────
function MatchCard({ pair, broken, onBreak, onRestore }: {
  pair: MatchPair; broken: boolean; onBreak: () => void; onRestore: () => void
}) {
  const { parsed, unbilled } = pair
  return (
    <div className={`bg-white rounded-xl shadow-sm p-3 border ${broken ? 'border-red-200 opacity-60' : 'border-green-200'}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs text-gray-400">{formatDateShort(parsed.date)}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${TX_TYPE_COLOR[parsed.type]}`}>
              {TX_TYPE_LABEL[parsed.type]}
            </span>
            {broken
              ? <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">unlinked</span>
              : <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">matched ✓</span>
            }
          </div>
          <p className="text-sm text-gray-800 truncate">{parsed.description}</p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5">
            {formatRupiah(Math.abs(parsed.amount))}
          </p>
          {!broken && (
            <p className="text-xs text-gray-400 mt-1 italic">
              {(unbilled as any).label
                ? `Label: ${(unbilled as any).label}`
                : 'No label yet — will carry over when labeled'}
            </p>
          )}
        </div>
        <button onClick={broken ? onRestore : onBreak}
          className={`text-xs px-2 py-1 rounded-lg border shrink-0 ${broken ? 'border-green-300 text-green-600' : 'border-red-200 text-red-400'}`}>
          {broken ? 'Re-link' : 'Unlink'}
        </button>
      </div>
    </div>
  )
}
