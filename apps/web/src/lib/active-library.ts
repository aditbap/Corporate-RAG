'use client'

import { useEffect, useState } from 'react'
import { getAccessToken } from '@/lib/auth-client'

const STORAGE_KEY = 'rag.activeLibraryId'
const API_URL = process.env.NEXT_PUBLIC_API_URL

export function getActiveLibraryId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Full-page navigation (not client-side routing) — used when the active library changes so every
 * page, cache and in-flight request restarts under the new library.
 */
export function hardNavigate(path: string) {
  window.location.assign(new URL(path, window.location.origin).href)
}

/** `null` selects the user's personal workspace (the API's default). */
export function setActiveLibraryId(id: string | null) {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage unavailable (private mode) — selection just won't persist */
  }
}

/**
 * Every call the dashboard makes to apps/api goes through the global `fetch`.
 * Rather than threading the selected library through each call site, patch
 * `fetch` once so requests to the API carry `X-Org-Id` for the active library.
 * The API treats the header as a request only and checks membership server-side,
 * so a tampered localStorage value can't reach another library's data.
 */
function installLibraryHeader() {
  if (typeof window === 'undefined' || !API_URL) return
  const w = window as typeof window & { __ragLibraryFetch?: boolean }
  if (w.__ragLibraryFetch) return
  w.__ragLibraryFetch = true

  const originalFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const libraryId = getActiveLibraryId()
    if (libraryId && url.startsWith(API_URL)) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      if (!headers.has('X-Org-Id')) headers.set('X-Org-Id', libraryId)
      return originalFetch(input, { ...init, headers })
    }
    return originalFetch(input, init)
  }
}

installLibraryHeader()

/** JSON helper for the /libraries endpoints. Throws Error(message) on non-2xx. */
export async function libraryApi<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken()
  if (!token) throw new Error('Not signed in')
  const res = await fetch(`${API_URL}/libraries${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      // Library-management calls name their target in the path, not the header.
      'X-Org-Id': '',
      ...init.headers,
    },
  })
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`)
  return body as T
}

export interface Library {
  id: string
  name: string
  description: string | null
  kind: 'personal' | 'shared'
  role: 'owner' | 'admin' | 'member' | 'viewer'
  memberCount: number
  documentCount: number
  storageBytes: number
  maxDocuments: number
  maxStorageMb: number
}

export interface Member {
  userId: string
  email: string
  fullName: string | null
  role: Library['role']
  joinedAt: string
  documentCount: number
}

export interface Invite {
  id: string
  code: string
  role: Library['role']
  expiresAt: string | null
  maxUses: number | null
  useCount: number
}

export interface LibraryAccess {
  /** False until the library list has loaded; controls stay hidden (fail closed) until then. */
  loaded: boolean
  role: Library['role'] | null
  userId: string | null
  canUpload: boolean
  canManageFolders: boolean
  /** Admins/owners can change any document; members only the ones they uploaded. */
  canMutateDoc: (uploadedBy?: string | null) => boolean
}

let accessPromise: Promise<{ libraries: Library[]; userId: string }> | null = null

/**
 * The caller's role in the active library, for hiding actions they can't perform.
 * This is only UX — apps/api enforces the same rules (see packages/auth/src/rbac.ts) and
 * returns 403 regardless of what the UI shows.
 */
export function useLibraryAccess(): LibraryAccess {
  const [state, setState] = useState<{ role: Library['role']; userId: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    accessPromise ??= libraryApi<{ data: Library[]; currentUserId: string }>('').then((r) => ({ libraries: r.data, userId: r.currentUserId }))
    accessPromise
      .then(({ libraries, userId }) => {
        if (cancelled) return
        const activeId = getActiveLibraryId()
        const active = libraries.find((l) => l.id === activeId) ?? libraries.find((l) => l.kind === 'personal')
        setState({ role: active?.role ?? 'owner', userId })
      })
      .catch(() => {
        accessPromise = null // retry on the next mount
      })
    return () => {
      cancelled = true
    }
  }, [])

  const role = state?.role ?? null
  const isAdmin = role === 'owner' || role === 'admin'
  return {
    loaded: state !== null,
    role,
    userId: state?.userId ?? null,
    canUpload: role !== null && role !== 'viewer',
    canManageFolders: isAdmin,
    canMutateDoc: (uploadedBy) => isAdmin || (role === 'member' && !!uploadedBy && uploadedBy === state?.userId),
  }
}

/** Best-effort message from an apps/api error response ({ error: { message } }). */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null)
  return body?.error?.message ?? fallback
}
