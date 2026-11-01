// Settings → AI: the Anthropic API key and the model. Device-only; never in exports or backups.
import { useState } from 'react'
import { Picker } from '../../components/Picker'
import { useToast } from '../../components/Toast'
import { AI_MODELS, maskKey, readAiSettings, saveAiKey, saveAiModel } from './aiSettings'

export function AiSection() {
  const toast = useToast()
  const [saved, setSaved] = useState(() => readAiSettings())
  const [draft, setDraft] = useState('')

  return (
    <>
      <div className="lbl">AI</div>
      <div className="box tight">
        <div className="field">
          <label htmlFor="aiKey">Anthropic API key</label>
          {saved.apiKey && <div className="small">Saved: <span className="num">{maskKey(saved.apiKey)}</span></div>}
          <input className="inp" id="aiKey" type="password" autoComplete="off" placeholder={saved.apiKey ? 'Paste a new key to replace it' : 'sk-ant-…'} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="btns">
            <button
              type="button"
              className="btn sm"
              disabled={!draft.trim()}
              onClick={() => {
                saveAiKey(draft)
                setSaved(readAiSettings())
                setDraft('')
                toast('API key saved on this phone')
              }}
            >
              Save key
            </button>
            <button
              type="button"
              className="btn ghost sm"
              disabled={!saved.apiKey}
              onClick={() => {
                saveAiKey('')
                setSaved(readAiSettings())
                toast('API key removed')
              }}
            >
              Remove key
            </button>
          </div>
          <div className="xs muted">Kept on this phone only. It is never included in exports or backups.</div>
        </div>
        <div className="field">
          <span className="fl">Model</span>
          <Picker
            title="Model"
            field
            value={saved.model}
            options={AI_MODELS.map((m) => ({ value: m.id, label: m.label, sub: m.desc }))}
            onChange={(model) => {
              saveAiModel(model)
              setSaved(readAiSettings())
            }}
          />
        </div>
      </div>
    </>
  )
}
