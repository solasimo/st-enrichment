'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { parseCSV, toCSV, countEmptyEnrichableFields, LeadRow, UNCACHED_FIELDS } from "@/lib/csv"

// ── Types ─────────────────────────────────────────────────────────────────────

type LogStatus = 'pending' | 'running' | 'done' | 'cached' | 'skipped' | 'error'

interface LogEntry {
  index: number
  leadId: string
  domain: string
  status: LogStatus
  msg: string
}

interface Stats {
  total: number
  enriched: number
  cached: number
  skipped: number
  errors: number
  fieldsTotal: number
}

interface DbStats {
  total: number
  byYear: { year: string; count: number }[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [csvData, setCsvData]     = useState<{ headers: string[]; rows: LeadRow[] } | null>(null)
  const [fileName, setFileName]   = useState('')
  const [dragging, setDragging]   = useState(false)
  const [logs, setLogs]           = useState<LogEntry[]>([])
  const [enrichedRows, setEnrichedRows] = useState<LeadRow[] | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress]   = useState(0)
  const [stats, setStats]         = useState<Stats | null>(null)
  const [dbStats, setDbStats]     = useState<DbStats | null>(null)
  const [dbStatsLoading, setDbStatsLoading] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load DB stats on mount and after enrichment
  const loadDbStats = useCallback(async () => {
    setDbStatsLoading(true)
    try {
      const res = await fetch('/api/stats')
      if (res.ok) setDbStats(await res.json())
    } catch { /* silent */ }
    setDbStatsLoading(false)
  }, [])

  useEffect(() => { loadDbStats() }, [loadDbStats])

