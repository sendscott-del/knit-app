import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="text-center space-y-3">
        <h1 className="text-4xl font-semibold text-slate-900">Not found</h1>
        <p className="text-slate-600">This page doesn't exist.</p>
        <Link to="/" className="inline-block text-slate-700 underline hover:text-slate-900">
          Go home
        </Link>
      </div>
    </main>
  )
}
