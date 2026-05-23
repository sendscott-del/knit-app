import { Navigate } from 'react-router-dom'

/**
 * /admin/roles was consolidated into /admin/users in v0.39.0. Keep the
 * route alive as a redirect so old bookmarks don't 404.
 */
export default function AdminRoles() {
  return <Navigate to="/admin/users" replace />
}
