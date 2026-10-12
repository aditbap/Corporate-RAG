'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, Loader2, Paperclip, ArrowUp, X, FileText, CheckCircle2, Plus, Mic, AlertCircle } from 'lucide-react'
import { getAccessToken } from '@/lib/auth-client'
import { useRouter } from 'next/navigation'
import { Download, ImageIcon } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import TextareaAutosize from 'react-textarea-autosize'
import { cn } from '@/lib/utils'
import type { ChatMessage, Citation } from '@/types/chat'

type Message = ChatMessage

export function ChatArea({
  initialConversationId,
  initialMessages = []
}: {
  initialConversationId?: string,
  initialMessages?: Message[]
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<{ file: string, status: 'uploading' | 'success' | 'error' } | null>(null)
  const [notification, setNotification] = useState<{message: string, type: 'error' | 'success'} | null>(null)
  const [documentIds, setDocumentIds] = useState<string[]>([])
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const docIds = params.get('docIds')
      if (docIds) {
        const parsedIds = docIds.split(',').filter(id => id.trim() !== '')
        if (parsedIds.length > 0) {
          // One-time hydration from sessionStorage on mount.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setDocumentIds(parsedIds)
        }
      }
    }
  }, [])
  
  const [previewDocument, setPreviewDocument] = useState<{
    id: string;
    url: string;
    fileName: string;
    fileType: string;
  } | null>(null)

  const showNotification = (message: string, type: 'error' | 'success' = 'error') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 5000)
  }

  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const handleDownload = async (id: string, fileName: string) => {
    try {
      const accessToken = await getAccessToken()
      if (!accessToken) return

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/documents/${id}/content`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!res.ok) {
        showNotification('Failed to download file', 'error');
        return;
      }
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      showNotification('Failed to download file', 'error');
    }
  }

  const handleView = async (id: string, fileName: string, fileType: string) => {
    try {
      const accessToken = await getAccessToken()
      if (!accessToken) return

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/documents/${id}/content`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!res.ok) {
        showNotification('File not found or cannot be viewed', 'error');
        return;
      }
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewDocument({ id, url, fileName, fileType });
    } catch (e) {
      showNotification('Failed to open file', 'error');
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, uploadStatus, isLoading])

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: input.trim() }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    let newConversationId = ''

    try {
      const accessToken = await getAccessToken()

      if (!accessToken) {
        throw new Error('Not authenticated')
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
          stream: true,
          conversationId: conversationId,
          documentIds: documentIds.length > 0 ? documentIds : undefined
        })
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`Failed to fetch response: ${res.status} ${errorText}`)
      }
      if (!res.body) throw new Error("No response body")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let done = false
      let buffer = ''
      const assistantId = (Date.now() + 1).toString()

      setMessages(prev => [...prev, {
        id: assistantId,
        role: 'assistant',
        content: '',
        citations: []
      }])

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        done = readerDone
        if (value) {
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() || ''

          for (const part of parts) {
            if (part.startsWith('data: ')) {
              const dataStr = part.slice(6)
              if (dataStr === '[DONE]') {
                done = true
                window.dispatchEvent(new Event('chat-created')) // Refetch sidebar now that DB insert is complete
                break
              }
              try {
                const parsed = JSON.parse(dataStr)
                if (parsed.type === 'meta') {
                  if (!conversationId) {
                    newConversationId = parsed.conversationId
                    setConversationId(parsed.conversationId)
                    window.dispatchEvent(new Event('chat-created'))
                  }
                } else if (parsed.type === 'citations') {
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId ? { ...m, citations: parsed.citations } : m
                  ))
                } else if (parsed.type === 'chunk') {
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId ? { ...m, content: m.content + parsed.content } : m
                  ))
                } else if (parsed.type === 'error') {
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId ? { ...m, content: m.content + '\n\n**Error:** ' + (parsed.message || 'Generation failed') } : m
                  ))
                }
              } catch (e) {
                console.error("Parse error", e)
              }
            }
          }
        }
      }

    } catch (error) {
      console.error(error)
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "An error occurred." }])
    } finally {
      setIsLoading(false)
      if (!initialConversationId && newConversationId) {
        router.replace(`/dashboard/chat/${newConversationId}`)
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const uploadFiles = async (files: File[]) => {
    setIsUploading(true)
    
    for (const file of files) {
      setUploadStatus({ file: file.name, status: 'uploading' })
      try {
        const accessToken = await getAccessToken()

        if (!accessToken) throw new Error('Not authenticated')

        const formData = new FormData()
        formData.append('file', file)

        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/documents/upload`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`
          },
          body: formData
        })

        if (!res.ok) throw new Error('Upload failed')
        
        const json = await res.json()
        if (json.data?.id) {
          setDocumentIds(prev => {
            if (!prev.includes(json.data.id)) return [...prev, json.data.id];
            return prev;
          });
        }

        setUploadStatus({ file: file.name, status: 'success' })
      } catch (error) {
        setUploadStatus({ file: file.name, status: 'error' })
      }
      
      // Brief pause between status updates to show each file
      await new Promise(r => setTimeout(r, 1000))
    }
    
    setUploadStatus(null)
    setIsUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const ALLOWED_EXTS = ['.txt', '.pdf', '.docx', '.html', '.md', '.png', '.jpg', '.jpeg'];

  const isValidFile = (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    return ALLOWED_EXTS.includes(ext);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      if (files.length > 5) {
        showNotification('For optimal performance, please upload a maximum of 5 documents at a time.', 'error');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      
      const validFiles = files.filter(isValidFile);
      if (validFiles.length !== files.length) {
        showNotification('Some files were ignored. Please only upload PDF, TXT, DOCX, HTML, MD, or Images.', 'error');
      }
      
      if (validFiles.length > 0) {
        await uploadFiles(validFiles);
      }
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    // Prevent flickering when dragging over child elements
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 5) {
        showNotification('For optimal performance, please upload a maximum of 5 documents at a time.', 'error');
        return;
      }
      
      const validFiles = files.filter(isValidFile);
      if (validFiles.length !== files.length) {
        showNotification('Some files were ignored. Please only upload PDF, TXT, DOCX, HTML, MD, or Images.', 'error');
      }
      
      if (validFiles.length > 0) {
        await uploadFiles(validFiles);
      }
    }
  }

  return (
    <div
      className="flex h-full w-full flex-col bg-background relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Top Notification System */}
      <div className="absolute top-16 md:top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center">
        {notification && (
          <div className={cn(
            "px-4 py-3 rounded-xl shadow-lg border text-sm font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-4",
            notification.type === 'error' ? "bg-red-500/10 border-red-500/20 text-red-500" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
          )}>
            {notification.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            {notification.message}
          </div>
        )}
        {documentIds.length > 0 && (
          <div className="px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium flex items-center gap-1.5 shadow-md">
            <FileText className="w-3.5 h-3.5" />
            Chatting with {documentIds.length} selected document{documentIds.length > 1 ? 's' : ''}
          </div>
        )}
      </div>
      {isDragging && (
        <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-blue-500 rounded-lg m-4 transition-all">
          <div className="flex size-16 items-center justify-center rounded-full bg-blue-500/20 text-blue-500 mb-4 pointer-events-none">
            <ArrowUp className="size-8" />
          </div>
          <h2 className="text-xl font-semibold pointer-events-none">Drop file here to upload</h2>
          <p className="text-sm text-muted-foreground mt-2 pointer-events-none">Supports PDF and TXT</p>
        </div>
      )}
      <div className="flex-1 overflow-y-auto no-scrollbar relative pt-[60px]">
        {messages.length > 0 && (
          <div className="mx-auto flex min-h-full min-w-0 max-w-3xl flex-col gap-6 px-4 py-8 pb-[200px]">
            {messages.map((m, index) => (
              <div key={m.id} className="w-full group/message">
                {m.role === 'user' ? (
                  <div className="flex flex-row justify-end gap-2">
                    <div className="text-[15px] leading-[1.65] bg-muted text-foreground px-5 py-2.5 rounded-3xl max-w-[80%] whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-4">
                    <div className="flex h-[calc(15px*1.65)] shrink-0 items-center">
                      <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
                        <Sparkles className="size-4" />
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="text-[15px] leading-[1.65] prose prose-invert prose-zinc max-w-none break-words">
                        {m.content ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {m.content}
                          </ReactMarkdown>
                        ) : isLoading && index === messages.length - 1 ? (
                          <div className="mt-1 flex h-4 items-center gap-1">
                            <div className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic">Empty response</span>
                        )}
                      </div>

                      {m.citations && m.citations.length > 0 && (
                        <div className="mt-2 w-[min(100%,500px)]">
                          <div className="border border-border/50 rounded-xl overflow-hidden bg-muted/30">
                            <div className="flex items-center px-4 py-2 border-b border-border/50 bg-muted/50">
                              <span className="text-xs font-medium text-muted-foreground">Sources</span>
                            </div>
                            <div className="p-2 space-y-1">
                              {Array.from(new Map(m.citations.map((c: Citation) => [c.documentId || c.fileName || c.documentTitle || c.document, c])).values()).map((c: Citation, i: number) => (
                                <div 
                                  key={i} 
                                  className="flex items-center gap-2 text-[13px] px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer text-foreground/80"
                                  onClick={() => c.documentId ? handleView(c.documentId, c.fileName || c.documentTitle || c.document || 'document', c.fileType || 'pdf') : showNotification('File cannot be previewed because it is from an older chat', 'error')}
                                >
                                  {c.fileType?.includes('image') ? <ImageIcon className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
                                  <span className="truncate flex-1">{c.fileName || c.documentTitle || c.document || 'Document'}</span>
                                  {c.score != null && <span className="text-muted-foreground text-[11px]">{(c.score * 100).toFixed(0)}%</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className={messages.length === 0
        ? "absolute inset-0 flex flex-col items-center justify-center px-4"
        : "absolute bottom-0 w-full left-0 right-0 z-50 px-4 pb-6 md:pb-8 flex justify-center pointer-events-none bg-gradient-to-t from-background via-background/90 to-transparent pt-10"
      }>
        <div className={`w-full max-w-3xl ${messages.length > 0 ? 'pointer-events-auto' : ''}`}>
          {messages.length === 0 && (
            <div className="text-center mb-8 pointer-events-none">
              <h2 className="text-[22px] font-normal text-zinc-100">Let&apos;s Chat with RAG Assistant</h2>
            </div>
          )}
          {uploadStatus && (
            <div className="mb-2 flex items-center justify-between gap-2 px-3 py-2 bg-card border border-border shadow-sm rounded-xl w-max">
              <div className="flex items-center gap-2 overflow-hidden">
                {uploadStatus.status === 'uploading' ? (
                  <Loader2 className="size-3.5 animate-spin text-blue-500 shrink-0" />
                ) : uploadStatus.status === 'success' ? (
                  <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />
                ) : (
                  <X className="size-3.5 text-red-500 shrink-0" />
                )}
                <span className="text-[12px] truncate text-muted-foreground font-medium max-w-[200px]">{uploadStatus.file}</span>
              </div>
            </div>
          )}

          <div className="relative flex w-full flex-col gap-4">
            <div className="relative">
              <div className="relative flex items-end rounded-[26px] border border-border/30 bg-card/70 shadow-[var(--shadow-composer)] transition-shadow duration-300 focus-within:shadow-[var(--shadow-composer-focus)] backdrop-blur-xl min-h-[52px] pr-2 pl-2 py-1.5">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  multiple
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/50 transition-colors disabled:opacity-50 mb-[1px]"
                >
                  <Plus className="size-6" />
                </button>

                <TextareaAutosize
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything"
                  className="w-full resize-none bg-transparent px-2 py-[8px] text-[15px] leading-relaxed placeholder:text-zinc-400 focus:outline-none max-h-[200px] overflow-y-auto no-scrollbar"
                  maxRows={8}
                  disabled={isLoading}
                />

                <div className="flex items-center gap-1.5 shrink-0 mb-[1px]">
                  <button
                    type="button"
                    className="flex size-9 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/50 transition-colors"
                  >
                    <Mic className="size-5" />
                  </button>

                  <button
                    onClick={(e) => handleSend(e as unknown as React.FormEvent)}
                    disabled={!input.trim() || isLoading}
                    className="flex size-9 items-center justify-center rounded-full bg-zinc-700 text-zinc-200 transition-transform hover:bg-zinc-600 hover:text-white active:scale-95 disabled:bg-muted disabled:text-muted-foreground/30 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <div className="size-2 rounded-sm bg-current animate-pulse" />
                    ) : (
                      <ArrowUp className="size-5" strokeWidth={2.5} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-center">
            <p className="text-[11px] text-muted-foreground">
              AI can make mistakes. Verify important information.
            </p>
          </div>
        </div>
      </div>

      {/* Document Preview Modal */}
      {previewDocument && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[200] flex flex-col p-4 md:p-8 animate-in fade-in duration-200">
          <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-t-xl p-4 shadow-xl">
            <div className="flex items-center gap-3 max-w-[70%]">
              <div className="w-8 h-8 rounded-lg bg-blue-900/20 border border-blue-800/40 flex items-center justify-center text-blue-500 shrink-0">
                {previewDocument.fileType.includes('image') ? <ImageIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
              </div>
              <h3 className="text-lg font-medium text-white truncate">{previewDocument.fileName}</h3>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => handleDownload(previewDocument.id, previewDocument.fileName)}
                className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-2"
                title="Download"
              >
                <Download className="w-5 h-5" />
                <span className="hidden sm:inline text-sm font-medium">Download</span>
              </button>
              <div className="w-px h-6 bg-zinc-800 mx-1" />
              <button 
                onClick={() => {
                  URL.revokeObjectURL(previewDocument.url);
                  setPreviewDocument(null);
                }}
                className="p-2 text-zinc-400 hover:text-white hover:bg-red-500/20 hover:text-red-400 rounded-lg transition-colors"
                title="Close"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
          <div className="flex-1 bg-zinc-950/50 border-x border-b border-zinc-800 rounded-b-xl overflow-hidden relative flex items-center justify-center">
            {previewDocument.fileType.includes('image') ? (
              <img src={previewDocument.url} alt={previewDocument.fileName} className="max-w-full max-h-full object-contain p-4" />
            ) : previewDocument.fileType === 'pdf' ? (
              <iframe src={`${previewDocument.url}#toolbar=0`} className="w-full h-full border-none bg-zinc-900 rounded-b-xl" />
            ) : (
              <iframe sandbox="" src={previewDocument.url} className="w-full h-full border-none bg-white rounded-b-xl" />
            )}
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-[150] animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className="bg-zinc-900 border border-zinc-700 shadow-2xl rounded-xl px-4 py-3 flex items-center gap-3 max-w-sm">
            {notification.type === 'error' ? (
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
            )}
            <span className="text-sm font-medium text-zinc-200">{notification.message}</span>
            <button onClick={() => setNotification(null)} className="text-zinc-500 hover:text-zinc-300 transition-colors ml-2 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
