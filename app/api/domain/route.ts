import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { enrichDomain } from '@/lib/claude'
import { CSV_TO_DB, DB_TO_CSV } from '@/lib/csv'

// GET /api/domain?q=hms.se  → search by domain or company name
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase()
  const country = (req.nextUrl.searchParams.get('country') || '').toUpperCase()
  if (!q) return NextResponse.json({ results: [] })

  const { data, error } = await supabase
    .from('enriched_domains')
    .select('*')
    .or(`email_domain.ilike.%${q}%,company.ilike.%${q}%`)
    .order('enriched_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // For each result, fetch good fit from good_fit_cache
  const domains = (data || []).map((r) => r.email_domain)
  const { data: fitData } = await supabase
    .from('good_fit_cache')
    .select('*')
    .in('email_domain', domains)

  // Index fit data by domain+country
  const fitMap: Record<string, { good_fit: string; good_fit_notes: string }> = {}
  ;(fitData || []).forEach((f) => {
    fitMap[f.email_domain] = { good_fit: f.good_fit || '', good_fit_notes: f.good_fit_notes || '' }
  })

  const results = (data || []).map((row) => {
    const out: Record<string, string> = { 'email domain': row.email_domain, enriched_at: row.enriched_at }
    Object.entries(DB_TO_CSV).forEach(([dbCol, csvField]) => {
      out[csvField] = row[dbCol] || ''
    })
    // Add good fit from cache
    const fit = fitMap[row.email_domain]
    if (fit) {
      out['good fit'] = fit.good_fit
      out['good fit notes'] = fit.good_fit_notes
    }
    return out
  })

  return NextResponse.json({ results })
}

// POST /api/domain  → enrich a new domain and save to DB
export async function POST(req: NextRequest) {
  const { domain, country } = await req.json()
  if (!domain) return NextResponse.json({ error: 'Missing domain' }, { status: 400 })

  const normalizedDomain = domain.toLowerCase().trim()
  const normalizedCountry = (country || '').toUpperCase()

  const enriched = await enrichDomain(normalizedDomain, { country: normalizedCountry })

  // Save domain fields to enriched_domains
  const dbRow: Record<string, string | null> = { email_domain: normalizedDomain }
  Object.entries(CSV_TO_DB).forEach(([csvField, dbCol]) => {
    dbRow[dbCol] = enriched[csvField] || null
  })
  const { error } = await supabase
    .from('enriched_domains')
    .upsert(dbRow, { onConflict: 'email_domain' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Save good fit to good_fit_cache
  if (enriched['good fit']) {
    await supabase.from('good_fit_cache').upsert({
      email_domain: normalizedDomain,
      country: normalizedCountry,
      good_fit: enriched['good fit'] || null,
      good_fit_notes: enriched['good fit notes'] || null,
    }, { onConflict: 'email_domain,country' })
  }

  // Build result with all fields including good fit
  const result: Record<string, string> = { 'email domain': normalizedDomain }
  Object.entries(DB_TO_CSV).forEach(([dbCol, csvField]) => {
    result[csvField] = dbRow[dbCol] || ''
  })
  Object.entries(enriched).forEach(([k, v]) => { if (v) result[k] = v })

  return NextResponse.json({ result })
}
