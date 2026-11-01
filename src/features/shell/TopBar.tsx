// The top bar of every screen (prototype `topbar()`): the screen title, optional actions, and the gear that opens
// Settings. Sub-screens get a Back button and a centred title.
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BackIcon, GearIcon } from '../../components/icons'
import { PATHS } from './paths'

export interface TopBarProps {
  title: string
  /** Small line above the title. */
  sub?: string
  /** Shows Back: goes back in history, or to this path when the screen was opened directly. */
  backTo?: string
  /** Extra controls left of the gear. */
  actions?: ReactNode
  /** The gear to Settings (off on Settings itself). */
  gear?: boolean
}

/** Back in history when there is somewhere to go back to in this app, else to `fallback`. */
export function useBack(fallback: string) {
  const navigate = useNavigate()
  return () => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate(fallback))
}

export function SettingsLink() {
  return (
    <Link className="iconbtn" to={PATHS.settings} aria-label="Settings">
      <GearIcon />
    </Link>
  )
}

export function TopBar({ title, sub, backTo, actions, gear = true }: TopBarProps) {
  const right = (
    <div className="top-actions">
      {actions}
      {gear && <SettingsLink />}
      {!actions && !gear && backTo !== undefined && <span className="iconspacer" />}
    </div>
  )
  if (backTo !== undefined) {
    return (
      <header className="top">
        <BackButton to={backTo} />
        <div className="top-title center">
          {sub && <div className="sub">{sub}</div>}
          <h1>{title}</h1>
        </div>
        {right}
      </header>
    )
  }
  return (
    <header className="top">
      <div className="top-title">
        {sub && <div className="sub">{sub}</div>}
        <h1>{title}</h1>
      </div>
      {right}
    </header>
  )
}

function BackButton({ to }: { to: string }) {
  const back = useBack(to)
  return (
    <button type="button" className="iconbtn" aria-label="Back" onClick={back}>
      <BackIcon />
    </button>
  )
}
