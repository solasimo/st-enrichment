import { NextRequest, NextResponse } from 'next/server'
import { supabase, EnrichedDomain } from '@/lib/supabase'
import { enrichDomain, evaluateGoodFit } from '@/lib/claude'
import { CSV_TO_DB, DB_TO_CSV, LeadRow } from '@/lib/csv'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { domain, existingData }: { domain: string; existingData: LeadRow } = await req.json()

    if (!domain) {
      return NextResponse.json({ error: 'Missing email domain' }, { status: 400 })
    }

    const normalizedDomain = domain.toLowerCase().trim()
    const country = (existingData['country'] || '').toUpperCase()

    // 1. Check Supabase cache
    const { data: cached, error: dbError } = await supabase
      .from('enriched_domains')
      .select('*')
      .eq('email_domain', normalizedDomain)
      .single()

    if (cached && !dbError) {
      // Build result from cached domain fields
      const result: LeadRow = { ...existingData }
      Object.entries(DB_TO_CSV).forEach(([dbCol, csvField]) => {
        const val = (cached as EnrichedDomain)[dbCol as keyof EnrichedDomain]
        if (val && !result[csvField]) {
          result[csvField] = String(val)
        }
      })

      // Evaluate good fit using cached data only — no web search
      const fit = await evaluateGoodFit(result, country)
      Object.entries(fit).forEach(([k, v]) => { if (v) result[k] = v })

      return NextResponse.json({ result, source: 'cache', cachedAt: cached.enriched_at })
    }

    // 2. Not in cache — full enrichment with web search
    const enriched = await enrichDomain(normalizedDomain, existingData)

    // 3. Save domain-level fields to Supabase (not good fit — it's per-lead)
    const dbRow: Record<string, string | null> = { email_domain: normalizedDomain }
    Object.entries(CSV_TO_DB).forEach(([csvField, dbCol]) => {
      dbRow[dbCol] = enriched[csvField] || existingData[csvField] || null
    })
    await supabase.from('enriched_domains').upsert(dbRow, { onConflict: 'email_domain' })

    // 4. Merge enriched fields into result
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
