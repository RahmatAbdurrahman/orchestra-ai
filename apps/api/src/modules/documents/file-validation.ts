import path from 'node:path';
import type { SupportedDocumentMimeType } from '@orchestra/domain';

const SIGNATURES: Array<{ mimeType: SupportedDocumentMimeType; bytes: number[]; extensions: string[] }> = [
  { mimeType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], extensions: ['.pdf'] },
  { mimeType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], extensions: ['.png'] },
  { mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff], extensions: ['.jpg', '.jpeg'] },
];

/**
 * Detects the real file type from its leading bytes. The client-supplied
 * Content-Type and file name are never trusted.
 */
export function sniffMimeType(content: Buffer): SupportedDocumentMimeType | null {
  for (const signature of SIGNATURES) {
    if (content.length >= signature.bytes.length && signature.bytes.every((byte, index) => content[index] === byte)) {
      return signature.mimeType;
    }
  }
  return null;
}

export function extensionFor(mimeType: SupportedDocumentMimeType): string {
  return SIGNATURES.find((signature) => signature.mimeType === mimeType)!.extensions[0]!;
}

export function extensionMatches(fileName: string, mimeType: SupportedDocumentMimeType): boolean {
  const extension = path.extname(fileName).toLowerCase();
  return SIGNATURES.find((signature) => signature.mimeType === mimeType)!.extensions.includes(extension);
}

/** Keeps a display-safe base name (no path, no control characters). */
export function sanitizeFileName(fileName: string): string {
  const base = path.basename(fileName.replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '_').trim();
  return (cleaned || 'document').slice(0, 200);
}
