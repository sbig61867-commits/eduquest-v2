'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { BarChart2, Download, Printer, FileText } from 'lucide-react'

interface Tenant { id: string; name: string }
interface Person { id: string; full_name: string; email: string; tenant_id: string | null }
interface Group { id: string; name: string; tenant_id: string | null }

interface ReportTable { heading: string; columns: string[]; rows: (string | number)[][] }
interface Report { title: string; subtitle: string; university?: string; generatedAt: string; lang?: 'ar' | 'en'; tables: ReportTable[] }

type Scope = 'university' | 'teacher' | 'group' | 'student'
type Lang = 'ar' | 'en'

// UI chrome strings (letterhead / signature / footer) per report language
const UI = {
  ar: {
    tagline: 'منصة التعليم الرقمية متعددة الجامعات',
    refLabel: 'الرقم المرجعي', dateLabel: 'التاريخ', timeLabel: 'وقت الإصدار',
    uniLabel: 'الجامعة',
    sigTitle: 'الاعتماد', sigName: 'الاسم', sigSignature: 'التوقيع', sigDate: 'التاريخ',
    footerAuto: 'وثيقة صادرة آلياً من منصة EduQuest', footerConf: 'سري — للاستخدام الإداري فقط',
    locale: 'ar',
  },
  en: {
    tagline: 'Multi-University Digital Learning Platform',
    refLabel: 'Reference No.', dateLabel: 'Date', timeLabel: 'Issued At',
    uniLabel: 'University',
    sigTitle: 'Approval', sigName: 'Name', sigSignature: 'Signature', sigDate: 'Date',
    footerAuto: 'Document generated automatically by EduQuest', footerConf: 'Confidential — for administrative use only',
    locale: 'en-GB',
  },
} as const

interface Props { tenants: Tenant[]; teachers: Person[]; groups: Group[]; students: Person[] }

const SCOPE_LABEL: Record<Scope, string> = {
  university: 'جامعة كاملة',
  teacher: 'معلم',
  group: 'مجموعة',
  student: 'طالب',
}

