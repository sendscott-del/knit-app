import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import { DemoModeProvider } from '@/lib/demoMode'
import DemoModeBanner from '@/components/DemoModeBanner'
import Landing from '@/pages/Landing'
import AdminLogin from '@/pages/AdminLogin'
import Signup from '@/pages/Signup'
import ForgotPassword from '@/pages/ForgotPassword'
import ResetPassword from '@/pages/ResetPassword'
import AdminCallback from '@/pages/AdminCallback'
import AdminLayout from '@/pages/AdminLayout'
import AdminDashboard from '@/pages/AdminDashboard'
import AdminInsights from '@/pages/AdminInsights'
import AdminMembers from '@/pages/AdminMembers'
import AdminInvitations from '@/pages/AdminInvitations'
import AdminFriends from '@/pages/AdminFriends'
import AdminSuggest from '@/pages/AdminSuggest'
import AdminOutings from '@/pages/AdminOutings'
import AdminSheet from '@/pages/AdminSheet'
import AdminSettings from '@/pages/AdminSettings'
import AdminUsers from '@/pages/AdminUsers'
import AdminRoles from '@/pages/AdminRoles'
import AdminDemo from '@/pages/AdminDemo'
import AdminGather from '@/pages/AdminGather'
import AdminGuide from '@/pages/AdminGuide'
import AdminReleaseNotes from '@/pages/AdminReleaseNotes'
import MemberMagicLink from '@/pages/MemberMagicLink'
import MemberDashboard from '@/pages/MemberDashboard'
import MemberJoin from '@/pages/MemberJoin'
import NotFound from '@/pages/NotFound'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DemoModeProvider>
        <DemoModeBanner />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/admin/callback" element={<AdminCallback />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="insights" element={<AdminInsights />} />
            <Route path="members" element={<AdminMembers />} />
            <Route path="invitations" element={<AdminInvitations />} />
            <Route path="friends" element={<AdminFriends />} />
            <Route path="outings" element={<AdminOutings />} />
            <Route path="suggest" element={<AdminSuggest />} />
            <Route path="sheet" element={<AdminSheet />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="roles" element={<AdminRoles />} />
            <Route path="demo" element={<AdminDemo />} />
            <Route path="gather" element={<AdminGather />} />
            <Route path="guide" element={<AdminGuide />} />
            <Route path="release-notes" element={<AdminReleaseNotes />} />
          </Route>
          <Route path="/m/:memberId/:token" element={<MemberMagicLink />} />
          <Route path="/me" element={<MemberDashboard />} />
          <Route path="/join" element={<MemberJoin />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </DemoModeProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
