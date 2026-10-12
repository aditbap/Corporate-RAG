'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken } from '@/lib/auth-client'
import { useLibraryAccess } from '@/lib/active-library'
import { 
  Loader2, FileText, Trash2, File, UploadCloud, Search, 
  ChevronDown, Filter, LayoutGrid, List, MoreHorizontal, 
  Image as ImageIcon, Check, MessageSquare, Download, FolderOutput, Edit2, Minus,
  FolderPlus, Upload, Folder, X, AlertCircle, Eye
} from 'lucide-react'

interface Document {
  id: string
  title: string
  fileName: string
  fileType: string
  fileSizeBytes: number
  status: string
  createdAt: string
  notes: string | null
  uploadedBy?: string | null
  uploaderName?: string | null
  uploaderEmail?: string | null
}

interface FolderType {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}

export default function LibraryPage() {
  const router = useRouter()
  const access = useLibraryAccess()
  const [documents, setDocuments] = useState<Document[]>([])
  const [folders, setFolders] = useState<FolderType[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [folderPath, setFolderPath] = useState<{ id: string, name: string }[]>([])
  
  const [loading, setLoading] = useState(true)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'All' | 'Images' | 'Documents'>('All')

  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set())
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)
  const [isNewDropdownOpen, setIsNewDropdownOpen] = useState(false)

  // Modal states
  const [isAddNoteModalOpen, setIsAddNoteModalOpen] = useState(false)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = useState(false)
  const [uploaderFilter, setUploaderFilter] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ id: string; isFolder: boolean } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [createFolderName, setCreateFolderName] = useState('')
  
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false)
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null) // null means moving selectedDocs
  const [allFolders, setAllFolders] = useState<FolderType[]>([])
  const [selectedDestinationFolder, setSelectedDestinationFolder] = useState<string | null>(null)
  
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    type: 'single' | 'bulk';
    id?: string;
    isFolder?: boolean;
  }>({ isOpen: false, type: 'single' })

  const [previewDocument, setPreviewDocument] = useState<{
    id: string;
    url: string;
    fileName: string;
    fileType: string;
    notes: string | null;
  } | null>(null)

  const [notification, setNotification] = useState<{message: string, type: 'error' | 'success'} | null>(null)

  const showNotification = (message: string, type: 'error' | 'success' = 'error') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 5000)
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchContent = async () => {
    try {
      setLoading(true)
      const accessToken = await getAccessToken()
      if (!accessToken) return

      const folderQuery = currentFolderId ? `?parentId=${currentFolderId}` : '?parentId=null'
      const docQuery = currentFolderId ? `?folderId=${currentFolderId}` : '?folderId=null'

      const [docsRes, foldersRes] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/documents/${docQuery}`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/folders/${folderQuery}`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })
      ])

      if (docsRes.ok && foldersRes.ok) {
        const docsData = await docsRes.json()
        const foldersData = await foldersRes.json()
        setDocuments(docsData.data || [])
        setFolders(foldersData.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch content:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAllFoldersForMove = async () => {
    try {
      const accessToken = await getAccessToken()
      if (!accessToken) return
      
      // Fetching root folders for move destination as a simple approach
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/folders?parentId=null`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      })
      if (res.ok) {
        const data = await res.json()
        setAllFolders(data.data || [])
      }
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    // Fetch-on-folder-change: fetchContent toggles its own loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContent()
    setSelectedDocs(new Set())
    // fetchContent is recreated every render; the fetch must only re-run when the folder changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderId])

  useEffect(() => {
    const closeDropdown = () => {
      setActiveDropdown(null)
      setIsNewDropdownOpen(false)
    }
    window.addEventListener('click', closeDropdown)
    return () => window.removeEventListener('click', closeDropdown)
  }, [])

  const openRename = (id: string, currentName: string, isFolder: boolean) => {
    setRenameTarget({ id, isFolder })
    setRenameValue(currentName)
  }

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return
    try {
      const accessToken = await getAccessToken()
      const path = renameTarget.isFolder ? `folders/${renameTarget.id}` : `documents/${renameTarget.id}`
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/${path}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error?.message || 'Rename failed')
      }
      setRenameTarget(null)
      showNotification('Renamed', 'success')
      fetchContent()
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Rename failed', 'error')
    }
  }

  const handleCreateFolder = async () => {
    if (!createFolderName.trim()) return
    try {
      const accessToken = await getAccessToken()
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/folders`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: createFolderName, parentId: currentFolderId })
      })
      if (res.ok) {
        setCreateFolderName('')
        setIsCreateFolderModalOpen(false)
        fetchContent()
      } else {
        const data = await res.json().catch(() => null)
        showNotification(data?.error?.message || 'Could not create folder', 'error')
      }
    } catch (e) {
      console.error(e)
      showNotification('Could not create folder', 'error')
    }
  }

  const handleMove = async () => {
    try {
      const accessToken = await getAccessToken()
      if (!accessToken) return

      const docsToMove = moveTargetId ? [moveTargetId] : Array.from(selectedDocs)
      
      for (const id of docsToMove) {
        await fetch(`${process.env.NEXT_PUBLIC_API_URL}/documents/${id}/move`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ folderId: selectedDestinationFolder })
        })
      }
      
      setIsMoveModalOpen(false)
      setMoveTargetId(null)
      setSelectedDocs(new Set())
      fetchContent()
    } catch (e) {
      console.error(e)
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
      const doc = documents.find(d => d.id === id);
      setPreviewDocument({ id, url, fileName, fileType, notes: doc?.notes || null });
    } catch {
      showNotification('Failed to open file', 'error');
    }
  }

  // One download per selected document, spaced out so the browser doesn't drop them.
  const handleBulkDownload = async () => {
    const chosen = documents.filter((d) => selectedDocs.has(d.id))
    if (chosen.length === 0) return
    if (chosen.length > 1) showNotification(`Downloading ${chosen.length} files…`, 'success')
    for (const doc of chosen) {
      await handleDownload(doc.id, doc.fileName)
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  const handleDownload = async (id: string, fileName: string) => {
    try {
      const accessToken = await getAccessToken()
      if (!accessToken) return
      
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/documents/${id}/content`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      if (!res.ok) {
        showNotification('File not found', 'error');
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
    } catch {
      showNotification('Failed to download file', 'error');
    }
  }

  const executeDelete = async (id: string, isFolder: boolean = false) => {
    try {
      const accessToken = await getAccessToken()
      if (!accessToken) return

      const endpoint = isFolder ? `/folders/${id}` : `/documents/${id}`
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${endpoint}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message || 'Failed to delete');
      }
    } catch (error) {
      console.error('Failed to delete:', error)
      throw error;
    }
  }

  const handleConfirmDelete = async () => {
    try {
      if (deleteConfirm.type === 'bulk') {
        const count = selectedDocs.size;
        for (const id of Array.from(selectedDocs)) {
          await executeDelete(id, false)
        }
        setSelectedDocs(new Set())
        showNotification(`Deleted ${count} documents`, 'success')
      } else if (deleteConfirm.id) {
        await executeDelete(deleteConfirm.id, deleteConfirm.isFolder)
        showNotification(`Deleted ${deleteConfirm.isFolder ? 'folder' : 'document'}`, 'success')
      }
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Failed to delete', 'error')
    } finally {
      setDeleteConfirm({ isOpen: false, type: 'single' })
      fetchContent()
    }
  }

  const uploadFiles = async (files: globalThis.File[]) => {
    setIsUploading(true)
    
    try {
      const accessToken = await getAccessToken()
      if (!accessToken) throw new Error('Not authenticated')

      // Upload files sequentially to prevent overwhelming the server
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        if (currentFolderId) {
          formData.append('folderId', currentFolderId)
        }
        
        await fetch(`${process.env.NEXT_PUBLIC_API_URL}/documents/upload`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`
          },
          body: formData
        })
      }
      
      await fetchContent()
      showNotification('Files uploaded successfully', 'success')
    } catch {
      showNotification('One or more uploads failed', 'error')
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleCreateNote = async () => {
    if (!noteContent.trim()) return
    const title = noteTitle.trim() || 'Untitled Note'
    const blob = new Blob([noteContent], { type: 'text/plain' })
    const file = new globalThis.File([blob], `${title}.txt`, { type: 'text/plain' })
    
    setIsAddNoteModalOpen(false)
    setNoteTitle('')
    setNoteContent('')
    
    await uploadFiles([file])
  }

  const ALLOWED_EXTS = ['.txt', '.pdf', '.docx', '.html', '.md', '.png', '.jpg', '.jpeg'];
  
  const isValidFile = (file: globalThis.File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    return ALLOWED_EXTS.includes(ext);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      if (files.length > 5) {
        showNotification('For optimal performance, please upload a maximum of 5 documents at a time.', 'error');
        if (fileInputRef.current) fileInputRef.current.value = ''
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
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (!access.canUpload) return
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

  const toggleSelection = (id: string) => {
    setSelectedDocs(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Move/Delete are offered in bulk only when every selected document is one the user may change.
  const selectedMutable = selectedDocs.size > 0 && Array.from(selectedDocs).every((id) => access.canMutateDoc(documents.find((d) => d.id === id)?.uploadedBy))

  // Distinct uploaders in the current view, for the "Uploaded by" filter (shared libraries).
  const uploaders = Array.from(
    new Map(
      documents
        .filter((d) => d.uploadedBy)
        .map((d) => [d.uploadedBy as string, d.uploaderName || d.uploaderEmail || 'Unknown'] as const),
    ),
  ).map(([id, label]) => ({ id, label }))

  const filteredDocuments = documents.filter(doc => {
    if (uploaderFilter && doc.uploadedBy !== uploaderFilter) return false;
    if (activeTab === 'Images' && !doc.fileType.includes('image')) return false;
    if (activeTab === 'Documents' && doc.fileType.includes('image')) return false;
    if (searchQuery && !doc.fileName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const filteredFolders = folders.filter(folder => {
    if (searchQuery && !folder.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const toggleAll = () => {
    if (selectedDocs.size === filteredDocuments.length && filteredDocuments.length > 0) {
      setSelectedDocs(new Set())
    } else {
      setSelectedDocs(new Set(filteredDocuments.map(d => d.id)))
    }
  }

  const isAllSelected = filteredDocuments.length > 0 && selectedDocs.size === filteredDocuments.length
  const isPartiallySelected = selectedDocs.size > 0 && selectedDocs.size < filteredDocuments.length

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const currentYear = new Date().getFullYear()
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    if (date.getFullYear() !== currentYear) {
      opts.year = 'numeric'
    }
    return date.toLocaleDateString(undefined, opts)
  }

  const openMoveModal = (targetId: string | null = null) => {
    setMoveTargetId(targetId)
    setSelectedDestinationFolder(null)
    setIsMoveModalOpen(true)
    fetchAllFoldersForMove()
  }

  return (
    <div 
      className="flex flex-col h-full bg-black text-zinc-100 relative overflow-hidden font-sans"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm border-2 border-dashed border-blue-500 rounded-lg m-4 transition-all">
          <div className="flex size-16 items-center justify-center rounded-full bg-blue-500/20 text-blue-500 mb-4 pointer-events-none">
            <UploadCloud className="size-8" />
          </div>
          <h2 className="text-xl font-semibold pointer-events-none">Drop file to upload</h2>
        </div>
      )}

      {/* Create Folder Modal */}
      {isCreateFolderModalOpen && (
        <div className="absolute inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold">New Folder</h2>
              <button onClick={() => setIsCreateFolderModalOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <input 
              type="text" 
              placeholder="Folder name" 
              value={createFolderName}
              onChange={(e) => setCreateFolderName(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-700 transition-colors mb-6"
              autoFocus
            />
            
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setIsCreateFolderModalOpen(false)}
                className="px-4 py-2 text-sm font-medium hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateFolder}
                disabled={!createFolderName.trim() || isUploading}
                className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Note Modal */}
      {renameTarget && (
        <div className="absolute inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4" onClick={() => setRenameTarget(null)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold">Rename {renameTarget.isFolder ? 'folder' : 'document'}</h2>
              <button onClick={() => setRenameTarget(null)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <input
              type="text"
              aria-label="New name"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRename() }}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-700 transition-colors mb-6"
              autoFocus
            />

            <div className="flex justify-end gap-3">
              <button onClick={() => setRenameTarget(null)} className="px-4 py-2 text-sm font-medium hover:bg-zinc-800 rounded-lg transition-colors">
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={!renameValue.trim()}
                className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {isAddNoteModalOpen && (
        <div className="absolute inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6 shrink-0">
              <h2 className="text-lg font-semibold">New Note</h2>
              <button onClick={() => setIsAddNoteModalOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex flex-col gap-4 overflow-y-auto no-scrollbar pb-2">
              <input 
                type="text" 
                placeholder="Note title (optional)" 
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-700 transition-colors"
                autoFocus
              />
              
              <textarea 
                placeholder="Write your note here..." 
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-700 transition-colors min-h-[200px] resize-y"
              />
            </div>
            
            <div className="flex justify-end gap-3 mt-6 shrink-0">
              <button 
                onClick={() => setIsAddNoteModalOpen(false)}
                className="px-4 py-2 text-sm font-medium hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateNote}
                disabled={!noteContent.trim() || isUploading}
                className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {isUploading ? 'Saving...' : 'Save Note'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move Modal */}
      {isMoveModalOpen && (
        <div className="absolute inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h2 className="text-lg font-semibold">Move {moveTargetId ? '1 item' : `${selectedDocs.size} items`}</h2>
              <button onClick={() => setIsMoveModalOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 mb-6 space-y-2">
              <div 
                onClick={() => setSelectedDestinationFolder(null)}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${selectedDestinationFolder === null ? 'bg-blue-500/10 border border-blue-500/30' : 'hover:bg-zinc-800 border border-transparent'}`}
              >
                <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400">
                  <LayoutGrid className="w-4 h-4" />
                </div>
                <span className="font-medium text-sm">Library Root</span>
              </div>
              
              {allFolders.map(folder => (
                <div 
                  key={folder.id}
                  onClick={() => setSelectedDestinationFolder(folder.id)}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${selectedDestinationFolder === folder.id ? 'bg-blue-500/10 border border-blue-500/30' : 'hover:bg-zinc-800 border border-transparent'}`}
                >
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400">
                    <Folder className="w-4 h-4" />
                  </div>
                  <span className="font-medium text-sm">{folder.name}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 shrink-0">
              <button 
                onClick={() => setIsMoveModalOpen(false)}
                className="px-4 py-2 text-sm font-medium hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleMove}
                className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-zinc-200 transition-colors"
              >
                Move Here
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="px-8 py-8 md:px-24 md:py-16 flex flex-col h-full max-w-6xl mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 -mb-1 max-w-[60%]">
            <button 
              onClick={() => {
                setCurrentFolderId(null);
                setFolderPath([]);
              }}
              className={`text-[28px] font-medium tracking-tight whitespace-nowrap transition-colors ${currentFolderId ? 'text-zinc-400 hover:text-zinc-200 cursor-pointer' : 'text-white'}`}
            >
              Library
            </button>
            
            {folderPath.map((crumb, index) => (
              <div key={crumb.id} className="flex items-center gap-2 shrink-0">
                <span className="text-zinc-600 text-[28px] font-light">/</span>
                <button
                  onClick={() => {
                    const newPath = folderPath.slice(0, index + 1);
                    setCurrentFolderId(newPath[newPath.length - 1].id);
                    setFolderPath(newPath);
                  }}
                  className={`text-[28px] font-medium tracking-tight whitespace-nowrap transition-colors ${index === folderPath.length - 1 ? 'text-white' : 'text-zinc-400 hover:text-zinc-200 cursor-pointer'}`}
                >
                  {crumb.name}
                </button>
              </div>
            ))}
          </div>
          
          <div className="flex items-center gap-3 shrink-0">
            <div className="relative group">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-zinc-200" />
              <input 
                type="text" 
                placeholder="Search" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 h-10 bg-zinc-800/60 hover:bg-zinc-800 focus:bg-zinc-800 focus:outline-none rounded-full pl-9 pr-4 text-sm transition-colors border border-transparent focus:border-zinc-700"
              />
            </div>
            
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              multiple
            />
            
            {access.canUpload && <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsNewDropdownOpen(!isNewDropdownOpen)
                }}
                disabled={isUploading}
                className="flex items-center gap-1.5 h-10 px-4 bg-white text-black text-sm font-medium rounded-full hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'New'}
                {!isUploading && <ChevronDown className="w-4 h-4 opacity-60" />}
              </button>

              {isNewDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsAddNoteModalOpen(true)
                      setIsNewDropdownOpen(false)
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3"
                  >
                    <FileText className="w-4 h-4"/> Add note
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsCreateFolderModalOpen(true)
                      setIsNewDropdownOpen(false)
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3"
                  >
                    <FolderPlus className="w-4 h-4"/> Add folder
                  </button>
                  <div className="h-px bg-zinc-800/80 my-1.5 mx-2" />
                  <button 
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsNewDropdownOpen(false)
                      fileInputRef.current?.click()
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3"
                  >
                    <Upload className="w-4 h-4"/> Upload files
                  </button>
                </div>
              )}
            </div>}
          </div>
        </header>

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4 h-10 overflow-x-auto no-scrollbar gap-4">
          {selectedDocs.size > 0 ? (
            <div className="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
              <button 
                onClick={() => {
                  const ids = Array.from(selectedDocs).join(',');
                  router.push(`/dashboard/chat/new?docIds=${encodeURIComponent(ids)}`);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-medium rounded-full hover:bg-zinc-200 transition-colors"
              >
                <MessageSquare className="w-4 h-4" /> Start chat
              </button>
              <button
                onClick={handleBulkDownload}
                className="flex items-center gap-2 px-4 py-2 border border-zinc-700 bg-zinc-900/50 text-zinc-300 text-sm font-medium rounded-full hover:bg-zinc-800 transition-colors"
              >
                <Download className="w-4 h-4" /> Download
              </button>
              {selectedMutable && (<><button 
                onClick={() => openMoveModal()}
                className="flex items-center gap-2 px-4 py-2 border border-zinc-700 bg-zinc-900/50 text-zinc-300 text-sm font-medium rounded-full hover:bg-zinc-800 transition-colors"
              >
                <FolderOutput className="w-4 h-4" /> Move
              </button>
              <button 
                onClick={() => setDeleteConfirm({ isOpen: true, type: 'bulk' })}
                className="flex items-center gap-2 px-4 py-2 border border-red-500/30 text-red-400 bg-red-950/20 text-sm font-medium rounded-full hover:bg-red-950/40 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button></>)}
            </div>
          ) : (
            <div className="flex items-center gap-1 animate-in fade-in duration-200">
              {['All', 'Images', 'Documents'].map(tab => (
                <button 
                  key={tab}
                  onClick={() => setActiveTab(tab as typeof activeTab)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${activeTab === tab ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 text-zinc-400 text-sm">
            {selectedDocs.size > 0 ? (
              <span className="font-medium">{selectedDocs.size} selected</span>
            ) : (
              uploaders.length > 1 && (
                <div className="relative">
                  <button
                    aria-label="Filter by uploader"
                    onClick={(e) => { e.stopPropagation(); setActiveDropdown(activeDropdown === 'filter' ? null : 'filter') }}
                    className={`relative p-2 transition-colors rounded-full hover:bg-zinc-800/50 ${uploaderFilter ? 'text-blue-400' : 'hover:text-zinc-200'}`}
                  >
                    <Filter className="w-[18px] h-[18px]" />
                    {uploaderFilter && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-blue-400" />}
                  </button>
                  {activeDropdown === 'filter' && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2" onClick={(e) => e.stopPropagation()}>
                      <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Uploaded by</div>
                      {[{ id: null as string | null, label: 'Everyone' }, ...uploaders].map((u) => (
                        <button
                          key={u.id ?? 'all'}
                          onClick={() => { setUploaderFilter(u.id); setActiveDropdown(null) }}
                          className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3"
                        >
                          <Check className={`w-4 h-4 ${uploaderFilter === u.id ? 'opacity-100' : 'opacity-0'}`} />
                          <span className="truncate">{u.label}{u.id === access.userId ? ' (you)' : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
            
            <div className="w-px h-4 bg-zinc-700" />
            
            <div className="flex items-center gap-0.5">
              <button 
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-full transition-colors ${viewMode === 'grid' ? 'bg-zinc-800 text-zinc-200' : 'hover:text-zinc-200 hover:bg-zinc-800/50'}`}
              >
                <LayoutGrid className="w-[18px] h-[18px]" />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-full transition-colors ${viewMode === 'list' ? 'bg-zinc-800 text-zinc-200' : 'hover:text-zinc-200 hover:bg-zinc-800/50'}`}
              >
                <List className="w-[18px] h-[18px]" />
              </button>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto overflow-x-auto min-h-0 pb-12 mt-2">
          {loading ? (
            viewMode === 'list' ? (
              <div className="w-full text-sm min-w-[500px]">
                <div className="flex items-center text-zinc-400 border-b border-zinc-800/80 pb-3 mb-2">
                  <div className="w-12 flex justify-center">
                    <div className="w-[18px] h-[18px] rounded-[4px] border-2 border-zinc-500/30" />
                  </div>
                  <div className="flex-1 font-medium pl-2">Name</div>
                  <div className="w-32 font-medium">Modified</div>
                  <div className="w-24 font-medium">Size</div>
                </div>
                
                <div className="flex flex-col">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center py-3 border-b border-transparent">
                      <div className="w-12 flex justify-center">
                        <div className="w-[18px] h-[18px] rounded-[4px] bg-zinc-800/50 animate-pulse" />
                      </div>
                      
                      <div className="flex-1 flex items-center gap-4 pl-2 pr-4">
                        <div className="w-[30px] h-[30px] rounded-[8px] bg-zinc-800/50 animate-pulse shrink-0" />
                        <div className="h-4 bg-zinc-800/50 rounded animate-pulse w-48" />
                      </div>
                      
                      <div className="w-32 shrink-0">
                        <div className="h-4 bg-zinc-800/50 rounded animate-pulse w-24" />
                      </div>
                      
                      <div className="w-24 shrink-0 pr-4">
                        <div className="h-4 bg-zinc-800/50 rounded animate-pulse w-12" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 pt-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                  <div key={i} className="flex flex-col border border-transparent rounded-xl p-3 bg-zinc-900/50">
                    <div className="h-28 w-full bg-zinc-800/30 rounded-lg flex items-center justify-center mb-3 animate-pulse">
                      <div className="w-12 h-12 rounded-xl bg-zinc-800/50" />
                    </div>
                    <div className="h-4 bg-zinc-800/50 rounded animate-pulse w-3/4 mb-2 mx-1" />
                    <div className="h-3 bg-zinc-800/30 rounded animate-pulse w-1/2 mx-1" />
                  </div>
                ))}
              </div>
            )
          ) : filteredDocuments.length === 0 && filteredFolders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-zinc-500">
              <File className="w-10 h-10 mb-4 opacity-20" />
              <p className="text-sm">No files or folders found.</p>
            </div>
          ) : viewMode === 'list' ? (
            <div className="w-full text-sm min-w-[500px]">
              <div className="flex items-center text-zinc-400 border-b border-zinc-800/80 pb-3 mb-2">
                <div 
                  onClick={toggleAll}
                  className="w-12 flex justify-center cursor-pointer"
                >
                  <div className={`w-[18px] h-[18px] rounded-[4px] border-2 flex items-center justify-center transition-colors ${
                    isAllSelected ? 'bg-white border-white' : 
                    isPartiallySelected ? 'bg-white border-white' : 
                    'border-zinc-500 hover:border-zinc-300'
                  }`}>
                    {isAllSelected && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
                    {isPartiallySelected && <Minus className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
                  </div>
                </div>
                <div className="flex-1 font-medium pl-2">Name</div>
                <div className="w-32 font-medium">Modified</div>
                <div className="w-24 font-medium">Size</div>
              </div>
              
              <div className="flex flex-col">
                {filteredFolders.map(folder => (
                  <div 
                    key={folder.id} 
                    onDoubleClick={() => {
                      setCurrentFolderId(folder.id);
                      setFolderPath(prev => [...prev, { id: folder.id, name: folder.name }]);
                    }}
                    className="group flex items-center py-3 rounded-xl transition-colors cursor-pointer border-b border-transparent hover:bg-[#202123]/80 hover:border-zinc-800/50"
                  >
                    <div className="w-12 flex justify-center">
                      <div className="w-[18px] h-[18px]" />
                    </div>
                    
                    <div className="flex-1 flex items-center gap-4 overflow-hidden pl-2 pr-4">
                      <div className="w-[30px] h-[30px] rounded-[8px] bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                        <Folder className="w-[14px] h-[14px]" />
                      </div>
                      <span 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setCurrentFolderId(folder.id);
                          setFolderPath(prev => [...prev, { id: folder.id, name: folder.name }]);
                        }} 
                        className="truncate text-[15px] font-medium text-zinc-200 hover:underline"
                      >
                        {folder.name}
                      </span>
                    </div>
                    
                    <div className="w-32 text-zinc-400 shrink-0">
                      {formatDate(folder.createdAt)}
                    </div>
                    
                    <div className="w-24 text-zinc-400 shrink-0 flex items-center justify-between relative pr-4">
                      <span>—</span>
                      
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            setActiveDropdown(activeDropdown === folder.id ? null : folder.id); 
                          }}
                          className={`p-1.5 hover:text-zinc-200 hover:bg-zinc-700 rounded-md transition-colors ${activeDropdown === folder.id ? 'bg-zinc-700 text-zinc-200 opacity-100' : ''} ${access.canManageFolders ? '' : 'hidden'}`}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>

                      {access.canManageFolders && activeDropdown === folder.id && (
                        <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2">
                          <button onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); openRename(folder.id, folder.name, true); }} className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3">
                            <Edit2 className="w-4 h-4"/> Rename
                          </button>
                          <div className="h-px bg-zinc-800/80 my-1.5 mx-2" />
                          <button 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setDeleteConfirm({ isOpen: true, type: 'single', id: folder.id, isFolder: true }); 
                              setActiveDropdown(null); 
                            }} 
                            className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-zinc-800 flex items-center gap-3"
                          >
                            <Trash2 className="w-4 h-4"/> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                {filteredDocuments.map(doc => {
                  const isSelected = selectedDocs.has(doc.id)
                  return (
                    <div 
                      key={doc.id} 
                      onClick={() => toggleSelection(doc.id)}
                      className={`group flex items-center py-3 rounded-xl transition-colors cursor-pointer border-b border-transparent ${isSelected ? 'bg-zinc-800/60' : 'hover:bg-[#202123]/80 hover:border-zinc-800/50'}`}
                    >
                      <div className="w-12 flex justify-center">
                        <div className={`w-[18px] h-[18px] rounded-[4px] border-2 flex items-center justify-center transition-colors ${
                          isSelected ? 'bg-white border-white' : 'border-zinc-500 group-hover:border-zinc-300 opacity-0 group-hover:opacity-100'
                        }`}>
                          {isSelected && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
                        </div>
                      </div>
                      
                      <div 
                        className="flex-1 flex items-center gap-4 overflow-hidden pl-2 pr-4 hover:bg-zinc-800/40 rounded-lg py-1 -my-1 cursor-pointer transition-colors"
                        onClick={(e) => { e.stopPropagation(); handleView(doc.id, doc.fileName, doc.fileType); }}
                      >
                        <div className="w-[30px] h-[30px] rounded-[8px] bg-blue-900/20 border border-blue-800/40 flex items-center justify-center text-blue-500 shrink-0">
                          {doc.fileType.includes('image') ? <ImageIcon className="w-[14px] h-[14px]" /> : <FileText className="w-[14px] h-[14px]" />}
                        </div>
                        <span className="truncate text-[15px] font-medium text-zinc-200 group-hover:text-blue-400 transition-colors">{doc.fileName}</span>
                      </div>
                      
                      <div className="w-32 text-zinc-400 shrink-0">
                        {formatDate(doc.createdAt)}
                        {(doc.uploaderName || doc.uploaderEmail) && (
                          <div className="text-[11px] text-zinc-500 truncate" title={doc.uploaderEmail ?? undefined}>by {doc.uploaderName || doc.uploaderEmail}</div>
                        )}
                      </div>
                      
                      <div className="w-24 text-zinc-400 shrink-0 flex items-center justify-between relative pr-4">
                        <span>{formatSize(doc.fileSizeBytes)}</span>
                        
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setActiveDropdown(activeDropdown === doc.id ? null : doc.id); 
                            }}
                            className={`p-1.5 hover:text-zinc-200 hover:bg-zinc-700 rounded-md transition-colors ${activeDropdown === doc.id ? 'bg-zinc-700 text-zinc-200 opacity-100' : ''}`}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>

                        {activeDropdown === doc.id && (
                          <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2">
                            <button onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); router.push(`/dashboard/chat/new?docIds=${encodeURIComponent(doc.id)}`); }} className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3">
                              <MessageSquare className="w-4 h-4"/> Chat about this
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); handleView(doc.id, doc.fileName, doc.fileType); }} className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3">
                              <Eye className="w-4 h-4"/> View
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); handleDownload(doc.id, doc.fileName); }} className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3">
                              <Download className="w-4 h-4"/> Download
                            </button>
                            {access.canMutateDoc(doc.uploadedBy) && (<><button onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); openRename(doc.id, doc.fileName, false); }} className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3">
                              <Edit2 className="w-4 h-4"/> Rename
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDropdown(null);
                                openMoveModal(doc.id);
                              }}
                              className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3"
                            >
                              <FolderOutput className="w-4 h-4"/> Move
                            </button>
                            <div className="h-px bg-zinc-800/80 my-1.5 mx-2" />
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setDeleteConfirm({ isOpen: true, type: 'single', id: doc.id, isFolder: false }); 
                                setActiveDropdown(null); 
                              }} 
                              className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-zinc-800 flex items-center gap-3"
                            >
                              <Trash2 className="w-4 h-4"/> Delete
                            </button></>)}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 pt-2">
              {filteredFolders.map(folder => (
                <div 
                  key={folder.id} 
                  onDoubleClick={() => {
                    setCurrentFolderId(folder.id);
                    setFolderPath(prev => [...prev, { id: folder.id, name: folder.name }]);
                  }}
                  onClick={() => {
                    setCurrentFolderId(folder.id);
                    setFolderPath(prev => [...prev, { id: folder.id, name: folder.name }]);
                  }}
                  className="group relative flex flex-col hover:bg-[#202123] border border-transparent rounded-xl p-3 cursor-pointer transition-colors bg-zinc-900/50"
                >
                  <div className="absolute top-2 right-2 flex gap-1 z-10 opacity-0 group-hover:opacity-100">
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setActiveDropdown(activeDropdown === folder.id ? null : folder.id); 
                      }}
                      className={`p-1.5 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 rounded-md backdrop-blur-sm transition-colors ${access.canManageFolders ? '' : 'hidden'} ${activeDropdown === folder.id ? 'bg-zinc-700 opacity-100' : ''}`}
                    >
                      <MoreHorizontal className="w-[14px] h-[14px]" />
                    </button>

                    {access.canManageFolders && activeDropdown === folder.id && (
                      <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden animate-in fade-in">
                        <button onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); openRename(folder.id, folder.name, true); }} className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3">
                          <Edit2 className="w-4 h-4"/> Rename
                        </button>
                        <div className="h-px bg-zinc-800/80 my-1.5 mx-2" />
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            setDeleteConfirm({ isOpen: true, type: 'single', id: folder.id, isFolder: true }); 
                            setActiveDropdown(null); 
                          }} 
                          className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-zinc-800 flex items-center gap-3"
                        >
                          <Trash2 className="w-4 h-4"/> Delete
                        </button>
                      </div>
                    )}
                  </div>
                  
                  <div className="h-28 w-full bg-zinc-800/30 rounded-lg flex items-center justify-center mb-3">
                    <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-400">
                      <Folder className="w-6 h-6" />
                    </div>
                  </div>
                  <h3 className="font-medium text-sm truncate text-zinc-200 mb-1 px-1">
                    {folder.name}
                  </h3>
                  <div className="text-xs text-zinc-500 flex items-center justify-between px-1">
                    <span>{formatDate(folder.createdAt)}</span>
                  </div>
                </div>
              ))}

              {filteredDocuments.map(doc => {
                const isSelected = selectedDocs.has(doc.id)
                return (
                  <div 
                    key={doc.id} 
                    onClick={() => toggleSelection(doc.id)}
                    className={`group relative flex flex-col hover:bg-[#202123] border border-transparent rounded-xl p-3 cursor-pointer transition-colors ${isSelected ? 'bg-zinc-800/60' : 'bg-zinc-900/50'}`}
                  >
                    <div className="absolute top-2 left-2 z-10">
                      <div className={`w-[18px] h-[18px] rounded-[4px] border-2 flex items-center justify-center transition-colors ${
                        isSelected ? 'bg-white border-white opacity-100' : 'border-zinc-500 group-hover:border-zinc-300 opacity-0 group-hover:opacity-100 bg-black/20'
                      }`}>
                        {isSelected && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
                      </div>
                    </div>
                    
                    <div className="absolute top-2 right-2 flex gap-1 z-10 opacity-0 group-hover:opacity-100">
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setActiveDropdown(activeDropdown === doc.id ? null : doc.id); 
                        }}
                        className={`p-1.5 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 rounded-md backdrop-blur-sm transition-colors ${activeDropdown === doc.id ? 'bg-zinc-700 opacity-100' : ''}`}
                      >
                        <MoreHorizontal className="w-[14px] h-[14px]" />
                      </button>

                      {activeDropdown === doc.id && (
                        <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden animate-in fade-in">
                          <button onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); router.push(`/dashboard/chat/new?docIds=${encodeURIComponent(doc.id)}`); }} className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3">
                            <MessageSquare className="w-4 h-4"/> Chat about this
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); handleView(doc.id, doc.fileName, doc.fileType); }} className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3">
                            <Eye className="w-4 h-4"/> View
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); handleDownload(doc.id, doc.fileName); }} className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3">
                            <Download className="w-4 h-4"/> Download
                          </button>
                          {access.canMutateDoc(doc.uploadedBy) && (<><button onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); openRename(doc.id, doc.fileName, false); }} className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3">
                            <Edit2 className="w-4 h-4"/> Rename
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDropdown(null);
                              openMoveModal(doc.id);
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 flex items-center gap-3"
                          >
                            <FolderOutput className="w-4 h-4"/> Move
                          </button>
                          <div className="h-px bg-zinc-800/80 my-1.5 mx-2" />
                          <button 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setDeleteConfirm({ isOpen: true, type: 'single', id: doc.id, isFolder: false }); 
                              setActiveDropdown(null); 
                            }} 
                            className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-zinc-800 flex items-center gap-3"
                          >
                            <Trash2 className="w-4 h-4"/> Delete
                          </button></>)}
                        </div>
                      )}
                    </div>
                    
                    <div className="h-28 w-full bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors rounded-lg flex items-center justify-center mb-3 cursor-pointer" onClick={(e) => { e.stopPropagation(); handleView(doc.id, doc.fileName, doc.fileType); }}>
                      <div className="w-12 h-12 rounded-xl bg-blue-900/20 border border-blue-800/40 flex items-center justify-center text-blue-500 shadow-inner group-hover:scale-105 transition-transform">
                        {doc.fileType.includes('image') ? <ImageIcon className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                      </div>
                    </div>
                    <h3 
                      className="font-medium text-sm truncate text-zinc-200 mb-1 px-1 cursor-pointer hover:text-blue-400 transition-colors"
                      onClick={(e) => { e.stopPropagation(); handleView(doc.id, doc.fileName, doc.fileType); }}
                    >
                      {doc.fileName}
                    </h3>
                    <div className="text-xs text-zinc-500 flex items-center justify-between px-1">
                      <span className="truncate" title={doc.uploaderEmail ?? undefined}>{formatDate(doc.createdAt)}{(doc.uploaderName || doc.uploaderEmail) ? ` · ${doc.uploaderName || doc.uploaderEmail}` : ''}</span>
                      <span className="shrink-0">{formatSize(doc.fileSizeBytes)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-xl font-medium text-white mb-2">Confirm Deletion</h3>
              <p className="text-zinc-400 text-sm mb-6">
                {deleteConfirm.type === 'bulk' 
                  ? `Are you sure you want to delete ${selectedDocs.size} document(s)? This action cannot be undone.`
                  : `Are you sure you want to delete this ${deleteConfirm.isFolder ? 'folder' : 'document'}? This action cannot be undone.`
                }
              </p>
              
              <div className="flex items-center justify-end gap-3">
                <button 
                  onClick={() => setDeleteConfirm({ isOpen: false, type: 'single' })}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white transition-colors flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
          <div className="flex-1 border-x border-b border-zinc-800 rounded-b-xl overflow-hidden relative flex flex-col md:flex-row bg-zinc-950">
            {/* File Viewer */}
            <div className="flex-1 relative flex items-center justify-center bg-zinc-950/50">
              {previewDocument.fileType.includes('image') ? (
                <>
                  {/* Blob URL of the viewer's own download; next/image can't optimise blob: URLs. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewDocument.url} alt={previewDocument.fileName} className="max-w-full max-h-full object-contain p-4" />
                </>
              ) : previewDocument.fileType === 'pdf' ? (
                <iframe src={`${previewDocument.url}#toolbar=0`} className="w-full h-full border-none bg-zinc-900 rounded-bl-xl" />
              ) : (
                <iframe sandbox="" src={previewDocument.url} className="w-full h-full border-none bg-white rounded-bl-xl" />
              )}
            </div>
            
            {/* Notes Sidebar */}
            <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-zinc-800 bg-zinc-900/50 flex flex-col rounded-br-xl shrink-0">
              <div className="p-4 border-b border-zinc-800 flex items-center gap-2 shrink-0">
                <FileText className="w-4 h-4 text-zinc-400" />
                <h4 className="font-medium text-sm text-zinc-200">Document Notes</h4>
              </div>
              <div className="flex-1 p-4 flex flex-col gap-3 min-h-[250px]">
                <textarea 
                  value={previewDocument.notes || ''}
                  onChange={(e) => setPreviewDocument(prev => prev ? {...prev, notes: e.target.value} : prev)}
                  placeholder="Add your notes about this document here..."
                  className="flex-1 w-full bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-3 text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all resize-none"
                />
                <button 
                  onClick={async () => {
                    try {
                      setIsUploading(true);
                      const accessToken = await getAccessToken()
                      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/documents/${previewDocument.id}/notes`, {
                        method: 'PATCH',
                        headers: { 
                          'Authorization': `Bearer ${accessToken}`,
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ notes: previewDocument.notes })
                      });
                      if (res.ok) {
                        showNotification('Notes saved successfully', 'success');
                        setDocuments(prev => prev.map(d => d.id === previewDocument.id ? {...d, notes: previewDocument.notes} : d));
                      } else {
                        throw new Error('Failed to save');
                      }
                    } catch {
                      showNotification('Failed to save notes', 'error');
                    } finally {
                      setIsUploading(false);
                    }
                  }}
                  disabled={isUploading}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Notes'}
                </button>
              </div>
            </div>
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
              <Check className="w-5 h-5 text-green-500 shrink-0" />
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
