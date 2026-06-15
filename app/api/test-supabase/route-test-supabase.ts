import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const results: Record<string, unknown> = {}

  // Check env vars
  results.supabase_url = process.env.NEXT_PUBLIC_SUPABASE_URL ? 'SET' : 'MISSING'
  results.supabase_key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'SET' : 'MISSING'

  // Try a select
  const { data: selectData, error: selectError } = await supabase
    .from('enriched_domains')
    .select('*')
    .limit(1)

  results.select = selectError ? { error: selectError.message, code: selectError.code } : { ok: true, rows: selectData?.length }

  // Try an insert
  const { error: insertError } = await supabase
    .from('enriched_domains')
    .upsert({ email_domain: 'test-diagnostic.com', company: 'Test Co' }, { onConflict: 'email_domain' })

  results.upsert = insertError ? { error: insertError.message, code: insertError.code } : { ok: true }

  // Clean up
  await supabase.from('enriched_domains').delete().eq('email_domain', 'test-diagnostic.com')

  return NextResponse.json(results, { status: 200 })
}