export function ReportsClient({ tenants, teachers, groups, students }: Props) {
  const [scope, setScope] = useState<Scope>('university')
  const [lang, setLang] = useState<Lang>('ar')
  const [entityId, setEntityId] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const entities = useMemo(() => {
    if (scope === 'university') return tenants.map(t => ({ id: t.id, label: t.name }))
    if (scope === 'teacher') return teachers.map(t => ({ id: t.id, label: `${t.full_name} — ${t.email}` }))
    if (scope === 'student') return students.map(s => ({ id: s.id, label: `${s.full_name} — ${s.email}` }))
    return groups.map(g => ({ id: g.id, label: g.name }))
  }, [scope, tenants, teachers, groups, students])

  async function generate() {
    if (!entityId) { setError('اختر العنصر أولاً'); return }
    setLoading(true); setError(''); setReport(null)
    const res = await fetch(`/api/reports?scope=${scope}&id=${entityId}&format=json&lang=${lang}`)
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'فشل توليد التقرير'); setLoading(false); return }
    setReport(data)
    setLoading(false)
  }

  function downloadCsv() {
    if (!entityId) return
    window.open(`/api/reports?scope=${scope}&id=${entityId}&format=csv&lang=${lang}`, '_blank')
  }

  return (
    <div className="space-y-6">
      <style>{`@media print {
        @page { size: A4; margin: 14mm 12mm; }
        body * { visibility: hidden; }
        #report-print, #report-print * { visibility: visible; }
        #report-print { position: absolute; inset: 0; padding: 0; color: #000; border-radius: 0; }
        #report-print table { width: 100%; border-collapse: collapse; }
        #report-print th, #report-print td { border: 1px solid #999; padding: 6px 8px; font-size: 12px; }
        #report-print th { background: #f0f0f0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        #report-print .print-color { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        #report-print h3 { break-after: avoid; }
        #report-print table, #report-print tr { break-inside: avoid; }
        .no-print { display: none !important; }
      }`}</style>

      <div className="no-print">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center">
            <BarChart2 className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">التقارير</h2>
            <p className="text-slate-400 text-sm">استخرج تقريراً تفصيلياً لأي جامعة أو معلم أو مجموعة أو طالب</p>
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
          <label className="block text-sm font-medium text-slate-300 mb-2">لغة التقرير</label>
          <div className="flex gap-2">
            {([['ar', 'العربية'], ['en', 'English']] as [Lang, string][]).map(([l, label]) => (
              <button
                key={l}
                onClick={() => { setLang(l); setReport(null) }}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  lang === l ? 'border-blue-500 bg-blue-500/10 text-blue-300' : 'border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                {label}
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
      {report && (() => {
        const rlang: Lang = report.lang ?? 'ar'
        const ui = UI[rlang]
        const rtl = rlang === 'ar'
        const cellAlign = rtl ? 'text-right' : 'text-left'
        return (
        <div id="report-print" className="bg-white text-slate-900 rounded-xl p-8 space-y-5" dir={rtl ? 'rtl' : 'ltr'}>
          {/* ── Official letterhead ── */}
          <div className="border-b-4 border-blue-700 pb-4">
            <div className="flex items-start justify-between gap-4">
              {/* Platform identity */}
              <div className="flex items-center gap-3">
                <div className="print-color w-14 h-14 rounded-xl bg-blue-700 flex items-center justify-center shrink-0">
                  <span className="text-white text-3xl font-bold">E</span>
                </div>
                <div>
                  <p className="text-xl font-bold text-blue-900 leading-tight">EduQuest</p>
                  <p className="text-slate-600 text-xs">{ui.tagline}</p>
                  <p className="text-slate-400 text-[10px] mt-0.5" dir="ltr">eduquest-v2.vercel.app</p>
                </div>
              </div>
              {/* Document metadata */}
              <div className="text-xs text-slate-600 space-y-1 shrink-0">
                <p>
                  <span className="text-slate-400">{ui.refLabel}:</span>{' '}
                  <span className="font-mono font-semibold" dir="ltr">
                    RPT-{new Date(report.generatedAt).toISOString().slice(0, 10).replace(/-/g, '')}-{scope.slice(0, 3).toUpperCase()}
                  </span>
                </p>
                <p>
                  <span className="text-slate-400">{ui.dateLabel}:</span>{' '}
                  <span className="font-semibold">{new Date(report.generatedAt).toLocaleDateString(ui.locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </p>
                <p>
                  <span className="text-slate-400">{ui.timeLabel}:</span>{' '}
                  <span className="font-semibold">{new Date(report.generatedAt).toLocaleTimeString(ui.locale, { hour: '2-digit', minute: '2-digit' })}</span>
                </p>
              </div>
            </div>
          </div>

          {/* ── Report title block ── */}
          <div className="text-center py-2">
            {report.university && (
              <p className="text-sm font-semibold text-blue-800 mb-1">
                {ui.uniLabel}: {report.university}
              </p>
            )}
            <h1 className="text-2xl font-bold text-slate-900">{report.title}</h1>
            <p className="text-slate-600 text-sm mt-1.5">{report.subtitle}</p>
            <div className="print-color w-24 h-0.5 bg-blue-700 mx-auto mt-3" />
          </div>

          {report.tables.map((t, i) => (
            <div key={i} className="space-y-2">
              <h3 className="font-semibold text-slate-800">{t.heading}</h3>
              {t.rows.length === 0 ? (
                <p className="text-slate-400 text-sm">{rtl ? 'لا توجد بيانات.' : 'No data.'}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        {t.columns.map((c, j) => (
                          <th key={j} className={`border border-slate-300 bg-slate-100 px-3 py-2 ${cellAlign} font-semibold`}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.rows.map((row, r) => (
                        <tr key={r} className={r % 2 ? 'bg-slate-50' : ''}>
                          {row.map((cell, c) => (
                            <td key={c} className={`border border-slate-300 px-3 py-2 ${cellAlign}`}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {/* ── Signature block ── */}
          <div className="pt-8">
            <p className="text-sm font-semibold text-slate-700 mb-6">{ui.sigTitle}</p>
            <div className="flex items-end justify-between gap-8 max-w-2xl">
              <div className="flex-1">
                <div className="border-b border-slate-400 h-8" />
                <p className="text-xs text-slate-500 mt-1.5">{ui.sigName}</p>
              </div>
              <div className="flex-1">
                <div className="border-b border-slate-400 h-8" />
                <p className="text-xs text-slate-500 mt-1.5">{ui.sigSignature}</p>
              </div>
              <div className="flex-1">
                <div className="border-b border-slate-400 h-8" />
                <p className="text-xs text-slate-500 mt-1.5">{ui.sigDate}</p>
              </div>
            </div>
          </div>

          {/* ── Official footer ── */}
          <div className="border-t-2 border-slate-300 pt-3 mt-6 flex items-center justify-between text-[11px] text-slate-500">
            <p>{ui.footerAuto}</p>
            <p>{ui.footerConf}</p>
          </div>
        </div>
        )
      })()}
    </div>
  )
}
