export const MAX_DOC_MB = 20;
export const MAX_DOC_BYTES = MAX_DOC_MB * 1024 * 1024;
export const DOC_EXTENSIONS = ["pdf", "docx", "txt", "md"] as const;
export const DOC_ACCEPT = ".pdf,.docx,.txt,.md";
export const MAX_DOCUMENTS_PER_WORKSPACE = 100; // until plan limits (Phase 9)

export function checkDocument(file: { name: string; size: number }): string | null {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  if (ext === "doc") return "Older .doc files aren't supported. Open the file in Word and save it as .docx.";
  if (!(DOC_EXTENSIONS as readonly string[]).includes(ext)) return "Upload a PDF, Word (.docx) or text (.txt, .md) file.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_DOC_BYTES) return `The file is larger than ${MAX_DOC_MB} MB.`;
  if (file.name.length > 255) return "The file name is too long.";
  return null;
}