  const loadFile = useCallback((file: File | null | undefined) => {
    if (!file || !file.name.endsWith('.csv')) { alert('Please upload a .csv file.'); return }
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const parsed = parseCSV(text)
        if (!parsed.headers.includes('Lead ID') || !parsed.headers.includes('email domain')) {
          throw new Error('CSV must include "Lead ID" and "email domain" columns.')
        }
        setCsvData(parsed)
        setFileName(file.name)
        setLogs([])
        setEnrichedRows(null)
        setProgress(0)
        setStats(null)
      } catch (err) {
        alert('Error reading CSV: ' + (err instanceof Error ? err.message : String(err)))
      }
    }
    reader.readAsText(file)
  }, [])

  const resetFile = () => {
    setCsvData(null); setFileName(''); setLogs([])
    setEnrichedRows(null); setProgress(0); setStats(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const updateLog = (index: number, update: Partial<LogEntry>) =>
    setLogs((prev) => prev.map((l, i) => (i === index ? { ...l, ...update } : l)))

  const runEnrichment = async () => {
    if (!csvData) return
    setIsRunning(true); setEnrichedRows(null); setStats(null); setProgress(0)

    const { rows, headers } = csvData
    setLogs(rows.map((r, i) => ({
      index: i, leadId: r['Lead ID'] || `Row ${i + 1}`,
      domain: r['email domain'] || '(no domain)', status: 'pending', msg: 'Waiting…',
    })))

    const results = [...rows]
    let enrichedCount = 0, cachedCount = 0, skippedCount = 0, errorCount = 0, fieldsTotal = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const domain = row['email domain']
      const emptyBefore = countEmptyEnrichableFields(row)

      updateLog(i, { status: 'running', msg: `Researching ${domain}…` })

      if (!domain) {
        updateLog(i, { status: 'skipped', msg: 'No email domain — skipped' }); skippedCount++
      } else if (emptyBefore === 0) {
        updateLog(i, { status: 'skipped', msg: 'All fields already filled — skipped' }); skippedCount++
      } else {
        try {
          const res = await fetch('/api/enrich', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, existingData: row }),
          })
          if (!res.ok) { const err = await res.json(); throw new Error(err.error || `HTTP ${res.status}`) }

          const { result, source, cachedAt } = await res.json()
          const emptyAfter = countEmptyEnrichableFields(result)
          const filled = emptyBefore - emptyAfter
          fieldsTotal += filled
          results[i] = result

          if (source === 'cache') {
            cachedCount++
            const date = cachedAt ? new Date(cachedAt).toLocaleDateString('it-IT') : ''
            updateLog(i, { status: 'cached', msg: `From cache${date ? ` (${date})` : ''} · ${filled} field${filled !== 1 ? 's' : ''} filled` })
          } else {
            enrichedCount++
            updateLog(i, { status: 'done', msg: `Enriched by AI · ${filled} field${filled !== 1 ? 's' : ''} filled` })
          }
        } catch (err) {
          errorCount++
          updateLog(i, { status: 'error', msg: `Error: ${err instanceof Error ? err.message : String(err)}` })
        }
      }
      setProgress(Math.round(((i + 1) / rows.length) * 100))
    }

    setEnrichedRows(results)
    setStats({ total: rows.length, enriched: enrichedCount, cached: cachedCount, skipped: skippedCount, errors: errorCount, fieldsTotal })
    setIsRunning(false)
    loadDbStats() // refresh DB stats after enrichment
  }

  const downloadCSV = () => {
    if (!enrichedRows || !csvData) return
    const extraCols = UNCACHED_FIELDS.filter((f) => !csvData.headers.includes(f))
    const outputHeaders = [...csvData.headers, ...extraCols]
    const content = toCSV(outputHeaders, enrichedRows)
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName.replace('.csv', '') + '_enriched.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const leadsNeedingEnrichment = csvData
    ? csvData.rows.filter((r) => r['email domain'] && countEmptyEnrichableFields(r) > 0).length
    : 0

  const statusColor: Record<LogStatus, string> = {
    pending: '#9EA3B0', running: '#03318C', done: '#0A7A3E',
    cached: '#7C3AED', skipped: '#D8DAE0', error: '#E4002B',
  }

  const S = (x: React.CSSProperties) => x // style helper for brevity

  return (
    <div style={{ minHeight: '100vh', background: '#F7F8FA', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

      {/* Header */}
      <header style={{ background: '#03318C', color: 'white', height: 56, display: 'flex', alignItems: 'center', padding: '0 32px', gap: 16, boxShadow: '0 2px 8px rgba(3,49,140,0.3)' }}>
        <div style={{ width: 32, height: 32, background: '#E4002B', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>ST</div>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Lead Enrichment</span>
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.2)', margin: '0 4px' }} />
        <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 12, padding: '3px 10px', letterSpacing: '0.04em' }}>Internal · Digital Marketing</span>
      </header>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px 64px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* ── DB Stats card ── */}
        <div style={{ background: 'white', border: '1px solid #D8DAE0', borderRadius: 6, boxShadow: '0 1px 4px rgba(3,49,140,0.08)' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #EDEEF2', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, background: '#E8EDF8', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" fill="none" stroke="#03318C" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 4 4 5 4 7z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16" />
                </svg>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#03318C' }}>Domain Cache</div>
                <div style={{ fontSize: 13, color: '#5C6070', marginTop: 2 }}>Companies already enriched in the database</div>
              </div>
            </div>
            <button
              onClick={loadDbStats}
              disabled={dbStatsLoading}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9EA3B0', padding: 4, borderRadius: 4, display: 'flex', transition: 'color 0.15s' }}
              title="Refresh"
            >
              <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ animation: dbStatsLoading ? 'spin 1s linear infinite' : 'none' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
          <div style={{ padding: '16px 24px' }}>
            {dbStatsLoading ? (
              <div style={{ fontSize: 13, color: '#9EA3B0' }}>Loading…</div>
            ) : dbStats ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                {/* Total */}
                <div style={{ textAlign: 'center', minWidth: 80 }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: '#03318C', lineHeight: 1 }}>{dbStats.total}</div>
                  <div style={{ fontSize: 11, color: '#9EA3B0', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>Total domains</div>
                </div>

                {/* Divider */}
                {dbStats.byYear.length > 0 && (
                  <div style={{ width: 1, height: 48, background: '#EDEEF2', flexShrink: 0 }} />
                )}

                {/* By year */}
                {dbStats.byYear.map(({ year, count }) => (
                  <div key={year} style={{ textAlign: 'center', minWidth: 60 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#2A2D38', lineHeight: 1 }}>{count}</div>
                    <div style={{ fontSize: 11, color: '#9EA3B0', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{year}</div>
                    {/* mini bar */}
                    <div style={{ height: 3, background: '#EDEEF2', borderRadius: 2, marginTop: 6, width: 48, margin: '6px auto 0' }}>
                      <div style={{ height: '100%', background: '#03318C', borderRadius: 2, width: `${Math.round((count / dbStats.total) * 100)}%` }} />
                    </div>
                  </div>
                ))}

                {dbStats.total === 0 && (
                  <div style={{ fontSize: 13, color: '#9EA3B0', fontStyle: 'italic' }}>No domains cached yet — enrich your first batch to populate the database.</div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#E4002B' }}>Could not load database stats.</div>
            )}
          </div>
        </div>

        {/* ── Upload card ── */}
        <div style={{ background: 'white', border: '1px solid #D8DAE0', borderRadius: 6, boxShadow: '0 1px 4px rgba(3,49,140,0.08)' }}>
          <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #EDEEF2', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, background: '#E8EDF8', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" fill="none" stroke="#03318C" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#03318C' }}>Upload Leads</div>
              <div style={{ fontSize: 13, color: '#5C6070', marginTop: 2 }}>CSV exported from Salesforce with Lead ID, email domain, and other fields</div>
            </div>
          </div>
          <div style={{ padding: '20px 24px' }}>
            {!csvData ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); loadFile(e.dataTransfer.files[0]) }}
                style={{ border: `2px dashed ${dragging ? '#03318C' : '#D8DAE0'}`, borderRadius: 6, padding: '40px 24px', textAlign: 'center', cursor: 'pointer', position: 'relative', background: dragging ? '#E8EDF8' : 'transparent', transition: 'all 0.15s' }}
              >
                <input ref={fileInputRef} type="file" accept=".csv" onChange={(e) => loadFile(e.target.files?.[0])} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                <div style={{ width: 48, height: 48, background: '#E8EDF8', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                  <svg width="22" height="22" fill="none" stroke="#03318C" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Drop your CSV here, or click to browse</div>
                <div style={{ fontSize: 12, color: '#9EA3B0' }}>Required columns: Lead ID, email domain</div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: '#E8EDF8', border: '1px solid #C0CCEC', borderRadius: 6 }}>
                  <div style={{ width: 36, height: 36, background: '#03318C', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="18" height="18" fill="none" stroke="white" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#03318C' }}>{fileName}</div>
                    <div style={{ fontSize: 12, color: '#5C6070', marginTop: 2 }}>{csvData.rows.length} leads · {csvData.headers.length} columns</div>
                  </div>
                  <button onClick={resetFile} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9EA3B0', padding: 4, borderRadius: 4, display: 'flex' }}>
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                <div style={{ overflowX: 'auto', border: '1px solid #D8DAE0', borderRadius: 6, marginTop: 16 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>{csvData.headers.map((h) => <th key={h} style={{ background: '#F7F8FA', color: '#5C6070', fontWeight: 600, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.06em', padding: '9px 12px', textAlign: 'left', borderBottom: '1px solid #D8DAE0', whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {csvData.rows.slice(0, 5).map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #EDEEF2' }}>
                          {csvData.headers.map((h) => <td key={h} style={{ padding: '8px 12px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: row[h] ? '#2A2D38' : '#D8DAE0', fontStyle: row[h] ? 'normal' : 'italic' }}>{row[h] || '—'}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {csvData.rows.length > 5 && <div style={{ fontSize: 11, color: '#9EA3B0', textAlign: 'center', marginTop: 8 }}>Showing 5 of {csvData.rows.length} rows</div>}

                <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
                  <span style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: '#E8EDF8', color: '#03318C' }}>📋 {csvData.rows.length} total leads</span>
                  <span style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: '#FEF3E2', color: '#B45309' }}>⚡ {leadsNeedingEnrichment} need enrichment</span>
                  {csvData.rows.length - leadsNeedingEnrichment > 0 && <span style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: '#E6F4ED', color: '#0A7A3E' }}>✓ {csvData.rows.length - leadsNeedingEnrichment} already complete</span>}
                </div>

                <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #EDEEF2', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <button
                    onClick={runEnrichment}
                    disabled={isRunning || leadsNeedingEnrichment === 0}
                    style={{ background: isRunning || leadsNeedingEnrichment === 0 ? '#9EA3B0' : '#03318C', color: 'white', border: 'none', borderRadius: 6, padding: '10px 22px', fontSize: 14, fontWeight: 600, cursor: isRunning || leadsNeedingEnrichment === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' }}
                  >
                    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    {isRunning ? 'Enriching…' : `Enrich ${leadsNeedingEnrichment} lead${leadsNeedingEnrichment !== 1 ? 's' : ''}`}
                  </button>
                  {leadsNeedingEnrichment === 0 && <span style={{ fontSize: 13, color: '#5C6070' }}>All leads already have complete data.</span>}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Progress card ── */}
        {logs.length > 0 && (
          <div style={{ background: 'white', border: '1px solid #D8DAE0', borderRadius: 6, boxShadow: '0 1px 4px rgba(3,49,140,0.08)' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #EDEEF2', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, background: '#E8EDF8', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" fill="none" stroke="#03318C" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#03318C' }}>Enrichment Progress</div>
                <div style={{ fontSize: 13, color: '#5C6070', marginTop: 2 }}>{isRunning ? 'Processing leads…' : 'Complete'}</div>
              </div>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <div style={{ height: 6, background: '#EDEEF2', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: 'linear-gradient(90deg, #03318C, #2A6BDB)', borderRadius: 3, width: `${progress}%`, transition: 'width 0.4s ease' }} />
              </div>
              <div style={{ fontSize: 12, color: '#5C6070', textAlign: 'right', marginTop: 6 }}>{progress}%</div>
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
                {logs.map((l, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 4, display: 'flex', alignItems: 'flex-start', gap: 8, fontFamily: "'Cascadia Code', 'Fira Mono', monospace", background: l.status === 'running' ? '#E8EDF8' : l.status === 'done' ? '#E6F4ED' : l.status === 'cached' ? '#F3F0FF' : l.status === 'error' ? '#FDEAEA' : '#F7F8FA', color: statusColor[l.status] }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor[l.status], flexShrink: 0, marginTop: 4 }} />
                    <span><strong>{l.leadId}</strong> · {l.domain} · {l.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Results card ── */}
        {stats && enrichedRows && (
          <div style={{ background: 'white', border: '1px solid #D8DAE0', borderRadius: 6, boxShadow: '0 1px 4px rgba(3,49,140,0.08)' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #EDEEF2', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, background: '#E6F4ED', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" fill="none" stroke="#0A7A3E" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#03318C' }}>Enrichment Complete</div>
                <div style={{ fontSize: 13, color: '#5C6070', marginTop: 2 }}>Your file is ready to download</div>
              </div>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 20 }}>
                {[
                  { val: stats.total, lbl: 'Total Leads', color: '#03318C' },
                  { val: stats.enriched, lbl: 'Enriched by AI', color: '#0A7A3E' },
                  { val: stats.cached, lbl: 'From Cache', color: '#7C3AED' },
                  { val: stats.fieldsTotal, lbl: 'Fields Filled', color: '#03318C' },
                  ...(stats.skipped > 0 ? [{ val: stats.skipped, lbl: 'Skipped', color: '#9EA3B0' }] : []),
                  ...(stats.errors > 0 ? [{ val: stats.errors, lbl: 'Errors', color: '#E4002B' }] : []),
                ].map((s) => (
                  <div key={s.lbl} style={{ background: '#F7F8FA', border: '1px solid #EDEEF2', borderRadius: 6, padding: '14px 16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.val}</div>
                    <div style={{ fontSize: 11, color: '#9EA3B0', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{s.lbl}</div>
                  </div>
                ))}
              </div>
              {stats.errors > 0 && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 6, background: '#FDEAEA', border: '1px solid #F5C2C7', color: '#C0182A', fontSize: 13, marginBottom: 16 }}>
                  <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {stats.errors} lead{stats.errors !== 1 ? 's' : ''} could not be enriched and are included with their original data.
                </div>
              )}
              <button onClick={downloadCSV} style={{ background: 'white', color: '#03318C', border: '1.5px solid #03318C', borderRadius: 6, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download enriched CSV
              </button>
            </div>
          </div>
        )}
      </main>

      <footer style={{ textAlign: 'center', padding: 20, fontSize: 11, color: '#9EA3B0', borderTop: '1px solid #EDEEF2' }}>
        STMicroelectronics · Internal Tool · Digital Marketing
      </footer>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
