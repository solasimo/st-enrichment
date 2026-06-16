import { NextRequest, NextResponse } from 'next/server'
import { supabase, EnrichedDomain, GoodFitCache } from '@/lib/supabase'
import { enrichDomain, evaluateGoodFit } from '@/lib/claude'
import { CSV_TO_DB, DB_TO_CSV, LeadRow } from '@/lib/csv'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { domain, existingData }: { domain: string; existingData: LeadRow } = await req.json()
    if (!domain) return NextResponse.json({ error: 'Missing email domain' }, { status: 400 })

    const normalizedDomain = domain.toLowerCase().trim()
    const country = (existingData['country'] || '').toUpperCase()

    // ── 1. Check domain cache ─────────────────────────────────────────────────
    const { data: cached, error: cacheError } = await supabase
      .from('enriched_domains')
      .select('*')
      .eq('email_domain', normalizedDomain)
      .single()

    if (cached && !cacheError) {
      // Build result from cached domain fields
      const result: LeadRow = { ...existingData }
      Object.entries(DB_TO_CSV).forEach(([dbCol, csvField]) => {
        const val = (cached as EnrichedDomain)[dbCol as keyof EnrichedDomain]
        if (val && !result[csvField]) result[csvField] = String(val)
      })

      // ── 2. Check good fit cache (domain + country) ────────────────────────
      const fitCacheKey = `${normalizedDomain}::${country}`
      const { data: cachedFit } = await supabase
        .from('good_fit_cache')
        .select('*')
        .eq('email_domain', normalizedDomain)
        .eq('country', country)
        .single()

      if (cachedFit) {
        result['good fit'] = (cachedFit as GoodFitCache).good_fit || ''
        result['good fit notes'] = (cachedFit as GoodFitCache).good_fit_notes || ''
      } else {
        // Evaluate and cache good fit
        const fit = await evaluateGoodFit(result, country)
        Object.entries(fit).forEach(([k, v]) => { if (v) result[k] = v })

        await supabase.from('good_fit_cache').upsert({
          email_domain: normalizedDomain,
          country,
          good_fit: fit['good fit'] || null,
          good_fit_notes: fit['good fit notes'] || null,
        }, { onConflict: 'email_domain,country' })
      }

      return NextResponse.json({ result, source: 'cache', cachedAt: cached.enriched_at })
    }

    // ── 3. Not cached — full enrichment ───────────────────────────────────────
    const enriched = await enrichDomain(normalizedDomain, existingData)

    // Save domain fields to enriched_domains
    const dbRow: Record<string, string | null> = { email_domain: normalizedDomain }
    Object.entries(CSV_TO_DB).forEach(([csvField, dbCol]) => {
      dbRow[dbCol] = enriched[csvField] || existingData[csvField] || null
    })
    await supabase.from('enriched_domains').upsert(dbRow, { onConflict: 'email_domain' })

    // Save good fit to good_fit_cache
    if (enriched['good fit']) {
      await supabase.from('good_fit_cache').upsert({
        email_domain: normalizedDomain,
        country,
        good_fit: enriched['good fit'] || null,
        good_fit_notes: enriched['good fit notes'] || null,
      }, { onConflict: 'email_domain,country' })
    }

    // Merge into result
    const result: LeadRow = { ...existingData }
    Object.entries(enriched).forEach(([csvField, val]) => { if (val) result[csvField] = val })

    return NextResponse.json({ result, source: 'ai' })
  } catch (err) {
    console.error('Enrichment error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
