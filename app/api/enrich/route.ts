import { NextRequest, NextResponse } from 'next/server'
import { supabase, EnrichedDomain } from '@/lib/supabase'
import { enrichDomain } from '@/lib/claude'
import { CSV_TO_DB, DB_TO_CSV, LeadRow } from '@/lib/csv'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { domain, existingData }: { domain: string; existingData: LeadRow } = await req.json()

    if (!domain) {
      return NextResponse.json({ error: 'Missing email domain' }, { status: 400 })
    }

    const normalizedDomain = domain.toLowerCase().trim()

    // 1. Check Supabase cache for domain-level fields
    const { data: cached, error: dbError } = await supabase
      .from('enriched_domains')
      .select('*')
      .eq('email_domain', normalizedDomain)
      .single()

    let baseData: LeadRow = { ...existingData }

    if (cached && !dbError) {
      // Merge cached domain fields into base data
      Object.entries(DB_TO_CSV).forEach(([dbCol, csvField]) => {
        const val = (cached as EnrichedDomain)[dbCol as keyof EnrichedDomain]
        if (val && !baseData[csvField]) {
          baseData[csvField] = String(val)
        }
      })

      // Still need to run AI for good fit + good fit notes (not cached) and country-aware description
      const enriched = await enrichDomain(normalizedDomain, baseData)
      Object.entries(enriched).forEach(([csvField, val]) => {
        if (val) baseData[csvField] = val
      })

      return NextResponse.json({ result: baseData, source: 'cache', cachedAt: cached.enriched_at })
    }

    // 2. Not cached — call Claude for everything
    const enriched = await enrichDomain(normalizedDomain, existingData)

    // 3. Save domain-level fields to Supabase
    const dbRow: Record<string, string | null> = { email_domain: normalizedDomain }
    Object.entries(CSV_TO_DB).forEach(([csvField, dbCol]) => {
      dbRow[dbCol] = enriched[csvField] || existingData[csvField] || null
    })
    await supabase.from('enriched_domains').upsert(dbRow, { onConflict: 'email_domain' })

    // 4. Merge all enriched fields into result
    const result: LeadRow = { ...existingData }
    Object.entries(enriched).forEach(([csvField, val]) => {
      if (val) result[csvField] = val
    })

    return NextResponse.json({ result, source: 'ai' })
  } catch (err) {
    console.error('Enrichment error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
