// Share sheet (docs/intent/phase-1.md §9; layout from the prototype's "Share preview"): who it is for (one person or
// everyone), Bahasa/English, include the list of charges, the message preview, the Draft warning, "Sent before",
// and Send via WhatsApp / Share… / Copy. The message comes from src/domain/share. No phone number is asked or stored.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Picker } from '../../components/Picker'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import { cardBill } from '../../domain/bill'
import type { ShareLang } from '../../domain/share/format'
import { whatsappAppUrl, whatsappWebUrl } from '../../domain/share/links'
import { shareCard, shareText, type ShareTarget } from '../../domain/share/message'
import type { Ledger } from '../../domain/types'
import type { OwnerRecord } from '../../data/cards'
import { listShares, logShare, sameTarget } from '../../data/shares'
import { useData } from '../data/DataContext'
import { useDbQuery } from '../data/useDbQuery'
import { paletteOf } from '../look/palettes'
import { canShareFile, rp } from '../settings/format'
import { dayLabel, statementName } from '../transactions/view'
import { downloadBlob, imageFileName, renderSharePng } from './image'

/** Navigation the sheet does itself (the WhatsApp app scheme when the browser blocks the new tab). Replaceable in tests. */
export const nav = { assign: (url: string) => window.location.assign(url) }

/** Draws the share image (canvas). Replaceable in tests: jsdom has no canvas. */
export const imageIO = { render: renderSharePng }

const PROBE = () => new File([new Uint8Array(0)], 'share.png', { type: 'image/png' })

/** Today on this phone (local calendar date, not UTC). */
export function localToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const NONE = 'none'
const toValue = (t: ShareTarget) => (t === 'all' ? 'all' : t.ownerId === null ? NONE : `o:${t.ownerId}`)
const toTarget = (v: string): ShareTarget => (v === 'all' ? 'all' : v === NONE ? { ownerId: null } : { ownerId: v.slice(2) })

export interface ShareSheetProps {
  ledger: Ledger
  card: { id: string; name: string; palette?: string }
  /** The card's owners, archived ones included. */
  owners: readonly OwnerRecord[]
  statementId: string
  /** Default everyone. */
  initialTarget?: ShareTarget
  /** Default: today on this phone. */
  today?: string
  onClose(): void
}

