export interface Citation {
  index?: number
  documentId?: string
  document?: string
  documentTitle?: string
  fileName?: string
  fileType?: string
  score?: number
  snippet?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
}
