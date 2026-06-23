export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { searchDomains, upsertDomain, upsertGoodFit, getGoodFitForDomains } from '@/lib/db'
import { enrichDomain } from '@/lib/claude'
import { CSV_TO_DB, DB_TO_CSV } from '@/lib/csv'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase()
  if (!q) return NextResponse.json({ results: [] })

  const domains = await searchDomains(q)
  const domainKeys = domains.map((d) => d.email_domain)
  const fitRows = await getGoodFitForDomains(domainKeys)

  const fitMap: Record<string, { good_fit: string; good_fit_notes: string; rejection_reason: string }> = {}
  fitRows.forEach((f) => {
    fitMap[f.email_domain] = {
      good_fit: f.good_fit || '',
      good_fit_notes: f.good_fit_notes || '',
      rejection_reason: f.rejection_reason || '',
    }
  })

  const results = domains.map((row) => {
    const out: Record<string, string> = { 'email domain': row.email_domain, enriched_at: row.enriched_at }
    Object.entries(DB_TO_CSV).forEach(([dbCol, csvField]) => {
      out[csvField] = (row[dbCol as keyof typeof row] as string) || ''
    })
    const fit = fitMap[row.email_domain]
    if (fit) {
      out['good fit'] = fit.good_fit
      out['good fit notes'] = fit.good_fit_notes
      out['rejection reason'] = fit.rejection_reason
    }
    return out
  })

  return NextResponse.json({ results })
}

export async function POST(req: NextRequest) {
  const { domain, country } = await req.json()
  if (!domain) return NextResponse.json({ error: 'Missing domain' }, { status: 400 })

  const normalizedDomain = domain.toLowerCase().trim()
  const normalizedCountry = (country || '').toUpperCase()

  const enriched = await enrichDomain(normalizedDomain, { country: normalizedCountry })

  const dbRow: Record<string, string | null> = { email_domain: normalizedDomain }
  Object.entries(CSV_TO_DB).forEach(([csvField, dbCol]) => {
    dbRow[dbCol] = enriched[csvField] || null
  })
  await upsertDomain(dbRow)

  if (enriched['good fit']) {
    await upsertGoodFit(normalizedDomain, normalizedCountry, enriched['good fit'], enriched['good fit notes'] || '', enriched['rejection reason'] || '')
  }

  const result: Record<string, string> = { 'email domain': normalizedDomain }
  Object.entries(DB_TO_CSV).forEach(([dbCol, csvField]) => { result[csvField] = dbRow[dbCol] || '' })
  Object.entries(enriched).forEach(([k, v]) => { if (v) result[k] = v })

  return NextResponse.json({ result })
}
