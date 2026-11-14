// pdf.js caricato solo quando serve: anteprima degli allegati e testo per «Chiedi all'AI».

export async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/** Testo di un PDF, pagina per pagina, fermandosi dopo `limit` caratteri. */
export async function pdfText(bytes: ArrayBuffer, limit: number): Promise<string> {
  const pdfjs = await loadPdfjs();
  // pdf.js trasferisce il buffer al worker: gli si passa una copia.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  try {
    const doc = await task.promise;
    let text = "";
    for (let n = 1; n <= doc.numPages && text.length < limit; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const line = content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("");
      text += `${line.trim()}\n\n`;
    }
    return text;
  } finally {
    void task.destroy();
  }
}
