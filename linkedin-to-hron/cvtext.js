// Reads the text of a CV (PDF or DOCX) and finds a phone number in it.
// cv = { name, type, data: base64 }

function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function pdfText(bytes) {
  const pdfjs = await import(chrome.runtime.getURL("lib/pdfjs/pdf.min.mjs"));
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdfjs/pdf.worker.min.mjs");
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join(""));
  }
  return pages.join("\n");
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Minimal ZIP reader: returns word/document.xml from a .docx as text.
async function docxText(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid .docx file");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (name === "word/document.xml") {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = bytes.subarray(start, start + size);
      const xml = dec.decode(method === 8 ? await inflateRaw(raw) : raw);
      return xml
        .replace(/<\/w:p>|<w:br\/>|<w:tab\/>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("No document text in .docx file");
}

async function cvText(cv) {
  const bytes = base64ToBytes(cv.data);
  const head = String.fromCharCode(...bytes.subarray(0, 4));
  if (head === "%PDF") return pdfText(bytes);
  if (head.startsWith("PK")) return docxText(bytes);
  if (/^text\//.test(cv.type)) return new TextDecoder().decode(bytes);
  return "";
}

// Picks the most likely mobile/phone number: one labelled as such first,
// then one with a country code, then a Danish-style 8-digit number.
function findPhone(text) {
  const PHONE = /(?:\+|00)\d{1,3}[\s.\-]?(?:\(0\)[\s.\-]?)?(?:\d[\s.\-]?){6,12}\d|\b\d{2}[\s.\-]?\d{2}[\s.\-]?\d{2}[\s.\-]?\d{2}\b/g;
  const clean = (s) => s.replace(/[^\d+]/g, "").replace(/^00/, "+");
  const valid = (s) => {
    if (/^\d{1,2}[./-]\d{1,2}[./-](19|20)\d{2}$/.test(s.trim())) return false; // a date
    const d = s.replace(/\D/g, "");
    return d.length >= 8 && d.length <= 15 && !/^(19|20)\d{2}(19|20)\d{2}$/.test(d);
  };
  const lines = text.split(/\n/);
  for (const line of lines) {
    if (/mobil|mobile|cell|tlf|telefon|phone|tel\b|☎|📞/i.test(line)) {
      const m = (line.match(PHONE) || []).find(valid);
      if (m) return clean(m);
    }
  }
  const all = (text.match(PHONE) || []).filter(valid);
  return clean(all.find((m) => /^(\+|00)/.test(m)) || all[0] || "");
}
