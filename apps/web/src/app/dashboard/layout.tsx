import Link from 'next/link'
import { Plus, MessageSquare, LogOut, Settings, User } from 'lucide-react'
import { logout } from '@/app/login/actions'
import { Button } from '@/components/ui/button'

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
