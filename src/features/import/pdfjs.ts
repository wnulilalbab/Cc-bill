// Loads pdf.js on first use (keeps it out of the main bundle). The worker is bundled with the app (works offline),
// not fetched from a CDN.
import type { PdfJsLike } from '../../import/pdf'

export async function loadPdfjs(): Promise<PdfJsLike> {
  const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  lib.GlobalWorkerOptions.workerSrc = worker.default
  return lib as unknown as PdfJsLike
}
