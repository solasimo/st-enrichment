import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { enrichDomain } from '@/lib/claude'
import { CSV_TO_DB, DB_TO_CSV } from '@/lib/csv'

// GET /api/domain?q=hms.se  → search by domain or company name
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase()
  if (!q) return NextResponse.json({ results: [] })

  const { data, error } = await supabase
    .from('enriched_domains')
    .select('*')
    .or(`email_domain.ilike.%${q}%,company.ilike.%${q}%`)
    .order('enriched_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = (data || []).map((row) => {
    const out: Record<string, string> = { 'email domain': row.email_domain, enriched_at: row.enriched_at }
    Object.entries(DB_TO_CSV).forEach(([dbCol, csvField]) => {
      out[csvField] = row[dbCol] || ''
    })
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

  // Full enrichment (includes good fit)
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
