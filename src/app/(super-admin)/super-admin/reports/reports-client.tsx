'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { BarChart2, Download, Printer, FileText } from 'lucide-react'

interface Tenant { id: string; name: string }
interface Teacher { id: string; full_name: string; email: string; tenant_id: string | null }
interface Group { id: string; name: string; tenant_id: string | null }

interface ReportTable { heading: string; columns: string[]; rows: (string | number)[][] }
interface Report { title: string; subtitle: string; generatedAt: string; tables: ReportTable[] }

type Scope = 'university' | 'teacher' | 'group'

interface Props { tenants: Tenant[]; teachers: Teacher[]; groups: Group[] }

const SCOPE_LABEL: Record<Scope, string> = {
  university: 'جامعة كاملة',
  teacher: 'معلم',
  group: 'مجموعة',
}

export function ReportsClient({ tenants, teachers, groups }: Props) {
  const [scope, setScope] = useState<Scope>('university')
  const [entityId, setEntityId] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const entities = useMemo(() => {
    if (scope === 'university') return tenants.map(t => ({ id: t.id, label: t.name }))
    if (scope === 'teacher') return teachers.map(t => ({ id: t.id, label: `${t.full_name} — ${t.email}` }))
    return groups.map(g => ({ id: g.id, label: g.name }))
  }, [scope, tenants, teachers, groups])

  async function generate() {
    if (!entityId) { setError('اختر العنصر أولاً'); return }
    setLoading(true); setError(''); setReport(null)
    const res = await fetch(`/api/reports?scope=${scope}&id=${entityId}&format=json`)
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'فشل توليد التقرير'); setLoading(false); return }
    setReport(data)
    setLoading(false)
  }

  function downloadCsv() {
    if (!entityId) return
    window.open(`/api/reports?scope=${scope}&id=${entityId}&format=csv`, '_blank')
  }

  return (
    <div className="space-y-6">
      <style>{`@media print {
        body * { visibility: hidden; }
        #report-print, #report-print * { visibility: visible; }
        #report-print { position: absolute; inset: 0; padding: 24px; color: #000; }
        #report-print table { width: 100%; border-collapse: collapse; }
        #report-print th, #report-print td { border: 1px solid #999; padding: 6px 8px; font-size: 12px; }
        #report-print th { background: #f0f0f0; }
        .no-print { display: none !important; }
      }`}</style>

      <div className="no-print">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center">
            <BarChart2 className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">التقارير</h2>
            <p className="text-slate-400 text-sm">استخرج تقريراً تفصيلياً لأي جامعة أو معلم أو مجموعة</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="no-print bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">نوع التقرير</label>
          <div className="flex gap-2">
            {(Object.keys(SCOPE_LABEL) as Scope[]).map(s => (
              <button
                key={s}
                onClick={() => { setScope(s); setEntityId(''); setReport(null) }}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  scope === s ? 'border-blue-500 bg-blue-500/10 text-blue-300' : 'border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                {SCOPE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">اختر {SCOPE_LABEL[scope]}</label>
          <select
            value={entityId}
            onChange={e => setEntityId(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— اختر —</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={generate} loading={loading} disabled={!entityId}>
            <FileText className="w-4 h-4" /> عرض التقرير
          </Button>
          {report && (
            <>
              <Button variant="secondary" onClick={downloadCsv}>
                <Download className="w-4 h-4" /> تحميل Excel
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer className="w-4 h-4" /> طباعة / حفظ PDF
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Report view (also the print area) */}
      {report && (
        <div id="report-print" className="bg-white text-slate-900 rounded-xl p-6 space-y-5" dir="rtl">
          <div className="border-b border-slate-300 pb-3">
            <h1 className="text-xl font-bold">{report.title}</h1>
            <p className="text-slate-600 text-sm mt-1">{report.subtitle}</p>
            <p className="text-slate-400 text-xs mt-1">
              تاريخ التوليد: {new Date(report.generatedAt).toLocaleString('ar')}
            </p>
          </div>

          {report.tables.map((t, i) => (
            <div key={i} className="space-y-2">
              <h3 className="font-semibold text-slate-800">{t.heading}</h3>
              {t.rows.length === 0 ? (
                <p className="text-slate-400 text-sm">لا توجد بيانات.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        {t.columns.map((c, j) => (
                          <th key={j} className="border border-slate-300 bg-slate-100 px-3 py-2 text-right font-semibold">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.rows.map((row, r) => (
                        <tr key={r} className={r % 2 ? 'bg-slate-50' : ''}>
                          {row.map((cell, c) => (
                            <td key={c} className="border border-slate-300 px-3 py-2 text-right">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
