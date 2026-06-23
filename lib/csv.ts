export const LEAD_FIELDS = [
  'Lead ID',
  'email domain',
  'country',
  'company',
  'company description',
  'product description',
  'website',
  'company linkedin URL',
  'company revenue',
  'company industries',
  'company founding date',
  'company employees',
  'company phone',
  'startup information',
  'good fit',
  'good fit notes',
] as const

export type LeadField = (typeof LEAD_FIELDS)[number]
export type LeadRow = Record<string, string>

export function parseCSV(text: string): { headers: string[]; rows: LeadRow[] } {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) throw new Error('CSV must have at least a header row and one data row.')

  const headers = parseCSVRow(lines[0])
  const rows = lines
    .slice(1)
    .map((line) => {
      const vals = parseCSVRow(line)
      const obj: LeadRow = {}
      headers.forEach((h, i) => {
        obj[h] = (vals[i] || '').trim()
      })
      return obj
    })
    .filter((r) => Object.values(r).some((v) => v !== ''))

  return { headers, rows }
}

function parseCSVRow(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQ = !inQ
      }
    } else if (c === ',' && !inQ) {
      result.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  result.push(cur)
  return result
}

function csvCell(val: string | null | undefined): string {
  if (val == null || val === '') return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export function toCSV(headers: string[], rows: LeadRow[]): string {
  const lines = [headers.map(csvCell).join(',')]
  rows.forEach((row) => {
    lines.push(headers.map((h) => csvCell(row[h] || '')).join(','))
  })
  return lines.join('\n')
}

// Fields cached in Supabase by domain (country-independent)
export const CSV_TO_DB: Record<string, string> = {
  company: 'company',
  'company description': 'company_description',
  'product description': 'product_description',
  website: 'website',
  'company linkedin URL': 'company_linkedin_url',
  'company revenue': 'company_revenue',
  'company industries': 'company_industries',
  'company founding date': 'company_founding_date',
  'company employees': 'company_employees',
  'company phone': 'company_phone',
  'startup information': 'startup_information',
}

// Fields NOT cached (country-dependent or per-lead)
export const UNCACHED_FIELDS = ['good fit', 'good fit notes', 'rejection reason']

export const DB_TO_CSV: Record<string, string> = Object.fromEntries(
  Object.entries(CSV_TO_DB).map(([k, v]) => [v, k])
)

export function countEmptyEnrichableFields(row: LeadRow): number {
  const cachedEmpty = Object.keys(CSV_TO_DB).filter((f) => !row[f]).length
  const uncachedEmpty = UNCACHED_FIELDS.filter((f) => !row[f]).length
  // company description is always re-evaluated if country is present
  return cachedEmpty + uncachedEmpty
}
