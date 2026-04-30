import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, generateId } from '../db'
import { extractTextFromPDF, fileToBase64 } from '../lib/pdf'
import { parsePDFText, parseImageFile, detectReversalPairs } from '../lib/claude'
import { formatRupiah, formatDateShort, TX_TYPE_LABEL, TX_TYPE_COLOR } from '../lib/format'
import type { ParsedTransaction, BillPeriod } from '../types'

type Step = 'select' | 'parsing' | 'review' | 'saving'

// Default to previous month — bills are almost always for last month
function defaultPeriod() {
  const now = new Date()
  const month = now.getMonth() === 0 ? 12 : now.getMonth()
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  return { month, year }
}

export default function Import() {
  const navigate = useNavigate()
  const periods = useLiveQuery(() => db.periods.orderBy('year').reverse().toArray(), []) ?? []

  const [step, setStep] = useState<Step>('select')
  const [error, setError] = useState('')
  const [parsed, setParsed] = useState<(ParsedTransaction & { _hide?: boolean })[]>([])
  const [hiddenCount, setHiddenCount] = useState(0)
  const [showHidden, setShowHidden] = useState(false)

  // Period state — shown on the select screen before upload
  const [useNewPeriod, setUseNewPeriod] = useState(true)
  const [periodId, setPeriodId] = useState('')
  const [newPeriodMonth, setNewPeriodMonth] = useState(defaultPeriod().month)
  const [newPeriodYear, setNewPeriodYear] = useState(defaultPeriod().year)
  const [newPeriodDue, setNewPeriodDue] = useState('')

  async function handleFile(file: File) {
    if (useNewPeriod && !newPeriodMonth) {
      setError('Please select the report period first.')
      return
    }
    if (!useNewPeriod && !periodId) {
      setError('Please select an existing period first.')
      return
    }

    setError('')
    setStep('parsing')
    try {
      let result: (ParsedTransaction & { _hide?: boolean })[]

      if (file.type === 'application/pdf') {
        const text = await extractTextFromPDF(file)
        const rawParsed = await parsePDFText(text)
        result = detectReversalPairs(rawParsed) as typeof result
      } else if (file.type.startsWith('image/')) {
        const base64 = await fileToBase64(file)
        const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
        const rawParsed = await parseImageFile(base64, mediaType)
        result = rawParsed.map((t) => ({ ...t, _hide: false }))
      } else {
        throw new Error('Unsupported file type. Please upload a PDF or image.')
      }

      const hidden = result.filter((t) => (t as any)._hidden).length
      setHiddenCount(hidden)
      setParsed(result)
      setStep('review')
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
      setStep('select')
    }
  }

  function removeTransaction(idx: number) {
    setParsed((prev) => prev.filter((_, i) => i !== idx))
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

  async function save() {
    setStep('saving')
    try {
      let pid = periodId
      if (useNewPeriod || !pid) {
        pid = generateId()
        const label = selectedPeriodLabel()
        const period: BillPeriod = {
          id: pid,
          label,
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

  if (step === 'parsing') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-600 font-medium">Parsing with AI…</p>
        <p className="text-xs text-gray-400">This may take 10–20 seconds</p>
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

  if (step === 'review') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-blue-700 text-white px-4 py-4">
          <h1 className="text-lg font-bold">Review Transactions</h1>
          <p className="text-sm text-blue-200 mt-0.5">
            {visibleParsed.filter((t) => !(t as any)._hidden).length} found
            {hiddenCount > 0 && ` · ${hiddenCount} reversal pairs hidden`}
            {' · '}<span className="text-blue-100 font-medium">{selectedPeriodLabel()}</span>
          </p>
        </div>

        {/* Reversal toggle */}
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

        {/* Transaction list */}
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
                    {t.amount < 0 ? '-' : ''}{formatRupiah(t.amount)}
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

        {/* Sticky save bar */}
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
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-blue-700 text-white px-4 py-4">
        <h1 className="text-lg font-bold">Import Bill</h1>
        <p className="text-sm text-blue-200 mt-0.5">Set the report period, then upload</p>
      </div>

      <div className="px-4 py-4 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* ── Period picker — shown FIRST, before upload ── */}
        <section className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold text-gray-900 mb-1">Report Period</h2>
          <p className="text-xs text-gray-400 mb-3">When was this bill / screenshot generated?</p>

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

        {/* ── Upload buttons ── */}
        <label className="block bg-white rounded-xl shadow-sm p-6 text-center cursor-pointer border-2 border-dashed border-blue-200 hover:border-blue-400 transition-colors">
          <div className="text-4xl mb-3">📄</div>
          <p className="font-semibold text-gray-900">Upload BCA Statement PDF</p>
          <p className="text-sm text-gray-500 mt-1">Billed transactions</p>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </label>

        <label className="block bg-white rounded-xl shadow-sm p-6 text-center cursor-pointer border-2 border-dashed border-purple-200 hover:border-purple-400 transition-colors">
          <div className="text-4xl mb-3">📱</div>
          <p className="font-semibold text-gray-900">Upload BCA Mobile Screenshot</p>
          <p className="text-sm text-gray-500 mt-1">Unbilled transactions</p>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </label>

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
