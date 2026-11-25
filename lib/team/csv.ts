/**
 * Hand-written RFC 4180 CSV reader and writer. Text in, text out: nothing in a file is ever fetched, evaluated or executed.
 * Handles quoted fields, doubled quotes, commas / newlines inside quotes, a byte-order mark, CRLF / LF / CR, and
 * comma / semicolon / tab delimiters (detected from the first lines).
 */

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 5000;
export const MAX_CSV_COLUMNS = 60;

export type Delimiter = "," | ";" | "\t";

export type ParsedCsv = {
  delimiter: Delimiter;
  /** Every record, header included; fully blank lines are dropped. */
  records: string[][];
  /** Set when the file ends inside an open quote. The partial last record is still returned. */
  unterminatedQuote: boolean;
};

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Count candidate delimiters outside quotes on the first few non-empty lines; the most consistent one wins (ties favour comma). */
export function detectDelimiter(text: string): Delimiter {
  const candidates: Delimiter[] = [",", ";", "\t"];
  const counts: Record<string, number[]> = { ",": [], ";": [], "\t": [] };
  let inQuotes = false;
  let line: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let seen = 0;
  let hasContent = false;
  for (let i = 0; i < text.length && seen < 5; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (hasContent) {
        for (const d of candidates) counts[d].push(line[d]);
        seen++;
      }
      line = { ",": 0, ";": 0, "\t": 0 };
      hasContent = false;
    } else if (!inQuotes && c in line) {
      line[c]++;
      hasContent = true;
    } else hasContent = true;
  }
  if (hasContent && seen < 5) for (const d of candidates) counts[d].push(line[d]);
  let best: Delimiter = ",";
  let bestScore = 0;
  for (const d of candidates) {
    const c = counts[d];
    if (!c.length || c[0] === 0) continue;
    const consistent = c.every((n) => n === c[0]);
    const score = c[0] * (consistent ? 1000 : 1);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export function parseCsv(input: string, delimiter?: Delimiter): ParsedCsv {
  const text = stripBom(input);
  const delim = delimiter ?? detectDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false; // the current field started with a quote (so an empty "" is still a field)
  let lineHasContent = false;

  const endField = () => {
    record.push(field);
    field = "";
    quotedField = false;
  };
  const endRecord = () => {
    endField();
    if (lineHasContent || record.length > 1 || record[0] !== "") records.push(record);
    record = [];
    lineHasContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "" && !quotedField) {
      inQuotes = true;
      quotedField = true;
      lineHasContent = true;
    } else if (c === delim) {
      endField();
      lineHasContent = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
    } else {
      field += c;
      lineHasContent = true;
    }
  }
  const unterminatedQuote = inQuotes;
  if (field !== "" || record.length > 0 || lineHasContent) endRecord();
  return { delimiter: delim, records, unterminatedQuote };
}

/* ----------------------------------------------------------------- writing */

/**
 * Spreadsheet programs run cells that start with = + - @ (or a tab / carriage return) as formulas. Prefix such a cell with
 * an apostrophe so it is shown as text. The importer strips that apostrophe again (`unguardCell`).
 */
export function guardCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Undo `guardCell` when a file produced by our own export is imported again. */
export function unguardCell(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

export function csvCell(value: unknown): string {
  const s = guardCell(value == null ? "" : String(value));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
