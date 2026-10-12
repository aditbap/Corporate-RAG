'use client'

import { useEffect, useState } from 'react'
import { ChevronsUpDown, Check, Plus, Users, UserPlus, Loader2, User } from 'lucide-react'
import {
  getActiveLibraryId, setActiveLibraryId, libraryApi, hardNavigate, type Library,
} from '@/lib/active-library'
import { LibraryMembersModal } from '@/components/LibraryMembersModal'

/** Sidebar control for choosing which library (personal or shared) the app is working in. */
export function LibrarySwitcher() {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [mode, setMode] = useState<'list' | 'create' | 'join'>('list')
  const [text, setText] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const switchTo = (id: string | null) => {
    setActiveLibraryId(id)
    // Full reload so every page re-fetches under the new library.
    hardNavigate('/dashboard/library')
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await libraryApi<{ data: Library[] }>('')
        if (cancelled) return
        setLibraries(res.data)
        const active = getActiveLibraryId()
        // Stale selection (left/deleted library): fall back to personal.
        if (active && !res.data.some((l) => l.id === active)) switchTo(null)
      } catch {
        /* sidebar still works against the personal workspace */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const personal = libraries.find((l) => l.kind === 'personal')
  const activeId = getActiveLibraryId()
  const active = libraries.find((l) => l.id === activeId) ?? personal

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'create') {
        const res = await libraryApi<{ data: Library }>('', { method: 'POST', body: JSON.stringify({ name: text, description: description || undefined }) })
        switchTo(res.data.id)
      } else {
        // Accept either a bare code or a full invite link.
        const code = text.trim().split('/').filter(Boolean).pop() ?? ''
        const res = await libraryApi<{ data: { libraryId: string } }>('/join', { method: 'POST', body: JSON.stringify({ code }) })
        switchTo(res.data.libraryId)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
      setBusy(false)
    }
  }

  return (
    <div data-keep-sidebar-open className="pl-3 pr-12 md:pr-3 pb-3 relative">
      <button
        onClick={() => { setOpen(!open); setMode('list'); setError(null) }}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800 hover:bg-zinc-800/60 text-left"
      >
        {active?.kind === 'shared' ? <Users className="w-4 h-4 text-blue-400 shrink-0" /> : <User className="w-4 h-4 text-zinc-400 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm text-zinc-100 truncate">{loading ? 'Loading…' : active?.kind === 'personal' || !active ? 'Personal' : active.name}</div>
          {active?.kind === 'shared' && <div className="text-[11px] text-zinc-500">{active.memberCount} members · {active.role}</div>}
        </div>
        <ChevronsUpDown className="w-4 h-4 text-zinc-500 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-zinc-950 border border-zinc-800 rounded-lg shadow-xl p-1.5">
          {mode === 'list' ? (
            <>
              {libraries.map((l) => (
                <button key={l.id} onClick={() => switchTo(l.kind === 'personal' ? null : l.id)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-zinc-800/70 text-left">
                  {l.kind === 'shared' ? <Users className="w-4 h-4 text-blue-400" /> : <User className="w-4 h-4 text-zinc-400" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-zinc-200 truncate">{l.kind === 'personal' ? 'Personal' : l.name}</span>
                    <span className="block text-[11px] text-zinc-500">{l.documentCount} docs{l.kind === 'shared' ? ` · ${l.memberCount} members` : ''}</span>
                  </span>
                  {l.id === active?.id && <Check className="w-4 h-4 text-zinc-300" />}
                </button>
              ))}
              <div className="my-1 border-t border-zinc-800" />
              {active?.kind === 'shared' && (
                <button onClick={() => { setOpen(false); setShowMembers(true) }} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-zinc-800/70 text-sm text-zinc-300">
                  <UserPlus className="w-4 h-4" />Members &amp; invites
                </button>
              )}
              <button onClick={() => { setMode('create'); setText('') }} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-zinc-800/70 text-sm text-zinc-300">
                <Plus className="w-4 h-4" />New shared library
              </button>
              <button onClick={() => { setMode('join'); setText('') }} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-zinc-800/70 text-sm text-zinc-300">
                <Users className="w-4 h-4" />Join with invite
              </button>
            </>
          ) : (
            <div className="p-1.5 space-y-2">
              <div className="text-xs font-medium text-zinc-400">{mode === 'create' ? 'New shared library' : 'Join a shared library'}</div>
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && text.trim() && !busy && submit()}
                placeholder={mode === 'create' ? 'Library name' : 'Paste invite link or code'}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
              />
              {mode === 'create' && (
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
                />
              )}
              {error && <div className="text-xs text-red-400">{error}</div>}
              <div className="flex gap-2">
                <button onClick={() => setMode('list')} className="flex-1 text-sm text-zinc-400 hover:text-zinc-200 py-1.5">Back</button>
                <button disabled={busy || !text.trim()} onClick={submit} className="flex-1 text-sm bg-zinc-100 text-zinc-900 rounded-md py-1.5 disabled:opacity-50 flex items-center justify-center">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'create' ? 'Create' : 'Join'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showMembers && active?.kind === 'shared' && (
        <LibraryMembersModal
          library={active}
          onClose={() => setShowMembers(false)}
          onLeft={() => switchTo(null)}
        />
      )}
    </div>
  )
}
