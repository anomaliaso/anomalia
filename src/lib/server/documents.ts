// Text extraction for user-uploaded brand documents. MVP: plain text, markdown, PDF.
// .docx is intentionally out of scope (phase 2). Used by the Studio upload action.

const TEXT_EXTS = ['txt', 'md', 'markdown'];

function ext(fileName: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(fileName);
  return m ? m[1].toLowerCase() : '';
}

export function isSupportedDoc(mimeType: string, fileName: string): boolean {
  const e = ext(fileName);
  if (TEXT_EXTS.includes(e) || e === 'pdf') return true;
  return mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'application/pdf';
}

export async function extractText(buffer: ArrayBuffer, mimeType: string, fileName: string): Promise<string> {
  const e = ext(fileName);
  if (TEXT_EXTS.includes(e) || mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return new TextDecoder().decode(buffer).trim();
  }
  if (e === 'pdf' || mimeType === 'application/pdf') {
    const { extractText: pdfExtract, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await pdfExtract(doc, { mergePages: true });
    return String(text).trim();
  }
  throw new Error(`Unsupported document type: ${mimeType || fileName}`);
}
