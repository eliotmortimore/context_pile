'use client';

import { useState, useEffect } from 'react';
import { Clipboard, FileDown, Loader2, FileText, Code, Eye, Plus, Trash2, Play, CheckCircle2, XCircle, ChevronRight, LogIn } from 'lucide-react';
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";

interface ParseResult {
  title: string;
  markdown: string;
  siteName: string;
}

interface DocItem {
  id: string;
  url: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  result?: ParseResult;
  error?: string;
  createdAt?: string;
}

export default function Dashboard() {
  const { isSignedIn, isLoaded } = useUser();
  const [inputUrls, setInputUrls] = useState('');
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'markdown' | 'preview'>('markdown');

  // Load History
  useEffect(() => {
    if (isSignedIn) {
      fetch('/api/documents')
        .then(async (res) => {
          if (!res.ok) return [];
          try {
            return await res.json();
          } catch (e) {
             console.error("History JSON parse error");
             return [];
          }
        })
        .then(data => {
          if (Array.isArray(data)) {
            const historyDocs: DocItem[] = data.map((d: any) => ({
              id: d.id,
              url: d.url,
              status: 'success',
              createdAt: d.createdAt,
              result: {
                title: d.title || 'Untitled',
                markdown: d.markdown || '',
                siteName: d.siteName || '',
              }
            }));
            setDocuments(prev => {
              const currentIds = new Set(prev.map(p => p.id));
              const newHistory = historyDocs.filter(h => !currentIds.has(h.id));
              return [...newHistory, ...prev];
            });
          }
        })
        .catch(err => console.error('Failed to load history', err));
    }
  }, [isSignedIn]);

  // Parse URLs
  const handleCompile = async () => {
    if (!isSignedIn) return;
    if (!inputUrls.trim()) return;

    const urls = inputUrls.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    
    // Create new doc items
    const newDocs: DocItem[] = urls.map(url => ({
      id: crypto.randomUUID(), // Temp ID
      url,
      status: 'pending'
    }));

    setDocuments(prev => [...newDocs, ...prev]); 
    setInputUrls('');

    // Process
    for (const doc of newDocs) {
      await processDoc(doc);
    }
  };

  const processDoc = async (doc: DocItem) => {
    updateDocStatus(doc.id, 'processing');
    try {
      const res = await fetch('/api/processor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: doc.url }),
      });

      // SAFE JSON PARSING
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch (e) {
        throw new Error(`Server returned invalid JSON: ${text.slice(0, 50)}...`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Server Error (${res.status})`);
      }

      // Update success
      setDocuments(prev => prev.map(d => 
        d.id === doc.id 
          ? { ...d, id: data.id || d.id, status: 'success', result: data } 
          : d
      ));
      
      // Select it if none selected
      setSelectedDocId(prev => prev ? prev : (data.id || doc.id));

    } catch (err: any) {
      console.error("Processing failed:", err);
      setDocuments(prev => prev.map(d => 
        d.id === doc.id ? { ...d, status: 'error', error: err.message } : d
      ));
    }
  };

  const updateDocStatus = (id: string, status: DocItem['status']) => {
    setDocuments(prev => prev.map(d => d.id === id ? { ...d, status } : d));
  };

  const removeDoc = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDocuments(prev => prev.filter(d => d.id !== id));
    if (selectedDocId === id) setSelectedDocId(null);
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch (err) { console.error(err); }
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const selectedDoc = documents.find(d => d.id === selectedDocId);

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-zinc-100 font-sans overflow-hidden">
      
      {/* Sidebar */}
      <aside className="w-80 flex flex-col border-r border-zinc-800 bg-[#0f0f0f]">
        <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <div className="w-2 h-6 bg-blue-600 rounded-full"></div>
            ContextPile
          </h1>
          {isLoaded && isSignedIn && <UserButton />}
        </div>

        {/* Input Area */}
        <div className="p-4 border-b border-zinc-800 space-y-3">
          {isLoaded && !isSignedIn ? (
             <div className="h-24 flex items-center justify-center bg-zinc-900 border border-zinc-700 rounded-lg border-dashed">
               <SignInButton mode="modal">
                 <button className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition">
                   <LogIn className="w-4 h-4" /> Sign in to compile
                 </button>
               </SignInButton>
             </div>
          ) : (
            <>
              <textarea
                className="w-full h-24 bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-300 placeholder:text-zinc-600 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                placeholder="Paste URLs here (one per line)..."
                value={inputUrls}
                onChange={(e) => setInputUrls(e.target.value)}
              />
              <button
                onClick={handleCompile}
                disabled={!inputUrls.trim()}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                <Play className="w-4 h-4" /> Compile
              </button>
            </>
          )}
        </div>

        {/* Document List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {documents.map(doc => (
            <div
              key={doc.id}
              onClick={() => setSelectedDocId(doc.id)}
              className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                selectedDocId === doc.id 
                  ? 'bg-zinc-800 border-zinc-700' 
                  : 'hover:bg-zinc-900 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                {doc.status === 'processing' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />}
                {doc.status === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                {doc.status === 'error' && <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                {doc.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-zinc-600 shrink-0" />}
                
                <div className="flex flex-col min-w-0">
                  <span className={`text-sm font-medium truncate ${selectedDocId === doc.id ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
                    {doc.result?.title || doc.url}
                  </span>
                  <span className="text-xs text-zinc-600 truncate">
                    {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : new URL(doc.url).hostname}
                  </span>
                </div>
              </div>

              <button 
                onClick={(e) => removeDoc(doc.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-700 rounded text-zinc-500 hover:text-red-400 transition"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-[#0a0a0a] min-w-0">
        {selectedDoc && selectedDoc.status === 'success' && selectedDoc.result ? (
          <>
            <header className="h-16 flex items-center justify-between px-6 border-b border-zinc-800 bg-[#0f0f0f]">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-white truncate">{selectedDoc.result.title}</h2>
                <div className="flex items-center gap-4 text-xs text-zinc-500">
                   {selectedDoc.result.siteName && <span>Source: {selectedDoc.result.siteName}</span>}
                   <a href={selectedDoc.url} target="_blank" rel="noopener" className="hover:text-blue-400 truncate max-w-xs">{selectedDoc.url}</a>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex bg-zinc-900 rounded-lg p-1 mr-4 border border-zinc-800">
                  <button onClick={() => setActiveTab('markdown')} className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition ${activeTab === 'markdown' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}><Code className="w-3.5 h-3.5" /> Markdown</button>
                  <button onClick={() => setActiveTab('preview')} className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition ${activeTab === 'preview' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}><Eye className="w-3.5 h-3.5" /> Preview</button>
                </div>

                <button onClick={() => copyToClipboard(selectedDoc.result!.markdown)} className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition border border-transparent hover:border-zinc-700"><Clipboard className="w-4 h-4" /></button>
                <button onClick={() => downloadFile(selectedDoc.result!.markdown, 'context.md', 'text/markdown')} className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition border border-transparent hover:border-zinc-700"><FileDown className="w-4 h-4" /></button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8 bg-[#0a0a0a]">
              <div className="max-w-3xl mx-auto">
                {activeTab === 'markdown' && <pre className="whitespace-pre-wrap font-mono text-sm text-zinc-300 leading-relaxed bg-zinc-900/50 p-6 rounded-lg border border-zinc-800">{selectedDoc.result.markdown}</pre>}
                {activeTab === 'preview' && (
                  <div className="prose prose-invert prose-blue max-w-none">
                     <pre className="whitespace-pre-wrap font-sans text-sm">{selectedDoc.result.markdown}</pre>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-4">
             {selectedDoc?.status === 'processing' ? (
                <div className="flex flex-col items-center gap-2"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /><p>Processing...</p></div>
             ) : selectedDoc?.status === 'error' ? (
                <div className="flex flex-col items-center gap-2 text-red-500 text-center px-4">
                   <XCircle className="w-8 h-8" />
                   <p className="max-w-md">{selectedDoc.error}</p>
                </div>
             ) : (
                <><div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center border border-zinc-800"><Plus className="w-8 h-8 text-zinc-700" /></div><p>Select a document or compile a new URL</p></>
             )}
          </div>
        )}
      </main>
    </div>
  );
}
