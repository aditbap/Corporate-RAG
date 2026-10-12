import { logout } from '@/app/login/actions'

import { Sidebar } from '@/components/Sidebar'
import { DashboardLayoutClient } from '@/components/DashboardLayoutClient'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <DashboardLayoutClient sidebar={<Sidebar logoutAction={logout} />}>
      {children}
    </DashboardLayoutClient>
  )
}
