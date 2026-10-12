'use client'

import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
// Imported for its side effect: patches fetch to send X-Org-Id (active library).
import '@/lib/active-library'

export function DashboardLayoutClient({
  children,
  sidebar
}: {
  children: React.ReactNode,
  sidebar: React.ReactNode
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen)
  const closeSidebar = () => setIsSidebarOpen(false)

  return (
    <div className="flex h-screen bg-zinc-900 text-zinc-100 overflow-hidden font-sans relative">
      
      {/* Mobile Header */}
      <div className="md:hidden absolute top-0 left-0 right-0 h-14 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800 z-40 flex items-center px-4 justify-between">
        <div className="font-semibold text-zinc-100">Corporate RAG</div>
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="text-zinc-400 hover:text-zinc-100">
          <Menu className="w-5 h-5" />
        </Button>
      </div>

      {/* Backdrop for Mobile Sidebar */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm transition-opacity"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar Container */}
      <div 
        className={`
          fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
          md:relative md:translate-x-0 md:flex h-full
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        onClick={(e) => {
          // If a link is clicked inside the sidebar, close the mobile sidebar
          const target = e.target as HTMLElement
          // Controls that open a menu (e.g. the library switcher) opt out of auto-closing.
          if (target.closest('[data-keep-sidebar-open]')) return
          if (target.closest('a') || target.closest('button')) {
            if (window.innerWidth < 768) {
              closeSidebar();
            }
          }
        }}
      >
        {sidebar}
        
        {/* Mobile close button inside sidebar container */}
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={closeSidebar} 
          className="absolute top-2 right-2 md:hidden text-zinc-400 hover:text-zinc-100 bg-zinc-950/50 rounded-full"
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen relative bg-zinc-900 pt-14 md:pt-0 overflow-hidden">
        {children}
      </main>
    </div>
  )
}
