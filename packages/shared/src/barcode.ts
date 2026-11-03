/**
 * EAN-13 helpers.
 *
 * VYRA issues INTERNAL EAN-13 codes using the GS1 restricted-circulation prefix
 * "20" (valid only inside our own stores/warehouse). Publicly sellable GTINs
 * require GS1 India membership; when obtained, set BARCODE_EAN_PREFIX to the
 * licensed company prefix. Never fabricate a "890" (India) prefix.
 */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('EAN-13 body must be exactly 12 digits');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

export function buildEan13(prefix: string, sequence: number): string {
  if (!/^\d{2,9}$/.test(prefix)) throw new Error('EAN prefix must be 2-9 digits');
  const width = 12 - prefix.length;
  if (!Number.isInteger(sequence) || sequence < 0 || String(sequence).length > width) {
    throw new Error(`Sequence ${sequence} does not fit in ${width} digits`);
  }
  const body = prefix + String(sequence).padStart(width, '0');
  return body + ean13CheckDigit(body);
}

/** Code 128 (subset B) accepts printable ASCII 32-126. */
export function isValidCode128(value: string): boolean {
  return value.length > 0 && value.length <= 48 && /^[\x20-\x7E]+$/.test(value);
}

/**
 * Normalises raw scanner input. USB/Bluetooth HID scanners "type" the code and
 * usually send Enter; some prepend AIM symbology identifiers like "]E0".
 */
/** Extracts the SKU from a VYRA tag link (".../s/VY-TSH-00042-BLK-M") or legacy "VYRA:<sku>" QR text. */
export function skuFromTagPayload(code: string): string | null {
  const url = /\/s\/([A-Za-z0-9-]{3,64})\/?(?:[?#].*)?$/.exec(code.trim());
  if (url) return url[1]!.toUpperCase();
  if (/^VYRA:/i.test(code.trim())) return code.trim().slice(5).toUpperCase();
  return null;
}

export function normalizeScan(raw: string): string {
  return raw.trim().replace(/^\][A-Za-z]\d/, '').replace(/[\r\n\t]/g, '');
}
