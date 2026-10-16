export function ChatAreaSkeleton() {
  return (
    <div className="flex flex-col h-full bg-white dark:bg-black text-zinc-900 dark:text-zinc-100">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full min-w-0 max-w-3xl flex-col gap-6 px-4 py-8 pb-[200px]">
          
          {/* Skeleton User Message */}
          <div className="w-full">
            <div className="flex flex-row justify-end gap-2">
              <div className="bg-zinc-200/50 dark:bg-zinc-800/50 px-5 py-2.5 rounded-3xl w-64 h-[44px] animate-pulse" />
            </div>
          </div>

          {/* Skeleton AI Message */}
          <div className="w-full">
            <div className="flex items-start gap-4">
              <div className="flex shrink-0 items-center mt-1">
                <div className="size-7 rounded-lg bg-zinc-200/50 dark:bg-zinc-800/50 animate-pulse" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
                <div className="h-4 bg-zinc-200/50 dark:bg-zinc-800/50 rounded animate-pulse w-full max-w-[90%]" />
                <div className="h-4 bg-zinc-200/50 dark:bg-zinc-800/50 rounded animate-pulse w-full max-w-[85%]" />
                <div className="h-4 bg-zinc-200/50 dark:bg-zinc-800/50 rounded animate-pulse w-full max-w-[60%]" />
                
                {/* Skeleton Citations Block */}
                <div className="mt-4 w-[min(100%,500px)]">
                  <div className="border border-zinc-200/50 dark:border-zinc-800/50 rounded-xl overflow-hidden bg-zinc-100/30 dark:bg-zinc-900/30">
                    <div className="flex items-center px-4 py-3 border-b border-zinc-200/50 dark:border-zinc-800/50 bg-zinc-200/20 dark:bg-zinc-800/20">
                      <div className="h-3 w-24 bg-zinc-200/50 dark:bg-zinc-800/50 rounded animate-pulse" />
                    </div>
                    <div className="p-2 space-y-2">
                      <div className="flex items-center gap-3 px-3 py-2">
                        <div className="size-4 rounded bg-zinc-200/50 dark:bg-zinc-800/50 animate-pulse shrink-0" />
                        <div className="h-3 bg-zinc-200/50 dark:bg-zinc-800/50 rounded animate-pulse flex-1" />
                        <div className="w-8 h-3 bg-zinc-200/50 dark:bg-zinc-800/50 rounded animate-pulse shrink-0" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
        </div>
      </div>

      {/* Skeleton Input Box */}
      <div className="absolute bottom-0 w-full left-0 right-0 z-50 px-4 pb-6 md:pb-8 flex justify-center pointer-events-none bg-gradient-to-t from-black via-black/90 to-transparent pt-10">
        <div className="w-full max-w-3xl pointer-events-auto">
          <div className="relative flex items-end rounded-[26px] border border-zinc-200/50 dark:border-zinc-800/50 bg-zinc-100 dark:bg-zinc-900 shadow-xl min-h-[52px] pr-2 pl-2 py-1.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full mb-[1px]">
              <div className="size-6 rounded-md bg-zinc-200/50 dark:bg-zinc-800/50 animate-pulse" />
            </div>
            
            <div className="w-full px-2 py-[8px]">
              <div className="h-5 w-32 bg-zinc-200/50 dark:bg-zinc-800/50 rounded animate-pulse" />
            </div>

            <div className="flex items-center gap-1.5 shrink-0 mb-[1px]">
              <div className="flex size-9 items-center justify-center rounded-full">
                <div className="size-5 rounded-md bg-zinc-200/50 dark:bg-zinc-800/50 animate-pulse" />
              </div>
              <div className="flex size-9 items-center justify-center rounded-full bg-zinc-200/50 dark:bg-zinc-800/50 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
