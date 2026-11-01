// One short message at a time near the bottom of the screen.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

type Show = (message: string) => void
const Ctx = createContext<Show>(() => {})

export const TOAST_MS = 3200

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; n: number } | null>(null)
  const show = useCallback<Show>((text) => setMessage((m) => ({ text, n: (m?.n ?? 0) + 1 })), [])
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [message])
  return (
    <Ctx.Provider value={show}>
      {children}
      {message && (
        <div className="toast" role="status">
          {message.text}
        </div>
      )}
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
