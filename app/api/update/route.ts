import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { CSV_TO_DB } from '@/lib/csv'

// PATCH /api/update  → update fields for an existing domain
export async function PATCH(req: NextRequest) {
  const { domain, fields } = await req.json() as { domain: string; fields: Record<string, string> }
  if (!domain) return NextResponse.json({ error: 'Missing domain' }, { status: 400 })

  const dbRow: Record<string, string | null> = {}
  Object.entries(fields).forEach(([csvField, value]) => {
    const dbCol = CSV_TO_DB[csvField]
    if (dbCol) dbRow[dbCol] = value || null
  })

  if (Object.keys(dbRow).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('enriched_domains')
    .update(dbRow)
    .eq('email_domain', domain.toLowerCase().trim())

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
