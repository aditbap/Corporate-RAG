'use client'

import { ChatArea } from '@/components/ChatArea'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Loader2 } from 'lucide-react'
import { ChatAreaSkeleton } from '@/components/ChatAreaSkeleton'

export default function ExistingChatPage() {
  const params = useParams()
  const conversationId = params.id as string
  const [messages, setMessages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    async function fetchConversation() {
      try {
        const supabase = createClient()
        const { data: session } = await supabase.auth.getSession()
        
        if (!session?.session?.access_token) return

        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/conversations/${conversationId}/messages`, {
          headers: {
            'Authorization': `Bearer ${session.session.access_token}`
          }
        })

        if (res.ok) {
          const data = await res.json()
          setMessages(data.messages || [])
        }
      } catch (error) {
        console.error('Failed to fetch conversation history:', error)
      } finally {
        setLoading(false)
      }
    }

    if (conversationId) {
      fetchConversation()
    }
  }, [conversationId])

  if (loading) {
    return <ChatAreaSkeleton />
  }

  return <ChatArea key={conversationId} initialConversationId={conversationId} initialMessages={messages} />
}
