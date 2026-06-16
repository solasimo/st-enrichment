import { NextRequest, NextResponse } from 'next/server'
import { CSV_TO_DB } from '@/lib/csv'
import { neon } from '@neondatabase/serverless'

export async function PATCH(req: NextRequest) {
  const { domain, fields } = await req.json() as { domain: string; fields: Record<string, string> }
  if (!domain) return NextResponse.json({ error: 'Missing domain' }, { status: 400 })

  const dbFields: Record<string, string | null> = {}
  Object.entries(fields).forEach(([csvField, value]) => {
    const dbCol = CSV_TO_DB[csvField]
    if (dbCol) dbFields[dbCol] = value || null
  })

  if (!Object.keys(dbFields).length) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const sql = neon(process.env.DATABASE_URL!)
  const entries = Object.entries(dbFields)
  const setClause = entries.map((_, i) => `${entries[i][0]} = $${i + 2}`).join(', ')
  const values = [domain.toLowerCase().trim(), ...entries.map(([, v]) => v)]

  await sql(`UPDATE enriched_domains SET ${setClause} WHERE email_domain = $1`, values)

  return NextResponse.json({ ok: true })
}
