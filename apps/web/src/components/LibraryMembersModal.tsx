'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Copy, Check, Trash2, LogOut, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { libraryApi, type Library, type Member, type Invite } from '@/lib/active-library'

const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 } as const
const ROLE_HINT: Record<Library['role'], string> = {
  owner: 'Full control, including deleting the library',
  admin: 'Manage members and documents',
  member: 'Upload documents and chat',
  viewer: 'Read and chat only',
}

function QuotaLine({ library }: { library: Library }) {
  const storageMb = library.storageBytes / (1024 * 1024)
  const docsRatio = library.documentCount / library.maxDocuments
  const storageRatio = storageMb / library.maxStorageMb
  const tone = (r: number) => (r >= 1 ? 'text-red-400' : r >= 0.9 ? 'text-amber-400' : 'text-zinc-500')
  return (
    <p className="text-xs mt-1.5 flex flex-wrap gap-x-4">
      <span className={tone(docsRatio)}>{library.documentCount} / {library.maxDocuments} documents</span>
      <span className={tone(storageRatio)}>{storageMb.toFixed(1)} / {library.maxStorageMb} MB</span>
    </p>
  )
}

export function LibraryMembersModal({
  library,
  onClose,
  onLeft,
}: {
  library: Library
  onClose: () => void
  onLeft: () => void
}) {
  const canManage = library.role === 'owner' || library.role === 'admin'
  const [members, setMembers] = useState<Member[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | undefined>()
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member')
  const [inviteDays, setInviteDays] = useState(7)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const m = await libraryApi<{ data: Member[]; currentUserId: string }>(`/${library.id}/members`)
      setMembers(m.data)
      setCurrentUserId(m.currentUserId)
      setLoading(false) // show members without waiting on the invite list
      if (canManage) {
        const i = await libraryApi<{ data: Invite[] }>(`/${library.id}/invites`)
        setInvites(i.data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [library.id, canManage])

  useEffect(() => {
    // Fetch-on-mount; state is only set after the awaited requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const inviteUrl = (code: string) => `${window.location.origin}/dashboard/join/${code}`

  const copy = async (invite: Invite) => {
    await navigator.clipboard.writeText(inviteUrl(invite.code))
    setCopied(invite.id)
    setTimeout(() => setCopied((c) => (c === invite.id ? null : c)), 1500)
  }

  const canChange = (target: Member) =>
    canManage && target.userId !== currentUserId && (library.role === 'owner' || ROLE_RANK[target.role] < ROLE_RANK.admin)

  // Portal to <body>: the sidebar has a CSS transform, which would otherwise trap
  // this `fixed` overlay inside the sidebar's box.
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[85vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-zinc-800">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">{library.name}</h2>
            <p className="text-sm text-zinc-500">Members &amp; invites · you are {library.role}</p>
            <QuotaLine library={library} />
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 p-1" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-6">
          {error && <div className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">{error}</div>}

          <section>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Members ({members.length})</h3>
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
            ) : (
              <ul className="divide-y divide-zinc-800/70 border border-zinc-800 rounded-lg">
                {members.map((m) => (
                  <li key={m.userId} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-zinc-200 truncate">
                        {m.fullName || m.email}
                        {m.userId === currentUserId && <span className="ml-2 text-xs text-zinc-500">(you)</span>}
                      </div>
                      <div className="text-xs text-zinc-500 truncate">{m.email} · {m.documentCount} {m.documentCount === 1 ? 'upload' : 'uploads'}</div>
                    </div>
                    {canChange(m) ? (
                      <select
                        value={m.role}
                        onChange={(e) => run(() => libraryApi(`/${library.id}/members/${m.userId}`, { method: 'PATCH', body: JSON.stringify({ role: e.target.value }) }))}
                        className="bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 rounded-md px-2 py-1"
                      >
                        {library.role === 'owner' && <option value="owner">owner</option>}
                        {library.role === 'owner' && <option value="admin">admin</option>}
                        <option value="member">member</option>
                        <option value="viewer">viewer</option>
                      </select>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400">{m.role}</span>
                    )}
                    {canChange(m) && (
                      <button
                        title="Remove member"
                        onClick={() => confirm(`Remove ${m.fullName || m.email}?`) && run(() => libraryApi(`/${library.id}/members/${m.userId}`, { method: 'DELETE' }))}
                        className="p-1.5 text-zinc-500 hover:text-red-400"
                      ><Trash2 className="w-4 h-4" /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canManage && (
            <section>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Invite people</h3>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-zinc-500">Role
                  <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)} className="mt-1 block bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 rounded-md px-2 py-1.5">
                    {library.role === 'owner' && <option value="admin">admin</option>}
                    <option value="member">member</option>
                    <option value="viewer">viewer</option>
                  </select>
                </label>
                <label className="text-xs text-zinc-500">Expires
                  <select value={inviteDays} onChange={(e) => setInviteDays(Number(e.target.value))} className="mt-1 block bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 rounded-md px-2 py-1.5">
                    <option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option>
                  </select>
                </label>
                <Button
                  disabled={creating}
                  onClick={async () => {
                    setCreating(true)
                    await run(() => libraryApi(`/${library.id}/invites`, { method: 'POST', body: JSON.stringify({ role: inviteRole, expiresInDays: inviteDays }) }))
                    setCreating(false)
                  }}
                  className="h-8"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Link2 className="w-4 h-4 mr-1.5" />Create link</>}
                </Button>
              </div>
              <p className="text-xs text-zinc-600 mt-1.5">{ROLE_HINT[inviteRole]}</p>

              {invites.length > 0 && (
                <ul className="mt-3 divide-y divide-zinc-800/70 border border-zinc-800 rounded-lg">
                  {invites.map((inv) => (
                    <li key={inv.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-mono text-zinc-400 truncate">…/join/{inv.code.slice(0, 10)}…</div>
                        <div className="text-xs text-zinc-600">
                          {inv.role} · {inv.useCount} used{inv.maxUses ? `/${inv.maxUses}` : ''}
                          {inv.expiresAt ? ` · expires ${new Date(inv.expiresAt).toLocaleDateString()}` : ''}
                        </div>
                      </div>
                      <button onClick={() => copy(inv)} className="p-1.5 text-zinc-400 hover:text-zinc-100" title="Copy invite link">
                        {copied === inv.id ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                      <button onClick={() => run(() => libraryApi(`/${library.id}/invites/${inv.id}`, { method: 'DELETE' }))} className="p-1.5 text-zinc-500 hover:text-red-400" title="Revoke">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800">
            <Button
              variant="outline"
              className="border-zinc-700 text-zinc-300"
              onClick={async () => {
                if (!currentUserId || !confirm(`Leave "${library.name}"?`)) return
                try {
                  await libraryApi(`/${library.id}/members/${currentUserId}`, { method: 'DELETE' })
                  onLeft()
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not leave')
                }
              }}
            ><LogOut className="w-4 h-4 mr-1.5" />Leave library</Button>
            {library.role === 'owner' && (
              <Button
                variant="outline"
                className="border-red-900/60 text-red-400 hover:bg-red-950/40"
                onClick={async () => {
                  if (!confirm(`Delete "${library.name}" for everyone? Its documents become inaccessible.`)) return
                  try {
                    await libraryApi(`/${library.id}`, { method: 'DELETE' })
                    onLeft()
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not delete')
                  }
                }}
              ><Trash2 className="w-4 h-4 mr-1.5" />Delete library</Button>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
