'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { ChevronsUpDown, LogOut, User } from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'

/**
 * Account button for the sidebar footer: avatar icon + display name. Opens a small menu (upwards, since it
 * sits at the bottom) with the account details and the Log out action.
 */
export function ProfileMenu({ logoutAction }: { logoutAction: () => void }) {
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const name = session?.user?.name?.trim() || session?.user?.email?.split('@')[0] || 'Account'
  const email = session?.user?.email

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative flex items-center gap-1" data-keep-sidebar-open>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{name}</p>
            {email && <p className="truncate text-xs text-zinc-500">{email}</p>}
          </div>
          <div className="border-t border-zinc-200 p-1 dark:border-zinc-800">
            <form action={logoutAction}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <LogOut className="size-4" />
                Log out
              </button>
            </form>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-800"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          <User className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-200">{name}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-zinc-400" />
      </button>
      <ThemeToggle className="h-10 w-10 shrink-0" />
    </div>
  )
}
