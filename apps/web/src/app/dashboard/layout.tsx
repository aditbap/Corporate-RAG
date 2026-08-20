import Link from 'next/link'
import { Plus, MessageSquare, LogOut, Settings, User } from 'lucide-react'
import { logout } from '@/app/login/actions'
import { Button } from '@/components/ui/button'

import { Sidebar } from '@/components/Sidebar'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen bg-zinc-900 text-zinc-100 overflow-hidden font-sans">
      <Sidebar logoutAction={logout} />

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen relative bg-zinc-900">
        {children}
      </main>
    </div>
  )
}
