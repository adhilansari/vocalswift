import { useState, useCallback, useRef } from 'react';
import { useJobStore } from '../store/useJobStore';
import { UploadCloud } from 'lucide-react';

export function HeroUploader() {
  const [dragActive, setDragActive] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  
  const { 
    status, error,
    setStatus, setPreview, setJobId, setError, reset,
    setIsYoutubeSource
  } = useJobStore();
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0]);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
  };

  const handleFileUpload = async (file: File) => {
    reset();
    setStatus('uploading');
    setIsYoutubeSource(false);
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch('http://localhost:3001/api/jobs/upload-preview', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setPreview(file, data.previewUrl, data.previewId);
    } catch (err) {
      setError('Failed to upload file.');
    }
  };

  const handleYoutubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!youtubeUrl) return;
    
    reset();
    setStatus('uploading');
    setIsYoutubeSource(true);
    
    try {
      const res = await fetch('http://localhost:3001/api/jobs/youtube-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl }),
      });
      if (!res.ok) throw new Error('Failed to submit YouTube URL');
      const data = await res.json();
      setJobId(data.jobId);
      setStatus('queued'); // This will trigger the polling which eventually sets preview
    } catch (err) {
      setError('Failed to process YouTube URL.');
    }
  };

  return (
    <div className="space-y-6 bg-neutral-900/40 p-6 md:p-8 rounded-3xl border border-neutral-800/50 backdrop-blur-xl shadow-2xl">
      <div 
        className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 cursor-pointer group
          ${dragActive ? 'border-blue-500 bg-blue-500/10 scale-[1.02]' : 'border-neutral-700 bg-neutral-900/50 hover:bg-neutral-800 hover:border-neutral-500'}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleChange} />
        <div className="w-16 h-16 rounded-full bg-neutral-800 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 group-hover:bg-blue-500/20 transition-all duration-300">
          <UploadCloud className={`w-8 h-8 ${dragActive ? 'text-blue-400' : 'text-neutral-400 group-hover:text-blue-400'} transition-colors`} />
        </div>
        <p className="text-lg font-semibold text-neutral-200">Drag & drop your audio file</p>
        <p className="text-neutral-500 mt-2 text-sm font-medium">MP3, WAV, FLAC (Max 15 min)</p>
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-neutral-800" /></div>
        <div className="relative flex justify-center text-xs uppercase font-bold tracking-wider">
          <span className="bg-[#111111] px-3 text-neutral-500 rounded-full">Or</span>
        </div>
      </div>

      <form onSubmit={handleYoutubeSubmit} className="flex gap-3">
        <input 
          type="url" 
          placeholder="Paste YouTube URL..." 
          className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-5 py-3.5 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all shadow-inner"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
        />
        <button 
          type="submit"
          className="bg-white hover:bg-neutral-200 text-black font-bold px-8 rounded-xl transition-transform hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.1)]"
        >
          Start
        </button>
      </form>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium text-center animate-in fade-in">
          {error}
        </div>
      )}
    </div>
  );
}
