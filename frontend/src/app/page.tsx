'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useJobStore } from '../store/useJobStore';
import { UploadCloud, FileAudio, Loader2, Download, RefreshCw, Play, Pause, Scissors, Check, Wand2 } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';

export default function Home() {
  const [dragActive, setDragActive] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [trimSilence, setTrimSilence] = useState(false);
  
  const { 
    jobId, status, progress, message, resultUrl, error, 
    previewUrl, previewId, setPreview,
    setJobId, setStatus, setProgress, setResult, setError, reset 
  } = useJobStore();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // WaveSurfer setup
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const wsRegions = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trimRegion, setTrimRegion] = useState<{start: number, end: number} | null>(null);
  const [isTrimming, setIsTrimming] = useState(false);
  const [isYoutubeSource, setIsYoutubeSource] = useState(false);

  // Initialize wavesurfer when previewing or completed
  useEffect(() => {
    if ((status === 'previewing' && previewUrl) || (status === 'completed' && resultUrl)) {
      if (waveformRef.current && !wavesurfer.current) {
        wavesurfer.current = WaveSurfer.create({
          container: waveformRef.current,
          waveColor: status === 'previewing' ? '#6b7280' : '#4b5563',
          progressColor: status === 'previewing' ? '#8b5cf6' : '#3b82f6',
          cursorColor: status === 'previewing' ? '#8b5cf6' : '#3b82f6',
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          height: 80,
        });

        wsRegions.current = wavesurfer.current.registerPlugin(RegionsPlugin.create());
        wsRegions.current.enableDragSelection({
          color: status === 'previewing' ? 'rgba(139, 92, 246, 0.3)' : 'rgba(59, 130, 246, 0.3)',
        });

        wsRegions.current.on('region-created', (region: any) => {
          const regions = wsRegions.current.getRegions();
          regions.forEach((r: any) => {
            if (r.id !== region.id) r.remove();
          });
        });

        wsRegions.current.on('region-updated', (region: any) => {
          setTrimRegion({ start: region.start, end: region.end });
        });

        const audioUrl = status === 'previewing' ? previewUrl : `http://localhost:3001${resultUrl}`;
        wavesurfer.current.load(audioUrl.startsWith('http') ? audioUrl : `http://localhost:3001${audioUrl}`);
        
        wavesurfer.current.on('finish', () => setIsPlaying(false));
      }
    }
    
    return () => {
      if (wavesurfer.current && status !== 'completed' && status !== 'previewing') {
        wavesurfer.current.destroy();
        wavesurfer.current = null;
        wsRegions.current = null;
      }
    };
  }, [status, resultUrl, previewUrl]);

  // Handle trim for the final isolated output
  const handleTrim = async () => {
    if (!trimRegion || !jobId) return;
    setIsTrimming(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:3001/api/jobs/trim/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: trimRegion.start, end: trimRegion.end })
      });
      if (!res.ok) throw new Error('Trim failed');
      const data = await res.json();
      if (data.resultUrl) {
        setResult(data.resultUrl);
        setTrimRegion(null);
        if (wsRegions.current) wsRegions.current.clearRegions();
      } else {
        throw new Error(data.error || 'Trim failed');
      }
    } catch (err) {
      setError('Failed to trim audio.');
    } finally {
      setIsTrimming(false);
    }
  };

  const handleAutoTrimSilence = async () => {
    if (!jobId) return;
    setIsTrimming(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:3001/api/jobs/trim-silence/${jobId}`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Silence trim failed');
      const data = await res.json();
      if (data.resultUrl) {
        setResult(data.resultUrl);
        setTrimRegion(null);
        if (wsRegions.current) wsRegions.current.clearRegions();
      } else {
        throw new Error(data.error || 'Silence trim failed');
      }
    } catch (err) {
      setError('Failed to auto-trim silence.');
    } finally {
      setIsTrimming(false);
    }
  };

  const togglePlay = () => {
    if (wavesurfer.current) {
      wavesurfer.current.playPause();
      setIsPlaying(wavesurfer.current.isPlaying());
    }
  };

  const [systemStats, setSystemStats] = useState<{cpu: number, ram: number} | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);

  const handlePlaybackRateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const rate = parseFloat(e.target.value);
    setPlaybackRate(rate);
    if (wavesurfer.current) wavesurfer.current.setPlaybackRate(rate);
  };

  // Status Polling for Separation and YT Download
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (jobId && (status === 'uploading' || status === 'queued' || status === 'waiting' || status === 'delayed' || status === 'active' || status === 'processing')) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`http://localhost:3001/api/jobs/status/${jobId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'completed') {
              clearInterval(interval);
              if (data.previewUrl) {
                // It was a youtube preview job
                setPreview(null, data.previewUrl, data.previewId);
              } else if (data.resultUrl) {
                setResult(data.resultUrl);
              }
            } else if (data.status === 'failed') {
              setError(data.error || 'Job failed');
              clearInterval(interval);
            } else {
              // Ensure we don't accidentally render stringified JSON
              const msg = typeof data.message === 'string' && data.message.startsWith('{') ? 'Processing...' : data.message;
              setProgress(data.progress || 0, msg);
              setStatus(data.status);
            }
          }
          if (status === 'processing' || status === 'active') {
             const statsRes = await fetch('http://localhost:8000/system-stats');
             if (statsRes.ok) setSystemStats(await statsRes.json());
          }
        } catch (err) { console.error(err); }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [jobId, status, setStatus, setProgress, setResult, setPreview, setError]);

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

  const handleIsolate = async () => {
    if (!previewId) return;
    // We are now going to isolate the audio
    // Destroy the current wavesurfer
    if (wavesurfer.current) {
      wavesurfer.current.destroy();
      wavesurfer.current = null;
      wsRegions.current = null;
    }
    
    setStatus('uploading');
    setProgress(0, 'Preparing isolation job...');
    
    try {
      const body: any = {
        fileId: previewId,
        isYoutube: isYoutubeSource,
        trimSilence,
      };
      if (trimRegion) {
        body.start = trimRegion.start;
        body.end = trimRegion.end;
      }
      
      const res = await fetch('http://localhost:3001/api/jobs/isolate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (!res.ok) throw new Error('Isolation failed');
      const data = await res.json();
      setJobId(data.jobId);
      setStatus('queued');
    } catch (err) {
      setError('Failed to start isolation.');
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50 flex flex-col items-center justify-center p-4 selection:bg-blue-500/30">
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-blue-900/20 to-neutral-950 -z-10 pointer-events-none" />
      
      <div className="max-w-2xl w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        
        <div className="text-center space-y-3">
          <h1 className="text-5xl md:text-6xl font-black tracking-tight text-white drop-shadow-sm">Vocal<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-500">Swift</span></h1>
          <p className="text-neutral-400 text-lg font-medium">AI-powered high quality vocal isolation.</p>
        </div>

        {status === 'idle' || status === 'failed' ? (
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

            <div className="flex items-center justify-center gap-3 mt-6 bg-neutral-950/50 py-3 rounded-xl border border-neutral-800/50">
              <div className="relative flex items-center">
                <input 
                  type="checkbox" 
                  id="trimSilence" 
                  className="peer sr-only"
                  checked={trimSilence}
                  onChange={(e) => setTrimSilence(e.target.checked)}
                />
                <div className="w-10 h-6 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
              </div>
              <label htmlFor="trimSilence" className="text-sm font-medium text-neutral-300 select-none cursor-pointer">
                Auto-trim silence during isolation
              </label>
            </div>

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium text-center animate-in fade-in">
                {error}
              </div>
            )}
          </div>
        ) : status === 'previewing' ? (
          <div className="bg-neutral-900/60 border border-neutral-800/60 rounded-3xl p-8 space-y-8 animate-in fade-in zoom-in-95 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-violet-500/20 flex items-center justify-center border border-violet-500/20">
                  <Scissors className="w-6 h-6 text-violet-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Preview & Trim</h3>
                  <p className="text-neutral-400 text-sm font-medium">Select the part you want to isolate (optional)</p>
                </div>
              </div>
              <button onClick={reset} className="p-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-300 hover:text-white transition-colors">
                <RefreshCw className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-neutral-950/80 rounded-2xl p-4 border border-neutral-800/80 shadow-inner">
              <div className="flex items-center gap-4">
                <button 
                  onClick={togglePlay}
                  className="w-14 h-14 rounded-full bg-violet-600 hover:bg-violet-500 flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(139,92,246,0.3)] flex-shrink-0"
                >
                  {isPlaying ? <Pause className="w-6 h-6 text-white" /> : <Play className="w-6 h-6 text-white translate-x-0.5" />}
                </button>
                <div className="flex-1 h-20 relative" ref={waveformRef}></div>
              </div>
            </div>

            <div className="flex gap-4">
              <button 
                onClick={handleIsolate}
                className="flex-1 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white font-bold py-4 px-6 rounded-xl flex items-center justify-center gap-3 transition-all hover:shadow-[0_0_30px_rgba(139,92,246,0.3)] hover:-translate-y-0.5 active:translate-y-0"
              >
                <Wand2 className="w-5 h-5" />
                {trimRegion ? 'Isolate Selected Region' : 'Isolate Full Audio'}
              </button>
            </div>
          </div>
        ) : status === 'completed' ? (
          <div className="bg-neutral-900/60 border border-neutral-800/60 rounded-3xl p-8 space-y-8 animate-in fade-in zoom-in-95 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-green-500/20 flex items-center justify-center border border-green-500/20">
                  <Check className="w-6 h-6 text-green-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Vocals Isolated</h3>
                  <p className="text-neutral-400 text-sm font-medium">Ready to download or trim</p>
                </div>
              </div>
              <button onClick={reset} className="p-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-300 hover:text-white transition-colors">
                <RefreshCw className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-neutral-950/80 rounded-2xl p-4 border border-neutral-800/80 shadow-inner">
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-center gap-2">
                  <button 
                    onClick={togglePlay}
                    className="w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(59,130,246,0.3)] flex-shrink-0"
                  >
                    {isPlaying ? <Pause className="w-6 h-6 text-white" /> : <Play className="w-6 h-6 text-white translate-x-0.5" />}
                  </button>
                  <select 
                    value={playbackRate} 
                    onChange={handlePlaybackRateChange}
                    className="bg-neutral-800/80 text-xs font-semibold text-neutral-300 border border-neutral-700 rounded-lg px-2 py-1 outline-none"
                  >
                    <option value={0.5}>0.5x</option>
                    <option value={1}>1.0x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={2}>2.0x</option>
                  </select>
                </div>
                <div className="flex-1 h-20" ref={waveformRef}></div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              {trimRegion ? (
                <button 
                  onClick={handleTrim}
                  disabled={isTrimming}
                  className="bg-neutral-800 hover:bg-neutral-700 text-white font-semibold py-3.5 px-6 rounded-xl flex items-center justify-center gap-2 transition-all hover:shadow-lg disabled:opacity-50"
                >
                  {isTrimming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Scissors className="w-5 h-5" />}
                  Trim
                </button>
              ) : (
                <button 
                  onClick={handleAutoTrimSilence}
                  disabled={isTrimming}
                  className="bg-neutral-800 hover:bg-neutral-700 text-white font-semibold py-3.5 px-6 rounded-xl flex items-center justify-center gap-2 transition-all hover:shadow-lg disabled:opacity-50"
                  title="Remove silence from start and end"
                >
                  {isTrimming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Scissors className="w-5 h-5" />}
                  Auto-Trim
                </button>
              )}
              
              <a 
                href={`http://localhost:3001${resultUrl}`} 
                download
                className="flex-1 bg-white hover:bg-neutral-200 text-black font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-2 transition-transform hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_20px_rgba(255,255,255,0.1)]"
              >
                <Download className="w-5 h-5" />
                Download MP3
              </a>
            </div>
          </div>
        ) : (
          <div className="bg-neutral-900/60 border border-neutral-800/60 rounded-3xl p-12 text-center space-y-8 backdrop-blur-xl shadow-2xl animate-in fade-in">
            <div className="relative w-24 h-24 mx-auto">
              <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-blue-400 animate-pulse" />
              </div>
            </div>
            
            <div className="space-y-3">
              <h3 className="text-2xl font-bold text-white tracking-tight">
                {message && !message.startsWith('{') ? message : (
                  status === 'uploading' ? 'Preparing audio...' : 
                  (status === 'queued' || status === 'waiting' || status === 'delayed') ? 'Waiting in queue...' : 
                  status === 'active' ? 'Starting...' :
                  status === 'processing' ? 'Separating vocals...' :
                  'Processing...'
                )}
              </h3>
              <p className="text-neutral-400 font-medium">
                Please wait while we process your request.
              </p>
            </div>
            
            {(status === 'processing' || status === 'active') && (
              <div className="space-y-5 max-w-sm mx-auto">
                <div className="relative w-full bg-neutral-950 rounded-full h-4 overflow-hidden border border-neutral-800 shadow-inner">
                  <div 
                    className="absolute top-0 left-0 h-full transition-all duration-700 ease-out bg-gradient-to-r from-blue-600 via-violet-500 to-blue-600 animate-[pulse_2s_ease-in-out_infinite]" 
                    style={{ width: `${progress}%`, backgroundSize: '200% 100%' }}
                  />
                  <div 
                    className="absolute top-0 left-0 h-full transition-all duration-700 ease-out bg-white/20 blur-[2px]" 
                    style={{ width: `${progress}%` }}
                  />
                </div>
                
                {systemStats && (
                  <div className="flex justify-between text-xs font-bold text-neutral-500 px-4 py-2 bg-neutral-950/50 rounded-lg border border-neutral-800/50 animate-in fade-in">
                    <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div> CPU: {systemStats.cpu}%</span>
                    <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-violet-500"></div> RAM: {systemStats.ram}%</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
