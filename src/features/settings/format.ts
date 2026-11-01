/** "Rp 1.234.567" (Indonesian thousands separators), for integer rupiah. */
export const rp = (n: number) => `${n < 0 ? '−' : ''}Rp ${Math.abs(n).toLocaleString('id-ID')}`

/** Saves `text` as a file through a temporary link. */
export function downloadText(fileName: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** True when this browser can hand a file to the phone's share sheet (e.g. "Save to Files" on iOS). */
export function canShareFile(file: File): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
}

export const jsonFile = (fileName: string, text: string) => new File([text], fileName, { type: 'application/json' })
