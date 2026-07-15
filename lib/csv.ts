/**
 * CSV/TSV/pasted-block parsing for contact import. Handles quoted commas,
 * escaped quotes, CRLF, and header synonyms. Junk rows come back as row
 * errors — the review step shows them before anything is committed.
 */
export type RawRow = Record<string, string>;

export type ParsedImport = {
  rows: Array<{ line: number; values: RawRow }>;
  errors: Array<{ line: number; message: string }>;
  duplicates: number;
};

export function detectDelimiter(firstLine: string): ',' | '\t' | ';' {
  const counts: Array<[',' | '\t' | ';', number]> = [
    [',', (firstLine.match(/,/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]?.[1] ? counts[0][0] : ',';
}

/** RFC-4180-ish state machine. Returns rows of cells. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const delim = delimiter ?? detectDelimiter(text.split(/\r?\n/, 1)[0] ?? '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === delim) {
      pushCell();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') continue;
      pushRow();
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) pushRow();
  return rows;
}

const HEADER_SYNONYMS: Record<string, string[]> = {
  email: ['email', 'e-mail', 'mail', 'email address'],
  firstName: ['first name', 'firstname', 'first', 'given name'],
  lastName: ['last name', 'lastname', 'last', 'surname', 'family name'],
  company: ['company', 'org', 'organization', 'organisation', 'employer'],
  contactRole: ['role', 'title', 'their role', 'position', 'job title'],
  targetRole: ['target role', 'target', 'applying for', 'role applying for', 'my role'],
  jobUrl: ['job url', 'job link', 'posting', 'posting url', 'url', 'link'],
  hook: ['hook', 'note', 'notes', 'context'],
  linkedinUrl: ['linkedin', 'linkedin url', 'li'],
  tags: ['tags', 'labels'],
};

function mapHeader(cells: string[]): Map<number, string> | null {
  const map = new Map<number, string>();
  cells.forEach((raw, i) => {
    const key = raw.trim().toLowerCase();
    for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (synonyms.includes(key)) {
        map.set(i, field);
        break;
      }
    }
  });
  return [...map.values()].includes('email') ? map : null;
}

const EMAIL_ISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseContactsImport(text: string): ParsedImport {
  const table = parseDelimited(text);
  if (table.length === 0) {
    return { rows: [], errors: [{ line: 1, message: 'Nothing to parse.' }], duplicates: 0 };
  }

  const header = mapHeader(table[0] ?? []);
  if (!header) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message: 'The first row must be a header that includes an "email" column.',
        },
      ],
      duplicates: 0,
    };
  }

  const rows: ParsedImport['rows'] = [];
  const errors: ParsedImport['errors'] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  table.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    const values: RawRow = {};
    header.forEach((field, col) => {
      const cell = (cells[col] ?? '').trim();
      if (cell !== '') values[field] = cell;
    });

    const email = (values.email ?? '').toLowerCase();
    if (!email || !EMAIL_ISH.test(email)) {
      errors.push({ line, message: `No valid email on line ${line}.` });
      return;
    }
    if (seen.has(email)) {
      duplicates += 1;
      errors.push({ line, message: `Duplicate email ${email} on line ${line} — skipped.` });
      return;
    }
    seen.add(email);
    values.email = email;

    if (!values.firstName) {
      // Recoverable: derive a first name from the mailbox so the row can be fixed in review.
      const mailbox = email.split('@')[0] ?? '';
      const guess = mailbox.split(/[._-]/)[0] ?? '';
      values.firstName = guess ? guess[0]?.toUpperCase() + guess.slice(1) : '';
    }
    rows.push({ line, values });
  });

  return { rows, errors, duplicates };
}
