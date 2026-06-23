export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getDomain, upsertDomain, getGoodFit, upsertGoodFit } from '@/lib/db'
import { enrichDomain, evaluateGoodFit } from '@/lib/claude'
import { CSV_TO_DB, DB_TO_CSV, LeadRow } from '@/lib/csv'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { domain, existingData }: { domain: string; existingData: LeadRow } = await req.json()
    if (!domain) return NextResponse.json({ error: 'Missing email domain' }, { status: 400 })

    const normalizedDomain = domain.toLowerCase().trim()
    const country = (existingData['country'] || '').toUpperCase()

    const cached = await getDomain(normalizedDomain)

    if (cached) {
      const result: LeadRow = { ...existingData }
      Object.entries(DB_TO_CSV).forEach(([dbCol, csvField]) => {
        const val = cached[dbCol as keyof typeof cached]
        if (val && !result[csvField]) result[csvField] = String(val)
      })

      const cachedFit = await getGoodFit(normalizedDomain, country)
      if (cachedFit) {
        result['good fit'] = cachedFit.good_fit || ''
        result['good fit notes'] = cachedFit.good_fit_notes || ''
        result['rejection reason'] = cachedFit.rejection_reason || ''
      } else {
        const fit = await evaluateGoodFit(result, country)
        Object.entries(fit).forEach(([k, v]) => { if (v !== undefined) result[k] = v })
        await upsertGoodFit(normalizedDomain, country, fit['good fit'] || '', fit['good fit notes'] || '', fit['rejection reason'] || '')
      }

      return NextResponse.json({ result, source: 'cache', cachedAt: cached.enriched_at })
    }

    const enriched = await enrichDomain(normalizedDomain, existingData)

    const dbRow: Record<string, string | null> = { email_domain: normalizedDomain }
    Object.entries(CSV_TO_DB).forEach(([csvField, dbCol]) => {
      dbRow[dbCol] = enriched[csvField] || existingData[csvField] || null
    })
    await upsertDomain(dbRow)

    if (enriched['good fit']) {
      await upsertGoodFit(normalizedDomain, country, enriched['good fit'], enriched['good fit notes'] || '', enriched['rejection reason'] || '')
    }

    const result: LeadRow = { ...existingData }
    Object.entries(enriched).forEach(([k, v]) => { if (v !== undefined) result[k] = v })

    return NextResponse.json({ result, source: 'ai' })
  } catch (err) {
    console.error('Enrichment error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
