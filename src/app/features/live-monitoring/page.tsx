import type { Metadata } from 'next'
import { LiveMonitoringPage } from '@/components/public/live-monitoring-page'

export const metadata: Metadata = {
  title: 'المراقبة الحية — EduQuest',
  description: 'مراقبة حية بالصوت والصورة لكل طلاب الاختبار في آنٍ واحد، مع رصد ذكاء اصطناعي للمخالفات. Live audio/video exam monitoring on EduQuest.',
}

export default function LiveMonitoring() {
  return <LiveMonitoringPage />
}
