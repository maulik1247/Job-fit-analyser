import path from "node:path";
import { createRequire } from "node:module";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);

function pdfjsDistRoot() {
  return path.dirname(require.resolve("pdfjs-dist/package.json"));
}

/** Trailing path.sep — pdf.js concatenates baseUrl + filename for fs reads in Node */
function pdfAssetBaseDirs() {
  const root = pdfjsDistRoot();
  return {
    cMapUrl: path.join(root, "cmaps") + path.sep,
    standardFontDataUrl: path.join(root, "standard_fonts") + path.sep,
  };
}

const EXT = /\.([^.]+)$/;

function extension(originalname) {
  const m = originalname.match(EXT);
  return m ? m[1].toLowerCase() : "";
}

function toUint8Array(buffer) {
  if (buffer instanceof Uint8Array && !(buffer instanceof Buffer)) {
    return buffer;
  }
  return new Uint8Array(buffer);
}

async function extractPdfText(buffer) {
  const data = toUint8Array(buffer);
  const { cMapUrl, standardFontDataUrl } = pdfAssetBaseDirs();

  const loadingTask = getDocument({
    data,
    cMapUrl,
    standardFontDataUrl,
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;
  try {
    let full = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      for (const item of textContent.items) {
        if (item && typeof item.str === "string") {
          full += item.str;
        }
        if (item?.hasEOL) {
          full += "\n";
        }
      }
      full += "\n\n";
    }
    const combined = full.trim();
    if (!combined && pdf.numPages > 0) {
      throw new Error(
        "No text layer in PDF (try DOCX/TXT or a text-based PDF)."
      );
    }
    return combined;
  } finally {
    await pdf.destroy();
  }
}

/**
 * @param {string} originalname
 * @param {string} mimetype
 * @param {Buffer} buffer
 */
export async function extractResumeText(originalname, mimetype, buffer) {
  const ext = extension(originalname);
  const mt = (mimetype || "").toLowerCase();

  if (ext === "txt" || mt === "text/plain") {
    return buffer.toString("utf8").replace(/\uFEFF/g, "");
  }

  if (ext === "pdf" || mt === "application/pdf") {
    try {
      return await extractPdfText(buffer);
    } catch (e) {
      console.error("pdfjs extract:", e);
      const hint = e?.message ? String(e.message) : String(e);
      throw new Error(
        hint.includes("No text")
          ? hint
          : `Could not read this PDF (${hint.slice(0, 120)}). Try DOCX or TXT, or re-export the PDF.`
      );
    }
  }

  if (
    ext === "docx" ||
    mt ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value ?? "";
  }

  throw new Error(
    "Unsupported format. Upload a PDF, DOCX, or TXT file."
  );
}
