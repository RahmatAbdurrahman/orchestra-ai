import { extensionMatches, sanitizeFileName, sniffMimeType } from './file-validation';

describe('file validation', () => {
  it('detects PDF, PNG and JPEG by magic bytes', () => {
    expect(sniffMimeType(Buffer.from('%PDF-1.7\n...'))).toBe('application/pdf');
    expect(sniffMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe('image/png');
    expect(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg');
  });

  it('rejects other content regardless of the claimed type', () => {
    expect(sniffMimeType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffMimeType(Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(sniffMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('checks that the extension matches the detected type', () => {
    expect(extensionMatches('invoice.PDF', 'application/pdf')).toBe(true);
    expect(extensionMatches('invoice.pdf.exe', 'application/pdf')).toBe(false);
    expect(extensionMatches('scan.jpeg', 'image/jpeg')).toBe(true);
  });

  it('sanitizes file names', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\x\\invoice "final".pdf')).toBe('invoice _final_.pdf');
    expect(sanitizeFileName('')).toBe('document');
  });
});
