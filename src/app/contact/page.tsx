import type { Metadata } from 'next'
import { ContactPage } from '@/components/public/contact-page'

export const metadata: Metadata = {
  title: 'تواصل معنا — EduQuest',
  description: 'تواصل مع فريق EduQuest — اطلب اشتراكاً لجامعتك أو أرسل استفسارك. Contact the EduQuest team.',
}

export default function Contact() {
  return <ContactPage />
}
