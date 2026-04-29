import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getSetting, setSetting, generateId } from '../db'
import { OWNER_COLOR_CLASSES } from '../lib/format'
import { CLAUDE_MODELS, DEFAULT_MODEL } from '../lib/claude'
import type { Owner, OwnerColor } from '../types'

const APP_VERSION = '1.1.0'

const COLORS: OwnerColor[] = ['blue', 'pink', 'purple', 'green', 'orange', 'teal', 'red', 'yellow']

function PageHeader({ title }: { title: string }) {
  return (
    <div className="bg-blue-700 text-white px-4 py-4 pt-safe">
      <h1 className="text-lg font-bold">{title}</h1>
    </div>
  )
}

export default function Settings() {
  const owners = useLiveQuery(() => db.owners.toArray(), []) ?? []
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL)
  const [editOwner, setEditOwner] = useState<Partial<Owner> | null>(null)
  const [showOwnerForm, setShowOwnerForm] = useState(false)

  useEffect(() => {
    getSetting('anthropic_api_key').then((k) => { if (k) setApiKey(k) })
    getSetting('claude_model').then((m) => { if (m) setSelectedModel(m as typeof DEFAULT_MODEL) })
  }, [])

  async function saveApiKey() {
    await setSetting('anthropic_api_key', apiKey.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function saveOwner() {
    if (!editOwner?.name?.trim()) return
    if (editOwner.id) {
      await db.owners.update(editOwner.id, { name: editOwner.name, color: editOwner.color ?? 'blue' })
    } else {
      await db.owners.add({ id: generateId(), name: editOwner.name, color: editOwner.color ?? 'blue' })
    }
    setShowOwnerForm(false)
    setEditOwner(null)
  }

  async function deleteOwner(id: string) {
    if (!confirm('Delete this owner? Expenses linked to them will still exist but lose the owner.')) return
    await db.owners.delete(id)
  }

  function openNewOwner() {
    setEditOwner({ name: '', color: 'blue' })
    setShowOwnerForm(true)
  }

  function openEditOwner(owner: Owner) {
    setEditOwner({ ...owner })
    setShowOwnerForm(true)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-blue-700 text-white px-4 pt-4 pb-4">
        <h1 className="text-lg font-bold">Settings</h1>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* API Key */}
        <section className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Anthropic API Key</h2>
          <p className="text-xs text-gray-500 mb-3">
            Used for AI parsing of PDFs and screenshots. Stored locally on your device.
          </p>
          <div className="flex gap-2 mb-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <button
            onClick={saveApiKey}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium"
          >
            {saved ? '✓ Saved' : 'Save API Key'}
          </button>
        </section>

        {/* AI Model */}
        <section className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold text-gray-900 mb-1">AI Model</h2>
          <p className="text-xs text-gray-500 mb-3">Used when parsing PDFs and screenshots.</p>
          <div className="space-y-2">
            {CLAUDE_MODELS.map((m) => {
              const active = selectedModel === m.id
              return (
                <button
                  key={m.id}
                  onClick={async () => {
                    setSelectedModel(m.id as typeof DEFAULT_MODEL)
                    await setSetting('claude_model', m.id)
                  }}
                  className={`w-full flex items-center justify-between px-3 py-3 rounded-xl border text-left transition-colors ${
                    active
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div>
                    <p className={`text-sm font-semibold ${active ? 'text-blue-700' : 'text-gray-800'}`}>
                      {m.label}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{m.desc}</p>
                  </div>
                  {active && (
                    <span className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        {/* Owners */}
        <section className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Owners / PIC</h2>
            <button
              onClick={openNewOwner}
              className="text-blue-600 text-sm font-medium"
            >
              + Add
            </button>
          </div>

          <div className="space-y-2">
            {owners.map((owner) => {
              const c = OWNER_COLOR_CLASSES[owner.color] ?? OWNER_COLOR_CLASSES.blue
              return (
                <div key={owner.id} className="flex items-center justify-between py-1">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium ${c.bg} ${c.text}`}>
                    <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                    {owner.name}
                  </span>
                  <div className="flex gap-3">
                    <button onClick={() => openEditOwner(owner)} className="text-sm text-blue-600">Edit</button>
                    <button onClick={() => deleteOwner(owner.id)} className="text-sm text-red-500">Delete</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Installments shortcut */}
        <a href="#/installments" className="block bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between">
            <span className="font-medium text-gray-900">Installment Plans</span>
            <span className="text-gray-400">›</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">Manage active cicilan records</p>
        </a>

        {/* Data */}
        <section className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Data</h2>
          <div className="space-y-2">
            <button onClick={exportData} className="w-full border border-gray-300 rounded-lg py-2.5 text-sm text-gray-700">
              Export Data (JSON backup)
            </button>
            <label className="block w-full border border-gray-300 rounded-lg py-2.5 text-sm text-gray-700 text-center cursor-pointer">
              Import Data (JSON backup)
              <input type="file" accept=".json" className="hidden" onChange={importData} />
            </label>
          </div>
        </section>

        {/* Version */}
        <div className="text-center py-2 pb-4">
          <p className="text-xs text-gray-400">CC Bill · v{APP_VERSION}</p>
          <p className="text-xs text-gray-300 mt-0.5">Data stored locally on this device</p>
        </div>
      </div>

      {/* Owner Form Sheet */}
      {showOwnerForm && editOwner && (
        <div className="fixed inset-0 z-50" onClick={() => setShowOwnerForm(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-900 mb-4">
              {editOwner.id ? 'Edit Owner' : 'New Owner'}
            </h3>

            <label className="block text-sm text-gray-600 mb-1">Name</label>
            <input
              type="text"
              value={editOwner.name ?? ''}
              onChange={(e) => setEditOwner((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Wahyu, Wife, Us"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />

            <label className="block text-sm text-gray-600 mb-2">Color</label>
            <div className="flex flex-wrap gap-2 mb-4">
              {COLORS.map((color) => {
                const c = OWNER_COLOR_CLASSES[color]
                return (
                  <button
                    key={color}
                    onClick={() => setEditOwner((p) => ({ ...p, color }))}
                    className={`px-3 py-1 rounded-full text-sm ${c.bg} ${c.text} ${editOwner.color === color ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
                  >
                    {color}
                  </button>
                )
              })}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowOwnerForm(false)}
                className="flex-1 border border-gray-300 rounded-lg py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveOwner}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

async function exportData() {
  const [owners, periods, transactions, expenses, installmentPlans, payments, paymentAllocations] =
    await Promise.all([
      db.owners.toArray(),
      db.periods.toArray(),
      db.transactions.toArray(),
      db.expenses.toArray(),
      db.installmentPlans.toArray(),
      db.payments.toArray(),
      db.paymentAllocations.toArray(),
    ])

  const data = { owners, periods, transactions, expenses, installmentPlans, payments, paymentAllocations, exportedAt: new Date().toISOString() }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ccbill-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function importData(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  if (!file) return
  if (!confirm('This will REPLACE all existing data. Continue?')) return

  const text = await file.text()
  const data = JSON.parse(text)

  await db.transaction('rw', [db.owners, db.periods, db.transactions, db.expenses, db.installmentPlans, db.payments, db.paymentAllocations], async () => {
    await Promise.all([
      db.owners.clear(), db.periods.clear(), db.transactions.clear(),
      db.expenses.clear(), db.installmentPlans.clear(), db.payments.clear(),
      db.paymentAllocations.clear(),
    ])
    await Promise.all([
      db.owners.bulkPut(data.owners ?? []),
      db.periods.bulkPut(data.periods ?? []),
      db.transactions.bulkPut(data.transactions ?? []),
      db.expenses.bulkPut(data.expenses ?? []),
      db.installmentPlans.bulkPut(data.installmentPlans ?? []),
      db.payments.bulkPut(data.payments ?? []),
      db.paymentAllocations.bulkPut(data.paymentAllocations ?? []),
    ])
  })
  alert('Data imported successfully.')
  e.target.value = ''
}
