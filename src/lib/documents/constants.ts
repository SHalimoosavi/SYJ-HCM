export const DOCUMENT_TYPES = ['resume', 'cover_letter', 'certificate', 'portfolio', 'other'] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];

export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
export const MAX_FILENAME_LENGTH = 180;

export const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.webp', '.gif'] as const;
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
] as const;

export type DetectedFileType = {
  mime: typeof ALLOWED_MIME_TYPES[number];
  extension: string;
};

export function normalizeDocumentType(value: FormDataEntryValue | null): DocumentType | null {
  if (typeof value !== 'string') return null;
  return (DOCUMENT_TYPES as readonly string[]).includes(value) ? value as DocumentType : null;
}

export function sanitizeFilename(input: string): string {
  const normalized = input
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]+/g, '_')
    .trim();

  const basename = normalized
    .replace(/^\.+/, '_')
    .replace(/[.]{2,}/g, '_');

  const safe = basename
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  const fallback = safe || 'document';
  return Array.from(fallback).slice(0, MAX_FILENAME_LENGTH).join('');
}

export function extensionOf(filename: string): string {
  const lower = filename.toLowerCase();
  const idx = lower.lastIndexOf('.');
  return idx >= 0 ? lower.slice(idx) : '';
}

function ascii(buffer: Buffer, start: number, length: number): string {
  return buffer.subarray(start, start + length).toString('ascii');
}

export function detectFileType(buffer: Buffer, filename = ''): DetectedFileType | null {
  const ext = extensionOf(filename);
  if (buffer.length >= 5 && ascii(buffer, 0, 5) === '%PDF-') return { mime: 'application/pdf', extension: '.pdf' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return { mime: 'image/png', extension: '.png' };
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff,0xd8,0xff]))) return { mime: 'image/jpeg', extension: ext === '.jpg' ? '.jpg' : '.jpeg' };
  if (buffer.length >= 12 && ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WEBP') return { mime: 'image/webp', extension: '.webp' };
  if (buffer.length >= 6 && (ascii(buffer,0,6) === 'GIF87a' || ascii(buffer,0,6) === 'GIF89a')) return { mime: 'image/gif', extension: '.gif' };
  if (buffer.length >= 8 && buffer.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))) return { mime: 'application/msword', extension: '.doc' };
  if (buffer.length >= 4 && buffer.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))) {
    const content = buffer.subarray(0, Math.min(buffer.length, 256 * 1024)).toString('latin1');
    if (content.includes('[Content_Types].xml') && content.includes('word/')) {
      return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx' };
    }
    return null;
  }
  if (ext === '.txt' && isSafeText(buffer)) return { mime: 'text/plain', extension: '.txt' };
  return null;
}

function isSafeText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 64 * 1024)).toString('utf8');
  if (sample.includes('\uFFFD')) return false;
  if (/<\s*(?:script|html|svg|iframe|object|embed|meta)\b/i.test(sample)) return false;
  return true;
}

export function validateDocumentInput(file: File, documentType: DocumentType): { error?: string; filename: string } {
  if (!file || typeof file.name !== 'string') return { error: 'A document file is required.', filename: 'document' };
  if (!documentType) return { error: 'Select a valid document type.', filename: sanitizeFilename(file.name) };
  if (file.size <= 0) return { error: 'The uploaded document is empty.', filename: sanitizeFilename(file.name) };
  if (file.size > MAX_DOCUMENT_BYTES) return { error: 'Document exceeds the 12 MB server-side limit.', filename: sanitizeFilename(file.name) };
  const filename = sanitizeFilename(file.name);
  const ext = extensionOf(filename);
  if (!ALLOWED_EXTENSIONS.includes(ext as typeof ALLOWED_EXTENSIONS[number])) return { error: 'Unsupported document extension.', filename };
  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type as typeof ALLOWED_MIME_TYPES[number])) return { error: 'Unsupported declared MIME type.', filename };
  return { filename };
}

export function safeContentDisposition(filename: string): string {
  const clean = sanitizeFilename(filename)
    .replace(/[\r\n]/g, '_')
    .replace(/set-cookie\s*:/gi, '_');

  const asciiName = clean
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/"/g, '_') || 'document';

  const encoded = encodeURIComponent(clean).replace(/['()]/g, escape);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}
