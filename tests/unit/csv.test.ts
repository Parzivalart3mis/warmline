import { describe, it, expect } from 'vitest';
import { parseContactsImport, parseDelimited, detectDelimiter } from '@/lib/csv';

describe('parseDelimited', () => {
  it('handles quoted commas', () => {
    const rows = parseDelimited('name,note\n"Doe, Jane","hi, there"');
    expect(rows[1]).toEqual(['Doe, Jane', 'hi, there']);
  });

  it('handles escaped quotes', () => {
    const rows = parseDelimited('q\n"She said ""hi"""');
    expect(rows[1]).toEqual(['She said "hi"']);
  });

  it('handles CRLF line endings', () => {
    const rows = parseDelimited('a,b\r\n1,2\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('skips blank lines', () => {
    const rows = parseDelimited('a\n\n1\n');
    expect(rows).toEqual([['a'], ['1']]);
  });
});

describe('detectDelimiter', () => {
  it('detects tabs and semicolons', () => {
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('a;b;c')).toBe(';');
    expect(detectDelimiter('a,b,c')).toBe(',');
  });
});

describe('parseContactsImport', () => {
  it('maps header synonyms and normalizes email', () => {
    const { rows, errors } = parseContactsImport(
      'E-Mail,First Name,Organization,Title\nADA@Acme.com,Ada,Acme,Backend Engineer',
    );
    expect(errors).toHaveLength(0);
    expect(rows[0]?.values).toMatchObject({
      email: 'ada@acme.com',
      firstName: 'Ada',
      company: 'Acme',
      contactRole: 'Backend Engineer',
    });
  });

  it('reports rows with missing or invalid emails', () => {
    const { rows, errors } = parseContactsImport('email,first\nnope,Ada\nbob@x.com,Bob');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.values.email).toBe('bob@x.com');
    expect(errors.some((e) => e.line === 2)).toBe(true);
  });

  it('flags duplicate emails and counts them', () => {
    const { rows, duplicates } = parseContactsImport(
      'email,first\na@x.com,A\nA@X.com,Dup\nb@x.com,B',
    );
    expect(rows).toHaveLength(2);
    expect(duplicates).toBe(1);
  });

  it('derives a first name from the mailbox when missing', () => {
    const { rows } = parseContactsImport('email\njane.doe@x.com');
    expect(rows[0]?.values.firstName).toBe('Jane');
  });

  it('errors when there is no email column', () => {
    const { rows, errors } = parseContactsImport('name,company\nAda,Acme');
    expect(rows).toHaveLength(0);
    expect(errors[0]?.message).toMatch(/email/i);
  });

  it('errors on empty input', () => {
    const { rows, errors } = parseContactsImport('   ');
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it('handles a realistic messy paste with junk rows', () => {
    const csv = [
      'email,first name,last name,company,role',
      'priya@stripe.com,Priya,Raman,Stripe,EM',
      ',No,Email,Nowhere,None', // junk: no email
      '"quote@x.com","Quo","Te","Ac, me","Staff, Eng"', // quoted commas
      'priya@stripe.com,Priya,Dup,Stripe,EM', // duplicate
    ].join('\n');
    const { rows, errors, duplicates } = parseContactsImport(csv);
    expect(rows.map((r) => r.values.email)).toEqual(['priya@stripe.com', 'quote@x.com']);
    expect(rows[1]?.values.company).toBe('Ac, me');
    expect(duplicates).toBe(1);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
