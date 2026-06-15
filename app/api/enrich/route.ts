import { NextRequest, NextResponse } from 'next/server'
import { supabase, EnrichedDomain } from '@/lib/supabase'
import { enrichDomain } from '@/lib/claude'
import { CSV_TO_DB, DB_TO_CSV, LeadRow } from '@/lib/csv'

export const maxDuration = 60 // Vercel max for hobby plan

export async function POST(req: NextRequest) {
  try {
    const { domain, existingData }: { domain: string; existingData: LeadRow } = await req.json()

    if (!domain) {
      return NextResponse.json({ error: 'Missing email domain' }, { status: 400 })
    }

    const normalizedDomain = domain.toLowerCase().trim()

    // 1. Check Supabase cache first
    const { data: cached, error: dbError } = await supabase
      .from('enriched_domains')
      .select('*')
      .eq('email_domain', normalizedDomain)
      .single()

    if (cached && !dbError) {
      // Convert DB column names back to CSV field names
      const result: LeadRow = { ...existingData }
      Object.entries(DB_TO_CSV).forEach(([dbCol, csvField]) => {
        const val = (cached as EnrichedDomain)[dbCol as keyof EnrichedDomain]
        if (val && !result[csvField]) {
          result[csvField] = String(val)
        }
      })
      return NextResponse.json({ result, source: 'cache', cachedAt: cached.enriched_at })
    }

    // 2. Not cached — call Claude
    const enriched = await enrichDomain(normalizedDomain, existingData)

    // 3. Save to Supabase
    const dbRow: Record<string, string | null> = { email_domain: normalizedDomain }
    Object.entries(CSV_TO_DB).forEach(([csvField, dbCol]) => {
      dbRow[dbCol] = enriched[csvField] || existingData[csvField] || null
    })

    await supabase.from('enriched_domains').upsert(dbRow, { onConflict: 'email_domain' })

    // 4. Merge with existing row data
    const result: LeadRow = { ...existingData }
    Object.entries(enriched).forEach(([csvField, val]) => {
      if (val && !result[csvField]) result[csvField] = val
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
