'use client';

import { useState } from 'react';
import { Clipboard, FileDown, Loader2, FileText, Code, Eye, Plus, Trash2, Play, CheckCircle2, XCircle, LogIn } from 'lucide-react';
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";

interface ParseResult {
  id?: string;
  title: string;
  content: string; // HTML
  textContent: string;
  markdown: string;
  siteName: string;
  byline?: string;
  excerpt?: string;
  needsTranscript?: boolean; // New Flag
}

interface DocItem {
  id: string;
  url: string;
  status: 'pending' | 'processing' | 'processing-transcript' | 'success' | 'error';
  result?: ParseResult;
  error?: string;
}

export default function Home() {
  const { isSignedIn, isLoaded } = useUser();
  const [inputUrls, setInputUrls] = useState('');
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'markdown' | 'text' | 'preview'>('markdown');

  // Parse URLs from textarea
  const handleCompile = async () => {
    if (!isSignedIn) return; // Should be blocked by UI, but double check
    if (!inputUrls.trim()) return;

    const urls = inputUrls
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.length > 0);

    // Create new doc items
    const newDocs: DocItem[] = urls.map(url => ({
      id: crypto.randomUUID(),
      url,
      status: 'pending'
    }));

    setDocuments(prev => [...prev, ...newDocs]);
    setInputUrls(''); // Clear input

    // Process them one by one
    for (const doc of newDocs) {
      await processDoc(doc);
    }
  };

  const processDoc = async (doc: DocItem) => {
    // Update status to processing
    updateDocStatus(doc.id, 'processing');

    try {
      // Step 1: Initial Processing (Metadata / Web Scrape)
      const res = await fetch('/api/processor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: doc.url }),
      });

      // Safe JSON parsing to prevent "Unexpected end of JSON" crash
      const text = await res.text();
      let data: ParseResult;
      try {
        data = text ? JSON.parse(text) : {};
      } catch (e) {
        throw new Error(`Server Error: Response was not valid JSON (${res.status}). Likely a timeout.`);
      }

      if (!res.ok) {
        throw new Error((data as any).error || 'Failed to fetch');
      }

      // If it needs a transcript (YouTube), we enter phase 2
      if (data.needsTranscript && data.id) {
         // Update with partial result immediately so user sees Title/Desc
         setDocuments(prev => prev.map(d => 
            d.id === doc.id 
              ? { ...d, status: 'processing-transcript', result: data } 
              : d
          ));
         
         // Auto-select if it's the first one
         setSelectedDocId(curr => curr === null ? doc.id : curr);

         // Step 2: Fetch Transcript
         const transcriptRes = await fetch('/api/processor/transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId: data.id, url: doc.url }),
         });
         
         const transcriptData = await transcriptRes.json();
         
         if (transcriptData.success && transcriptData.markdown) {
            // Update with full transcript
             setDocuments(prev => prev.map(d => 
                d.id === doc.id 
                  ? { 
                      ...d, 
                      status: 'success', 
                      result: { 
                          ...data, 
                          markdown: transcriptData.markdown,
                          // We also update textContent/content to include transcript roughly
                          // For now, simpler to just update markdown as that's the primary output
                          // But let's try to append to textContent too for consistency
                          textContent: data.textContent + "\n\n(Transcript added)",
                          content: data.content + "<p><em>Transcript added. Switch to Markdown view to see timestamps.</em></p>"
                      } 
                    } 
                  : d
              ));
         } else {
             // Failed to get transcript, but we have metadata. 
             // We can mark as success but maybe with a warning? 
             // Or just leave it as is (the API returns error text in markdown if failed)
             setDocuments(prev => prev.map(d => 
                d.id === doc.id 
                  ? { ...d, status: 'success', result: data } 
                  : d
              ));
         }

      } else {
          // Standard success
          setDocuments(prev => prev.map(d => 
            d.id === doc.id 
              ? { ...d, status: 'success', result: data } 
              : d
          ));
          
          // Auto-select if it's the first one
          setSelectedDocId(curr => curr === null ? doc.id : curr);
      }

    } catch (err: any) {
      // Update error
      setDocuments(prev => prev.map(d => 
        d.id === doc.id 
          ? { ...d, status: 'error', error: err.message } 
          : d
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
    try {
      await navigator.clipboard.writeText(text);
      // Could add toast here
    } catch (err) {
      console.error('Failed to copy', err);
    }
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

  // Get selected document
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
          {isLoaded && (
             isSignedIn ? <UserButton /> : null
          )}
        </div>

        {/* Input Area (Mini) */}
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
                {doc.status === 'processing-transcript' && <Loader2 className="w-4 h-4 text-purple-500 animate-spin shrink-0" />}
                {doc.status === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                {doc.status === 'error' && <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                {doc.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-zinc-600 shrink-0" />}
                
                <div className="flex flex-col min-w-0">
                  <span className={`text-sm font-medium truncate ${selectedDocId === doc.id ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
                    {doc.result?.title || doc.url}
                  </span>
                  <span className="text-xs text-zinc-600 truncate">{new URL(doc.url).hostname}</span>
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

          {documents.length === 0 && (
            <div className="text-center py-10 text-zinc-600 text-sm px-4">
              Add URLs above to build your pile.
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-[#0a0a0a] min-w-0">
        {selectedDoc && (selectedDoc.status === 'success' || selectedDoc.status === 'processing-transcript') && selectedDoc.result ? (
          <>
            {/* Header */}
            <header className="h-16 flex items-center justify-between px-6 border-b border-zinc-800 bg-[#0f0f0f]">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-white truncate">{selectedDoc.result.title}</h2>
                    {selectedDoc.status === 'processing-transcript' && (
                        <span className="text-xs bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-full animate-pulse border border-purple-500/20">
                            Fetching Transcript...
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-4 text-xs text-zinc-500">
                   {selectedDoc.result.byline && <span>By {selectedDoc.result.byline}</span>}
                   <a href={selectedDoc.url} target="_blank" rel="noopener" className="hover:text-blue-400 truncate max-w-xs">{selectedDoc.url}</a>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex bg-zinc-900 rounded-lg p-1 mr-4 border border-zinc-800">
                  <button
                    onClick={() => setActiveTab('markdown')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition ${
                      activeTab === 'markdown' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Code className="w-3.5 h-3.5" /> Markdown
                  </button>
                  <button
                    onClick={() => setActiveTab('text')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition ${
                      activeTab === 'text' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" /> Text
                  </button>
                  <button
                    onClick={() => setActiveTab('preview')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition ${
                      activeTab === 'preview' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </button>
                </div>

                <button
                  onClick={() => copyToClipboard(activeTab === 'markdown' ? selectedDoc.result!.markdown : selectedDoc.result!.textContent)}
                  className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition border border-transparent hover:border-zinc-700"
                  title="Copy content"
                >
                  <Clipboard className="w-4 h-4" />
                </button>
                <button
                  onClick={() => downloadFile(selectedDoc.result!.markdown, 'context.md', 'text/markdown')}
                  className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition border border-transparent hover:border-zinc-700"
                  title="Download .md"
                >
                  <FileDown className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* Viewer */}
            <div className="flex-1 overflow-y-auto p-8 bg-[#0a0a0a] scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
              <div className="max-w-3xl mx-auto">
                {activeTab === 'markdown' && (
                  <pre className="whitespace-pre-wrap font-mono text-sm text-zinc-300 leading-relaxed bg-zinc-900/50 p-6 rounded-lg border border-zinc-800">
                    {selectedDoc.result.markdown}
                  </pre>
                )}
                {activeTab === 'text' && (
                  <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-300 leading-relaxed max-w-none">
                    {/* We use markdown as the source for text view too if user wants structure, 
                        or we can use textContent. Let's use textContent but maybe clean it up? 
                        The user asked for headings in text. textContent might strip them. 
                        Let's use markdown but styled as text? No, let's use textContent. 
                    */}
                    {selectedDoc.result.textContent}
                  </pre>
                )}
                {activeTab === 'preview' && (
                  <div 
                    className="prose prose-invert prose-blue max-w-none"
                    dangerouslySetInnerHTML={{ __html: selectedDoc.result.content }}
                  />
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-4">
             {selectedDoc?.status === 'processing' ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                  <p>Processing...</p>
                </div>
             ) : selectedDoc?.status === 'error' ? (
                <div className="flex flex-col items-center gap-2 text-red-500">
                   <XCircle className="w-8 h-8" />
                   <p>{selectedDoc.error}</p>
                </div>
             ) : (
                <>
                  <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center border border-zinc-800">
                    <Plus className="w-8 h-8 text-zinc-700" />
                  </div>
                  <p>Select a document or compile a new URL</p>
                </>
             )}
          </div>
        )}
      </main>
    </div>
  );
}
