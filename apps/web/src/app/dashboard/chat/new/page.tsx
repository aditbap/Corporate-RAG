'use client'

import { ChatArea } from '@/components/ChatArea'
import { useSearchParams } from 'next/navigation'

export default function NewChatPage() {
  const searchParams = useSearchParams()
  const docIdsParam = searchParams.get('docIds')
  
  const documentIds = docIdsParam ? docIdsParam.split(',') : []

  return <ChatArea key="new" documentIds={documentIds} />
}
