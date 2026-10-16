'use client'

import { use, useEffect, useState } from 'react'
import { Loader2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { libraryApi, setActiveLibraryId, hardNavigate } from '@/lib/active-library'

interface Preview { libraryId: string; name: string; description: string | null; role: string; usable: boolean }

export default function JoinLibraryPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    libraryApi<{ data: Preview }>(`/join/${encodeURIComponent(code)}`)
      .then((r) => setPreview(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Invite not found'))
  }, [code])

  const join = async () => {
    setJoining(true)
    try {
      const res = await libraryApi<{ data: { libraryId: string } }>('/join', { method: 'POST', body: JSON.stringify({ code }) })
      setActiveLibraryId(res.data.libraryId)
      hardNavigate('/dashboard/library')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join')
      setJoining(false)
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 text-center space-y-4">
        {!preview && !error && <Loader2 className="w-6 h-6 animate-spin text-zinc-500 mx-auto" />}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {preview && (
          <>
            <Users className="w-8 h-8 text-blue-400 mx-auto" />
            <div>
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{preview.name}</h1>
              {preview.description && <p className="text-sm text-zinc-500 mt-1">{preview.description}</p>}
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">You&apos;ve been invited as <span className="text-zinc-800 dark:text-zinc-200 font-medium">{preview.role}</span>.</p>
            {preview.usable ? (
              <Button onClick={join} disabled={joining} className="w-full">{joining ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Join library'}</Button>
            ) : (
              <p className="text-sm text-amber-400">This invite has expired or reached its limit. Ask for a new link.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
