'use client'

import { ChatArea } from '@/components/ChatArea'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { getAccessToken } from '@/lib/auth-client'
import { ChatAreaSkeleton } from '@/components/ChatAreaSkeleton'
import type { ChatMessage } from '@/types/chat'

export default function ExistingChatPage() {
  const params = useParams()
  const conversationId = params.id as string
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Reset the loading flag when navigating between conversations (fetch-on-param-change).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    async function fetchConversation() {
      try {
        const accessToken = await getAccessToken()

        if (!accessToken) return

        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/conversations/${conversationId}/messages`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`
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
