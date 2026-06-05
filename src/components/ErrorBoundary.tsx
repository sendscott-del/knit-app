import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientError } from '@/lib/telemetry'

type Props = { children: ReactNode }
type State = { hasError: boolean }

/**
 * App-wide error boundary. Catches render-time exceptions that would
 * otherwise white-screen the app, reports them to /api/events (PII-safe),
 * and shows a calm, recoverable fallback. Intentionally NOT translated with
 * the i18n hook — if i18n itself is what threw, t() may be unavailable, so
 * we keep the fallback copy as plain bilingual strings.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError({
      name: 'render_error',
      message: error.message || 'render error',
      detail: {
        component_stack: (info.componentStack || '').split('\n').slice(0, 6).join(' | ').slice(0, 600),
      },
    })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-xl shadow p-6 text-center space-y-3">
          <div className="text-3xl" aria-hidden>🧶</div>
          <h1 className="text-lg font-semibold text-gray-900">
            Something went wrong
          </h1>
          <p className="text-sm text-gray-600">
            We hit an unexpected error and our team has been notified. Try
            reloading — your information is safe.
            <br />
            <span className="text-gray-400">
              Algo salió mal. Vuelve a cargar la página; tu información está a salvo.
            </span>
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-lg bg-knit-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Reload · Recargar
          </button>
        </div>
      </div>
    )
  }
}
