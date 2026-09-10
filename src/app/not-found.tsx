import Link from 'next/link'

export const metadata = {
  title: 'Page not found · EduQuest',
}

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Page not found</h1>
        <p className="text-gray-500 mb-6">The page you are looking for does not exist.</p>
        <Link href="/" className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          Back to EduQuest
        </Link>
      </div>
    </div>
  )
}
