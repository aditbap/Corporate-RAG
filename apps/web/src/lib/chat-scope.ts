const key = (conversationId: string) => `rag.chatScope:${conversationId}`

/**
 * A chat can be limited to specific documents ("Chat about this" / "Start chat"). The scope comes
 * from the URL of the *new* chat page, but after the first answer the app navigates to
 * /dashboard/chat/<id> and the URL no longer carries it — so remember it per conversation, or
 * follow-up questions would silently search the whole library.
 */
export function saveChatScope(conversationId: string, documentIds: string[]) {
  try {
    window.localStorage.setItem(key(conversationId), JSON.stringify(documentIds))
  } catch {
    /* storage unavailable — the scope just won't survive navigation */
  }
}

export function loadChatScope(conversationId: string): string[] {
  try {
    const raw = window.localStorage.getItem(key(conversationId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}
