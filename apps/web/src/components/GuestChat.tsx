'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles, ArrowUp, Lock, Plus, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import TextareaAutosize from 'react-textarea-autosize'
import { Button } from '@/components/ui/button'
import { login, register } from '@/app/login/actions'
import { ThemeToggle } from '@/components/ThemeToggle'

interface GuestMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const MAX_LENGTH = 2000

/**
 * Public chat for visitors who are not signed in. Talks to the unauthenticated /guest/chat endpoint:
 * a plain assistant with no documents and no saved history. Uploading and library chat need an account.
 */
export function GuestChat() {
  const [messages, setMessages] = useState<GuestMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [limitHit, setLimitHit] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || isLoading) return
    const userMessage: GuestMessage = { id: `u-${Date.now()}`, role: 'user', content: text }
    const assistantId = `a-${Date.now()}`
    const history = [...messages, userMessage]
    setMessages([...history, { id: assistantId, role: 'assistant', content: '' }])
    setInput('')
    setIsLoading(true)

    const append = (extra: string) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + extra } : m)))

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/guest/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      })
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        if (res.status === 429) setLimitHit(true)
        append(err?.error?.message ?? 'Something went wrong. Please try again.')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          const data = part.slice(6)
          if (data === '[DONE]') continue
          try {
            const event = JSON.parse(data) as { type: string; content?: string; message?: string }
            if (event.type === 'chunk' && event.content) append(event.content)
            else if (event.type === 'error') append(event.message ?? 'Generation failed')
          } catch {
            /* ignore a malformed frame */
          }
        }
      }
    } catch {
      append('Could not reach the server. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-end px-4">
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <form action={login}>
            <Button type="submit" variant="ghost" size="sm" className="text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white">Sign in</Button>
          </form>
          <form action={register}>
            <Button type="submit" size="sm">Create account</Button>
          </form>
        </div>
      </header>

      <div className="relative flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 pb-32 text-center">
            <h1 className="text-[22px] font-normal">Let&apos;s chat with RAG Assistant</h1>
            <p className="mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
              Guest chats are not saved. Sign in to upload documents, ask questions about them with cited sources, and keep your history.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 pb-48">
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-3xl bg-muted px-5 py-2.5 text-[15px] leading-[1.65] text-foreground">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex items-start gap-4">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
                    <Sparkles className="size-4" />
                  </div>
                  <div className="prose dark:prose-invert prose-zinc min-w-0 max-w-none flex-1 break-words text-[15px] leading-[1.65]">
                    {m.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    ) : isLoading && i === messages.length - 1 ? (
                      <div className="mt-1 flex h-4 items-center gap-1">
                        {[0, 150, 300].map((d) => (
                          <div key={d} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: `${d}ms` }} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ),
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-zinc-100 dark:from-zinc-900 via-zinc-100/90 dark:via-zinc-900/90 to-transparent px-4 pb-6 pt-10">
        <div className="w-full max-w-3xl">
          {limitHit && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300">
              <span className="flex items-center gap-2"><Lock className="size-4 shrink-0" />Guest limit reached. Create an account to keep chatting.</span>
              <form action={register}><Button type="submit" size="sm">Create account</Button></form>
            </div>
          )}
          {showUpgrade && (
            <div role="dialog" aria-label="Sign in to upload" className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50/90 dark:bg-zinc-950/90 px-4 py-3 text-sm shadow-lg backdrop-blur-md">
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">Sign in to upload files</p>
                <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">Uploads, document Q&amp;A and saved history need an account.</p>
                <div className="mt-3 flex gap-2">
                  <form action={login}><Button type="submit" size="sm">Sign in</Button></form>
                  <form action={register}><Button type="submit" size="sm" variant="outline">Create account</Button></form>
                </div>
              </div>
              <button type="button" onClick={() => setShowUpgrade(false)} aria-label="Close" className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"><X className="size-4" /></button>
            </div>
          )}
          <div className="flex min-h-[52px] items-end rounded-[26px] border border-border/30 bg-card/70 py-1.5 pl-2 pr-2 backdrop-blur-xl">
            <button
              type="button"
              onClick={() => setShowUpgrade((v) => !v)}
              aria-label="Upload a file (sign in required)"
              className="mb-px flex size-9 shrink-0 items-center justify-center rounded-full text-zinc-600 dark:text-zinc-400 transition-colors hover:bg-zinc-300/50 dark:hover:bg-zinc-700/50 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <Plus className="size-6" />
            </button>
            <TextareaAutosize
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_LENGTH))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder="Ask anything"
              maxRows={8}
              disabled={isLoading}
              className="no-scrollbar max-h-[200px] w-full resize-none overflow-y-auto bg-transparent px-2 py-2 text-[15px] leading-relaxed placeholder:text-zinc-600 dark:placeholder:text-zinc-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!input.trim() || isLoading}
              aria-label="Send"
              className="mb-px flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-300 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 transition-transform hover:bg-zinc-400 dark:hover:bg-zinc-600 hover:text-zinc-900 dark:hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground/30"
            >
              <ArrowUp className="size-5" strokeWidth={2.5} />
            </button>
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Guest chats are not saved. AI can make mistakes. Verify important information.
          </p>
        </div>
      </div>
    </div>
  )
}
