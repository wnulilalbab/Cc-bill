import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, generateId } from '../db'
import { extractTextFromPDF, fileToBase64 } from '../lib/pdf'
import { parsePDFText, parseImageFile, detectReversalPairs } from '../lib/claude'
import { formatRupiah, formatDateShort, TX_TYPE_LABEL, TX_TYPE_COLOR } from '../lib/format'
import type { ParsedTransaction, BillPeriod } from '../types'

type Step = 'select' | 'parsing' | 'review' | 'saving'

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

function fileTypeLabel(file: File) {
  return file.type === 'application/pdf' ? 'PDF' : 'Image'
}

export default function Import() {
  const navigate = useNavigate()
  const periods = useLiveQuery(() => db.periods.orderBy('year').reverse().toArray(), []) ?? []

  const pdfInputRef = useRef<HTMLInputElement>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('select')
  const [error, setError] = useState('')
  const [parsed, setParsed] = useState<(ParsedTransaction & { _hide?: boolean })[]>([])
  const [hiddenCount, setHiddenCount] = useState(0)
  const [showHidden, setShowHidden] = useState(false)

  // File queue
  const [queue, setQueue] = useState<QueuedFile[]>([])

  // AI context
  const [context, setContext] = useState('')

  // Parsing progress
  const [progress, setProgress] = useState({ current: 0, total: 0, filename: '' })

  // Period state
  const [useNewPeriod, setUseNewPeriod] = useState(true)
  const [periodId, setPeriodId] = useState('')
  const [newPeriodMonth, setNewPeriodMonth] = useState(defaultPeriod().month)
  const [newPeriodYear, setNewPeriodYear] = useState(defaultPeriod().year)
  const [newPeriodDue, setNewPeriodDue] = useState('')

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
    setQueue((prev) => [
      ...prev,
      ...accepted.map((file) => ({ file, id: generateId() })),
    ])
  }

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((q) => q.id !== id))
  }

  function selectedPeriodLabel() {
    if (!useNewPeriod) {
      return periods.find((p) => p.id === periodId)?.label ?? '—'
    }
    return new Date(newPeriodYear, newPeriodMonth - 1).toLocaleDateString('id-ID', {
      month: 'long',
      year: 'numeric',
    })
  }

  async function startImport() {
    if (useNewPeriod && !newPeriodMonth) {
      setError('Please select the report period first.')
      return
    }
    if (!useNewPeriod && !periodId) {
      setError('Please select an existing period first.')
      return
    }
    if (queue.length === 0) {
      setError('Please add at least one file.')
      return
    }

    setError('')
    setStep('parsing')

    const allResults: (ParsedTransaction & { _hide?: boolean })[] = []

    for (let i = 0; i < queue.length; i++) {
      const { file } = queue[i]
      setProgress({ current: i + 1, total: queue.length, filename: file.name })

      try {
        if (file.type === 'application/pdf') {
          const text = await extractTextFromPDF(file)
          const raw = await parsePDFText(text, context || undefined)
          const withFlags = detectReversalPairs(raw) as (ParsedTransaction & { _hide?: boolean })[]
          allResults.push(...withFlags)
        } else if (file.type.startsWith('image/')) {
          const base64 = await fileToBase64(file)
          const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
          const raw = await parseImageFile(base64, mediaType, context || undefined)
          allResults.push(...raw.map((t) => ({ ...t, _hide: false })))
        }
      } catch (err) {
        setError(`Error on "${file.name}": ${err instanceof Error ? err.message : err}`)
        setStep('select')
        return
      }
    }

    const hidden = allResults.filter((t) => (t as any)._hidden).length
    setHiddenCount(hidden)
    setParsed(allResults)
    setStep('review')
  }

  function removeTransaction(idx: number) {
    setParsed((prev) => prev.filter((_, i) => i !== idx))
  }

  async function save() {
    setStep('saving')
    try {
      let pid = periodId
      if (useNewPeriod || !pid) {
        pid = generateId()
        const period: BillPeriod = {
          id: pid,
          label: selectedPeriodLabel(),
          month: newPeriodMonth,
          year: newPeriodYear,
          dueDate: newPeriodDue || undefined,
          importedAt: new Date().toISOString(),
        }
        await db.periods.put(period)
      }

      const visible = parsed.filter((t) => !(t as any)._hidden)
      await db.transactions.bulkPut(
        visible.map((t) => ({
          id: generateId(),
          periodId: pid,
          date: t.date,
          description: t.description,
          amount: t.amount,
          type: t.type,
          hidden: false,
          raw: t.description,
        }))
      )

      const hidden = parsed.filter((t) => (t as any)._hidden)
      if (hidden.length) {
        await db.transactions.bulkPut(
          hidden.map((t) => ({
            id: generateId(),
            periodId: pid,
            date: t.date,
            description: t.description,
            amount: t.amount,
            type: t.type,
            hidden: true,
            raw: t.description,
          }))
        )
      }

      navigate('/transactions')
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
      setStep('review')
    }
  }

  const visibleParsed = parsed.filter((t) => showHidden || !(t as any)._hidden)

  // ── Parsing screen ─────────────────────────────────────────────
  if (step === 'parsing') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-800 font-semibold text-base">
          Parsing with AI… ({progress.current}/{progress.total})
        </p>
        <p className="text-sm text-gray-500 max-w-xs truncate">{progress.filename}</p>
        <p className="text-xs text-gray-400">This may take 10–20 seconds per file</p>
      </div>
    )
  }

  // ── Saving screen ──────────────────────────────────────────────
  if (step === 'saving') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-600 font-medium">Saving transactions…</p>
      </div>
    )
  }

  // ── Review screen ──────────────────────────────────────────────
  if (step === 'review') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-blue-700 text-white px-4 py-4">
          <h1 className="text-lg font-bold">Review Transactions</h1>
          <p className="text-sm text-blue-200 mt-0.5">
            {visibleParsed.filter((t) => !(t as any)._hidden).length} found
            {hiddenCount > 0 && ` · ${hiddenCount} reversal pairs hidden`}
            {' · '}
            <span className="text-blue-100 font-medium">{selectedPeriodLabel()}</span>
          </p>
        </div>

        {hiddenCount > 0 && (
          <div className="mx-4 mt-3">
            <button
              onClick={() => setShowHidden(!showHidden)}
              className="text-xs text-gray-400 underline"
            >
              {showHidden ? 'Hide' : 'Show'} {hiddenCount} auto-hidden reversal entries
            </button>
          </div>
        )}

        <div className="mx-4 mt-3 mb-32 space-y-2">
          {visibleParsed.map((t, idx) => {
            const hidden = (t as any)._hidden
            return (
              <div
                key={idx}
                className={`bg-white rounded-xl shadow-sm p-3 flex items-start gap-3 ${hidden ? 'opacity-40' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-gray-400">{formatDateShort(t.date)}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${TX_TYPE_COLOR[t.type]}`}>
                      {TX_TYPE_LABEL[t.type]}
                    </span>
                    {hidden && <span className="text-xs text-gray-400">(hidden)</span>}
                  </div>
                  <p className="text-sm text-gray-800 truncate">{t.description}</p>
                  <p className={`text-sm font-semibold mt-0.5 ${t.amount < 0 ? 'text-green-600' : 'text-gray-900'}`}>
                    {t.amount < 0 ? '-' : ''}{formatRupiah(Math.abs(t.amount))}
                  </p>
                </div>
                {!hidden && (
                  <button
                    onClick={() => removeTransaction(parsed.indexOf(t))}
                    className="text-red-400 text-lg leading-none px-1 flex-shrink-0"
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="fixed bottom-16 left-0 right-0 px-4 pb-2">
          <div className="bg-white rounded-xl shadow-lg p-3 flex items-center gap-3">
            {error && <p className="text-xs text-red-500 flex-1">{error}</p>}
            <button
              onClick={() => setStep('select')}
              className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm"
            >
              Back
            </button>
            <button
              onClick={save}
              className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium"
            >
              Save {parsed.filter((t) => !(t as any)._hidden).length} Transactions
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Select step ────────────────────────────────────────────────
  const canImport =
    queue.length > 0 &&
    (useNewPeriod ? !!newPeriodMonth : !!periodId)

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="bg-blue-700 text-white px-4 py-4">
        <h1 className="text-lg font-bold">Import Bill</h1>
        <p className="text-sm text-blue-200 mt-0.5">Set period, add files, then tap Import</p>
      </div>

      <div className="px-4 py-4 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* ── 1. Period picker ── */}
        <section className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold text-gray-900 mb-1">1. Report Period</h2>
          <p className="text-xs text-gray-400 mb-3">When was this bill generated?</p>

          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setUseNewPeriod(true)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border ${useNewPeriod ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}
            >
              New Period
            </button>
            <button
              onClick={() => setUseNewPeriod(false)}
              disabled={periods.length === 0}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border ${!useNewPeriod ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'} disabled:opacity-40`}
            >
              Existing
            </button>
          </div>

          {useNewPeriod ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-500">Month</label>
                  <select
                    value={newPeriodMonth}
                    onChange={(e) => setNewPeriodMonth(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-0.5"
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {new Date(2000, i).toLocaleDateString('id-ID', { month: 'long' })}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500">Year</label>
                  <input
                    type="number"
                    value={newPeriodYear}
                    onChange={(e) => setNewPeriodYear(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-0.5"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Due Date (optional)</label>
                <input
                  type="date"
                  value={newPeriodDue}
                  onChange={(e) => setNewPeriodDue(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-0.5"
                />
              </div>
            </div>
          ) : (
            <select
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select period…</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          )}
        </section>

        {/* ── 2. File upload ── */}
        <section className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold text-gray-900 mb-1">2. Add Files</h2>
          <p className="text-xs text-gray-400 mb-3">PDF statements and/or mobile screenshots</p>

          <div className="flex gap-2 mb-3">
            <button
              onClick={() => pdfInputRef.current?.click()}
              className="flex-1 flex flex-col items-center gap-1.5 py-3 border-2 border-dashed border-blue-200 hover:border-blue-400 rounded-xl text-blue-600 transition-colors"
            >
              <span className="text-2xl">📄</span>
              <span className="text-xs font-medium">PDF Statement</span>
            </button>
            <button
              onClick={() => imgInputRef.current?.click()}
              className="flex-1 flex flex-col items-center gap-1.5 py-3 border-2 border-dashed border-purple-200 hover:border-purple-400 rounded-xl text-purple-600 transition-colors"
            >
              <span className="text-2xl">📱</span>
              <span className="text-xs font-medium">Screenshot</span>
            </button>
          </div>

          {/* Hidden inputs */}
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <input
            ref={imgInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />

          {/* File queue */}
          {queue.length > 0 ? (
            <div className="space-y-1.5">
              {queue.map((q) => (
                <div
                  key={q.id}
                  className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2"
                >
                  <span className="text-base">{fileIcon(q.file)}</span>
                  <span className="flex-1 text-sm text-gray-700 truncate">{q.file.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">{fileTypeLabel(q.file)}</span>
                  <button
                    onClick={() => removeFromQueue(q.id)}
                    className="text-red-400 text-base leading-none px-1 shrink-0"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-center text-gray-400 py-2">No files added yet</p>
          )}
        </section>

        {/* ── 3. AI Context ── */}
        <section className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold text-gray-900 mb-1">3. Context (optional)</h2>
          <p className="text-xs text-gray-400 mb-2">
            Extra hints for AI — e.g. card name, year, or special notes
          </p>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="e.g. BCA Platinum card, transactions from March 2026"
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
          />
        </section>

        {/* ── Import button ── */}
        <button
          onClick={startImport}
          disabled={!canImport}
          className="w-full bg-blue-600 disabled:bg-gray-300 text-white rounded-xl py-3.5 text-base font-semibold shadow-sm transition-colors"
        >
          {queue.length === 0
            ? 'Add Files to Import'
            : `Import ${queue.length} File${queue.length > 1 ? 's' : ''}`}
        </button>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-800 font-medium mb-1">First time?</p>
          <p className="text-xs text-amber-700">
            Make sure you have set your Anthropic API key in Settings before importing.
          </p>
        </div>
      </div>
    </div>
  )
}
