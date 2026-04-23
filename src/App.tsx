import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import Landing from '@/pages/Landing'
import AdminLogin from '@/pages/AdminLogin'
import AdminCallback from '@/pages/AdminCallback'
import AdminLayout from '@/pages/AdminLayout'
import AdminDashboard from '@/pages/AdminDashboard'
import AdminMembers from '@/pages/AdminMembers'
import AdminFriends from '@/pages/AdminFriends'
import MemberMagicLink from '@/pages/MemberMagicLink'
import MemberDashboard from '@/pages/MemberDashboard'
import NotFound from '@/pages/NotFound'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/callback" element={<AdminCallback />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="members" element={<AdminMembers />} />
            <Route path="friends" element={<AdminFriends />} />
          </Route>
          <Route path="/m/:memberId/:token" element={<MemberMagicLink />} />
          <Route path="/me" element={<MemberDashboard />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
