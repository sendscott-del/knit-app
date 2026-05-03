import { Link } from 'react-router-dom'
import KnitMark from '@/components/KnitMark'

export default function NotFound() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <KnitMark size={48} />
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">Not found</h1>
        <p className="text-base text-gray-600">This page doesn't exist.</p>
        <Link to="/" className="btn-outline mt-2">
          Go home
        </Link>
      </div>
    </main>
  )
}