export function ShareSheet({ ledger, card, owners, statementId, initialTarget = 'all', today = localToday(), onClose }: ShareSheetProps) {
  const { db } = useData()
  const toast = useToast()
  const [target, setTarget] = useState<ShareTarget>(initialTarget)
  const [lang, setLang] = useState<ShareLang>('id')
  const [list, setList] = useState(true)
  const [manualCopy, setManualCopy] = useState(false)
  const copyBox = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (manualCopy) copyBox.current?.select()
  }, [manualCopy])

  const ctx = { ledger, card, owners, statementId, today, lang, list }
  const shared = shareCard(ctx, target)
  const message = { text: shareText(shared), total: shared.total, final: shared.final }
  const [canShareImage] = useState(() => canShareFile(PROBE()))
  const [imageBusy, setImageBusy] = useState(false)
  const bills = useMemo(() => cardBill(ledger, owners.map((o) => o.id), statementId, today), [ledger, owners, statementId, today])
  const nowOf = (t: ShareTarget) => (t === 'all' ? bills.total : (bills.owners.find((b) => b.ownerId === t.ownerId)?.mustPay ?? 0))
  const nameOf = (t: ShareTarget) => (t === 'all' ? 'Everyone' : t.ownerId === null ? 'No owner' : (owners.find((o) => o.id === t.ownerId)?.name ?? 'Unknown'))

  const shares = useDbQuery(() => listShares(db, card.id, statementId), [db, card.id, statementId])
  const past = (shares ?? []).filter((x) => target === 'all' || sameTarget(x.target, target))
  const statement = ledger.statements.find((s) => s.id === statementId)

  const options = [
    { value: 'all', label: 'Everyone' },
    ...owners.map((o) => ({ value: toValue({ ownerId: o.id }), label: o.name, ...(o.archived && { sub: 'Archived' }) })),
    ...(bills.owners.some((b) => b.ownerId === null) ? [{ value: NONE, label: 'No owner' }] : []),
  ]

  const log = () =>
    logShare(db, card.id, statementId, { target, total: message.total, date: today }).catch((e: unknown) =>
      toast(`Shared, but could not log it: ${e instanceof Error ? e.message : String(e)}`),
    )

  const sendWhatsApp = () => {
    const w = window.open(whatsappWebUrl(message.text), '_blank')
    if (w) w.opener = null
    else nav.assign(whatsappAppUrl(message.text))
    void log()
  }

  const shareNative = async () => {
    try {
      await navigator.share({ text: message.text })
      void log()
    } catch (e) {
      // The person closed the phone's share sheet: nothing was sent.
      if (e instanceof Error && e.name === 'AbortError') return
      toast(`Could not share: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const shareImage = async () => {
    if (imageBusy) return
    setImageBusy(true)
    try {
      const png = await imageIO.render(shared, paletteOf(card.palette))
      const file = new File([png], imageFileName(shared), { type: 'image/png' })
      if (canShareFile(file)) {
        await navigator.share({ files: [file] })
      } else {
        downloadBlob(file.name, png)
        toast('Image saved. Send it from your gallery or files.')
      }
      void log()
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) toast(`Could not make the image: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setImageBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text)
      toast('Copied. Paste it in WhatsApp.')
      void log()
    } catch {
      setManualCopy(true)
      toast('Select the text and copy it')
    }
  }

  const canShare = typeof navigator.share === 'function'

  return (
    <Sheet title="Share preview" onClose={onClose}>
      <div className="xs muted">
        {card.name} · {statementName(statement)}
      </div>
      <div className="row">
        <Picker title="Share with" value={toValue(target)} options={options} onChange={(v) => setTarget(toTarget(v))} />
        <span className="chips" role="group" aria-label="Message language">
          <button type="button" className="chip mini" aria-pressed={lang === 'id'} onClick={() => setLang('id')}>
            Bahasa
          </button>
          <button type="button" className="chip mini" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
            English
          </button>
        </span>
      </div>

      <pre className="waimg share-preview" aria-label="Message preview">
        {message.text}
      </pre>
      <label className="small">
        <input type="checkbox" checked={list} onChange={(e) => setList(e.target.checked)} /> Include the list of charges
      </label>

      {!message.final && (
        <div className="status draft" role="note" aria-label="Draft warning">
          <h3>This bill is still a Draft</h3>
          <div className="xs">
            The numbers may change before it is Final, so the message is marked "{lang === 'id' ? 'sementara' : 'provisional'}". Resolve the Draft items first if you can.
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div className="box tight" aria-label="Sent before">
          <div className="lbl">Sent before</div>
          {past.map((x, i) => {
            const now = nowOf(x.target)
            return (
              <div className="row small" key={i}>
                <span>
                  {dayLabel(x.date)} · {nameOf(x.target)}
                </span>
                <span className="num">
                  {rp(x.total)}
                  {now !== x.total && <span className="pill warn"> now {rp(now)}</span>}
                </span>
              </div>
            )
          })}
          <div className="xs muted">Numbers change when payments come in after you share.</div>
        </div>
      )}

      {manualCopy && <textarea ref={copyBox} className="inp xs" readOnly rows={6} aria-label="Message text" value={message.text} />}

      <button type="button" className="btn acc" onClick={sendWhatsApp}>
        Send via WhatsApp
      </button>
      <div className="btns">
        <button type="button" className="btn ghost" disabled={imageBusy} onClick={shareImage}>
          {canShareImage ? 'Share image' : 'Save image'}
        </button>
        {canShare && (
          <button type="button" className="btn ghost" onClick={shareNative}>
            Share…
          </button>
        )}
        <button type="button" className="btn ghost" onClick={copy}>
          Copy as text
        </button>
      </div>
    </Sheet>
  )
}
