import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

export async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const pageTexts: string[] = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()

    // Group items by approximate y-position to reconstruct lines
    const Y_TOLERANCE = 3
    const rows: { y: number; items: { x: number; str: string }[] }[] = []

    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const y = item.transform[5]
      const x = item.transform[4]
      let row = rows.find((r) => Math.abs(r.y - y) <= Y_TOLERANCE)
      if (!row) {
        row = { y, items: [] }
        rows.push(row)
      }
      row.items.push({ x, str: item.str })
    }

    // Sort rows top-to-bottom (descending y in PDF coords)
    rows.sort((a, b) => b.y - a.y)

    const lines = rows.map((row) => {
      // Sort items left-to-right within each row
      row.items.sort((a, b) => a.x - b.x)
      return row.items.map((i) => i.str).join(' ')
    })

    pageTexts.push(lines.join('\n'))
  }

  return pageTexts.join('\n\n--- PAGE BREAK ---\n\n')
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip data URL prefix: "data:image/jpeg;base64,..."
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
