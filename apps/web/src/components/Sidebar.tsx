'use client'

import Link from 'next/link'
import { Plus, MessageSquare, LogOut, User, Loader2, Trash2, Library } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { usePathname } from 'next/navigation'

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

export function Sidebar({ logoutAction }: { logoutAction: () => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const pathname = usePathname()
  const supabase = createClient()

  useEffect(() => {
    async function fetchConversations() {
      try {
        const { data: session } = await supabase.auth.getSession()
        if (!session?.session?.access_token) return

        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/conversations/`, {
          headers: {
            'Authorization': `Bearer ${session.session.access_token}`
          }
        })

        if (res.ok) {
          const data = await res.json()
          console.log('Fetched conversations:', data)
          setConversations(data.data || [])
        } else {
          console.error('Failed to fetch conversations, status:', res.status)
        }
      } catch (error) {
        console.error('Failed to fetch conversations:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchConversations()

    // Listen for custom event when a new chat is created
    const handleChatCreated = () => fetchConversations()
    window.addEventListener('chat-created', handleChatCreated)
    
    return () => window.removeEventListener('chat-created', handleChatCreated)
  }, [pathname, supabase]) // Refetch when pathname changes (e.g. after creating new chat)

  return (
    <aside className="w-[260px] bg-zinc-950 border-r border-zinc-800 flex flex-col shrink-0">
      <div className="p-4">
        <Link href="/dashboard/chat">
          <Button variant="outline" className="w-full justify-start text-sm h-10 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-100 border-zinc-800 shadow-sm transition-all rounded-full">
            <Plus className="w-4 h-4 mr-2" />
            New Chat
          </Button>
        </Link>
      </div>

      <div className="px-3 mb-4">
        <Link 
          href="/dashboard/library" 
          className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${pathname === '/dashboard/library' ? 'bg-zinc-800 text-zinc-100 font-medium' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}`}
        >
          <Library className={`w-4 h-4 ${pathname === '/dashboard/library' ? 'text-zinc-100' : 'text-zinc-400 group-hover:text-zinc-200'}`} />
          <span className="text-sm">Knowledge Library</span>
        </Link>
      </div>
      
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="text-xs font-semibold text-zinc-500 mb-3 px-2 uppercase tracking-wider">History</div>
        
        {loading ? (
          <div className="space-y-1 mt-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg">
                <div className="w-4 h-4 rounded bg-zinc-800/50 animate-pulse shrink-0" />
                <div className="h-4 bg-zinc-800/50 rounded animate-pulse w-3/4" />
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-sm text-zinc-500 px-2">No conversations yet</div>
        ) : (
          <div className="space-y-0.5">
            {conversations.map(conv => {
              const isActive = pathname === `/dashboard/chat/${conv.id}`
              
              const handleDelete = async (e: React.MouseEvent) => {
                e.preventDefault();
                try {
                  const { data: session } = await supabase.auth.getSession()
                  if (!session?.session?.access_token) return
          
                  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/conversations/${conv.id}`, {
                    method: 'DELETE',
                    headers: {
                      'Authorization': `Bearer ${session.session.access_token}`
                    }
                  })
          
                  if (res.ok) {
                    setConversations(prev => prev.filter(c => c.id !== conv.id))
                    if (isActive) {
                      window.location.href = '/dashboard/chat'
                    }
                  }
                } catch (error) {
                  console.error('Failed to delete conversation:', error)
                }
              }

              return (
                <Link 
                  key={conv.id} 
                  href={`/dashboard/chat/${conv.id}`} 
                  className={`group flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-colors ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <span className="text-sm truncate">{conv.title || 'New Conversation'}</span>
                  </div>
                  <button 
                    onClick={handleDelete}
                    className={`shrink-0 p-1.5 rounded-md hover:bg-zinc-700 hover:text-zinc-100 transition-colors ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    title="Delete chat"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-zinc-800/50">
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" className="w-full justify-start text-sm h-10 hover:bg-zinc-800 text-zinc-400 rounded-lg">
            <User className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </form>
      </div>
    </aside>
  )
}
