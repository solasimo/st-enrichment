'use client'

import { useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { CSV_TO_DB } from '@/lib/csv'

const EDITABLE_FIELDS = Object.keys(CSV_TO_DB)

type CompanyRecord = Record<string, string>

type ViewState = 'search' | 'detail' | 'add'

export default function DatabasePage() {
  const [view, setView] = useState<ViewState>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CompanyRecord[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<CompanyRecord | null>(null)
  const [editFields, setEditFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Add new domain state
  const [newDomain, setNewDomain] = useState('')
  const [newCountry, setNewCountry] = useState('')
  const [enriching, setEnriching] = useState(false)
  const [enrichResult, setEnrichResult] = useState<CompanyRecord | null>(null)
  const [enrichError, setEnrichError] = useState('')

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/domain?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setResults(data.results || [])
    } catch { setResults([]) }
    setSearching(false)
  }, [])

  const handleQueryChange = (q: string) => {
    setQuery(q)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => search(q), 350)
  }

  const openDetail = (record: CompanyRecord) => {
    setSelected(record)
    const fields: Record<string, string> = {}
    EDITABLE_FIELDS.forEach((f) => { fields[f] = record[f] || '' })
    setEditFields(fields)
    setSaveMsg('')
    setView('detail')
  }

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    setSaveMsg('')
    try {
      const res = await fetch('/api/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: selected['email domain'], fields: editFields }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error) }
      setSaveMsg('Saved successfully')
      // Update local results
      setResults((prev) => prev.map((r) =>
        r['email domain'] === selected['email domain'] ? { ...r, ...editFields } : r
      ))
      setSelected((prev) => prev ? { ...prev, ...editFields } : prev)
    } catch (err) {
      setSaveMsg('Error: ' + (err instanceof Error ? err.message : String(err)))
    }
    setSaving(false)
  }

  const handleEnrich = async () => {
    if (!newDomain.trim()) return
    setEnriching(true)
    setEnrichError('')
    setEnrichResult(null)
    try {
      const res = await fetch('/api/domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: newDomain.trim(), country: newCountry.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setEnrichResult(data.result)
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : String(err))
    }
    setEnriching(false)
  }

  const enrichedDate = (iso: string) => {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  const card = { background: 'white', border: '1px solid #D8DAE0', borderRadius: 6, boxShadow: '0 1px 4px rgba(3,49,140,0.08)' }
  const inputStyle: React.CSSProperties = { width: '100%', border: '1.5px solid #D8DAE0', borderRadius: 6, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#5C6070', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block' }
  const btnPrimary: React.CSSProperties = { background: '#03318C', color: 'white', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }
  const btnSecondary: React.CSSProperties = { background: 'white', color: '#03318C', border: '1.5px solid #03318C', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }

  return (
    <div style={{ minHeight: '100vh', background: '#F7F8FA', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

      {/* Header */}
      <header style={{ background: '#03318C', color: 'white', height: 56, display: 'flex', alignItems: 'center', padding: '0 32px', gap: 16, boxShadow: '0 2px 8px rgba(3,49,140,0.3)' }}>
        <div style={{ width: 32, height: 32, background: '#E4002B', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>ST</div>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Lead Enrichment</span>
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.2)', margin: '0 4px' }} />
        {/* Nav */}
        <nav style={{ display: 'flex', gap: 4 }}>
          <Link href="/" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, padding: '4px 10px', borderRadius: 4 }}>CSV Upload</Link>
          <Link href="/database" style={{ color: 'white', textDecoration: 'none', fontSize: 13, padding: '4px 10px', borderRadius: 4, background: 'rgba(255,255,255,0.15)' }}>Database</Link>
        </nav>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 12, padding: '3px 10px', letterSpacing: '0.04em' }}>Internal · Digital Marketing</span>
      </header>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px 64px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 8 }}>
          {(['search', 'add'] as ViewState[]).map((v) => (
            <button key={v} onClick={() => { setView(v); setEnrichResult(null); setEnrichError('') }}
              style={{ border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: view === v || (view === 'detail' && v === 'search') ? '#03318C' : 'white', color: view === v || (view === 'detail' && v === 'search') ? 'white' : '#5C6070', boxShadow: '0 1px 4px rgba(3,49,140,0.08)' }}>
              {v === 'search' ? '🔍 Search Database' : '➕ Add Company'}
            </button>
          ))}
        </div>

        {/* ── SEARCH VIEW ── */}
        {(view === 'search' || view === 'detail') && (
          <div style={card}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #EDEEF2' }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#03318C' }}>Search cached companies</div>
              <div style={{ fontSize: 13, color: '#5C6070', marginTop: 2 }}>Search by email domain or company name</div>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <div style={{ position: 'relative' }}>
                <input
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  placeholder="Type a domain (e.g. hms.se) or company name…"
                  style={{ ...inputStyle, paddingLeft: 36 }}
                />
                <svg width="15" height="15" fill="none" stroke="#9EA3B0" viewBox="0 0 24 24" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              {searching && <div style={{ fontSize: 13, color: '#9EA3B0', marginTop: 12 }}>Searching…</div>}

              {!searching && results.length > 0 && (
                <div style={{ marginTop: 16, border: '1px solid #EDEEF2', borderRadius: 6, overflow: 'hidden' }}>
                  {results.map((r, i) => (
                    <div key={i} onClick={() => openDetail(r)}
                      style={{ padding: '12px 16px', borderBottom: i < results.length - 1 ? '1px solid #EDEEF2' : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.1s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#F7F8FA')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                    >
                      <div style={{ width: 36, height: 36, background: '#E8EDF8', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13, fontWeight: 700, color: '#03318C' }}>
                        {(r['company'] || r['email domain'] || '?')[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#2A2D38' }}>{r['company'] || '—'}</div>
                        <div style={{ fontSize: 12, color: '#9EA3B0', marginTop: 2 }}>{r['email domain']} {r['enriched_at'] ? `· cached ${enrichedDate(r['enriched_at'])}` : ''}</div>
                      </div>
                      <div style={{ fontSize: 12, color: '#9EA3B0' }}>{r['company industries'] || ''}</div>
                      <svg width="14" height="14" fill="none" stroke="#9EA3B0" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </div>
                  ))}
                </div>
              )}

              {!searching && query && results.length === 0 && (
                <div style={{ fontSize: 13, color: '#9EA3B0', marginTop: 12, fontStyle: 'italic' }}>No companies found for "{query}".</div>
              )}
            </div>
          </div>
        )}

        {/* ── DETAIL / EDIT VIEW ── */}
        {view === 'detail' && selected && (
          <div style={card}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #EDEEF2', display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => setView('search')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9EA3B0', display: 'flex', padding: 4 }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#03318C' }}>{selected['company'] || selected['email domain']}</div>
                <div style={{ fontSize: 12, color: '#9EA3B0', marginTop: 2 }}>{selected['email domain']} · cached {enrichedDate(selected['enriched_at'])}</div>
              </div>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {EDITABLE_FIELDS.map((field) => (
                <div key={field}>
                  <label style={labelStyle}>{field}</label>
                  {field === 'company description' || field === 'product description' || field === 'startup information' ? (
                    <textarea
                      value={editFields[field] || ''}
                      onChange={(e) => setEditFields((prev) => ({ ...prev, [field]: e.target.value }))}
                      rows={3}
                      style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                    />
                  ) : (
                    <input
                      value={editFields[field] || ''}
                      onChange={(e) => setEditFields((prev) => ({ ...prev, [field]: e.target.value }))}
                      style={inputStyle}
                    />
                  )}
                </div>
              ))}

              {/* Good fit panel */}
              {selected['good fit'] && (
                <div style={{ padding: '12px 14px', borderRadius: 6, background: selected['good fit'] === 'YES' ? '#E6F4ED' : '#FDEAEA', border: `1px solid ${selected['good fit'] === 'YES' ? '#A7D7BE' : '#F5C2C7'}` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: selected['good fit'] === 'YES' ? '#0A7A3E' : '#C0182A', marginBottom: 4 }}>
                    GOOD FIT: {selected['good fit']}
                  </div>
                  <div style={{ fontSize: 13, color: '#2A2D38' }}>{selected['good fit notes'] || '—'}</div>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 8, borderTop: '1px solid #EDEEF2' }}>
                <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                {saveMsg && (
                  <span style={{ fontSize: 13, color: saveMsg.startsWith('Error') ? '#E4002B' : '#0A7A3E', fontWeight: 500 }}>{saveMsg}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── ADD COMPANY VIEW ── */}
        {view === 'add' && (
          <div style={card}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #EDEEF2' }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#03318C' }}>Add a company manually</div>
              <div style={{ fontSize: 13, color: '#5C6070', marginTop: 2 }}>Enter an email domain and let AI research the company</div>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Email domain *</label>
                  <input
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    placeholder="e.g. hms.se"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Country (optional)</label>
                  <input
                    value={newCountry}
                    onChange={(e) => setNewCountry(e.target.value)}
                    placeholder="e.g. IT, DE, US"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div>
                <button
                  onClick={handleEnrich}
                  disabled={enriching || !newDomain.trim()}
                  style={{ ...btnPrimary, opacity: enriching || !newDomain.trim() ? 0.6 : 1, cursor: enriching || !newDomain.trim() ? 'not-allowed' : 'pointer' }}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  {enriching ? 'Researching…' : 'Enrich with AI'}
                </button>
              </div>

              {enrichError && (
                <div style={{ padding: '12px 14px', borderRadius: 6, background: '#FDEAEA', border: '1px solid #F5C2C7', color: '#C0182A', fontSize: 13 }}>
                  {enrichError}
                </div>
              )}

              {enrichResult && (
                <div style={{ border: '1px solid #EDEEF2', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', background: '#E6F4ED', borderBottom: '1px solid #EDEEF2', fontSize: 13, fontWeight: 600, color: '#0A7A3E', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Company enriched and saved to database
                  </div>
                  <div style={{ padding: '16px' }}>
                    {EDITABLE_FIELDS.filter((f) => enrichResult[f]).map((f) => (
                      <div key={f} style={{ marginBottom: 12 }}>
                        <div style={{ ...labelStyle, marginBottom: 2 }}>{f}</div>
                        <div style={{ fontSize: 13, color: '#2A2D38', lineHeight: 1.5 }}>{enrichResult[f]}</div>
                      </div>
                    ))}
                    {enrichResult['good fit'] && (
                      <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 6, background: enrichResult['good fit'] === 'YES' ? '#E6F4ED' : '#FDEAEA', border: `1px solid ${enrichResult['good fit'] === 'YES' ? '#A7D7BE' : '#F5C2C7'}` }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: enrichResult['good fit'] === 'YES' ? '#0A7A3E' : '#C0182A', marginBottom: 4 }}>
                          GOOD FIT: {enrichResult['good fit']}
                        </div>
                        <div style={{ fontSize: 13, color: '#2A2D38' }}>{enrichResult['good fit notes']}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer style={{ textAlign: 'center', padding: 20, fontSize: 11, color: '#9EA3B0', borderTop: '1px solid #EDEEF2' }}>
        STMicroelectronics · Internal Tool · Digital Marketing
      </footer>
    </div>
  )
}
