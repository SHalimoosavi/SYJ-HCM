export type ScanStatus = 'pending_scan' | 'clean' | 'infected' | 'scan_failed' | 'scanner_unavailable' | 'rejected';
export type ScanResult = { status: ScanStatus; detail?: string };
export interface MalwareScanner { scan(data: Buffer, detectedMime: string): Promise<ScanResult>; }

/** No AV engine is bundled. This adapter is deliberately honest about that fact. */
export class UnavailableScanner implements MalwareScanner {
  async scan(): Promise<ScanResult> { return { status: 'scanner_unavailable', detail: 'No malware scanner is configured.' }; }
}

export function getMalwareScanner(): MalwareScanner {
  const mode = process.env.DOCUMENT_SCANNER_MODE || 'unavailable';
  if (mode !== 'unavailable') throw new Error(`Unsupported DOCUMENT_SCANNER_MODE: ${mode}. No scanner adapter is bundled in Phase 2.3.`);
  return new UnavailableScanner();
}
