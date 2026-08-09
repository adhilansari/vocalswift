'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useJobStore } from '../store/useJobStore';
import { UploadCloud, FileAudio, Loader2, Download, RefreshCw, Play, Pause } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';

export default function Home() {
  const [dragActive, setDragActive] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [trimSilence, setTrimSilence] = useState(false);
  
  const { jobId, status, progress, message, resultUrl, error, setJobId, setStatus, setProgress, setResult, setError, reset } = useJobStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // WaveSurfer setup
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const wsRegions = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trimRegion, setTrimRegion] = useState<{start: number, end: number} | null>(null);
  const [isTrimming, setIsTrimming] = useState(false);

  useEffect(() => {
    if (status === 'completed' && resultUrl && waveformRef.current && !wavesurfer.current) {
      wavesurfer.current = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: '#4b5563',
        progressColor: '#3b82f6',
        cursorColor: '#3b82f6',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 80,
      });

      // Initialize Regions plugin
      wsRegions.current = wavesurfer.current.registerPlugin(RegionsPlugin.create());

      // Enable drag selection
      wsRegions.current.enableDragSelection({
        color: 'rgba(59, 130, 246, 0.3)',
      });

      wsRegions.current.on('region-created', (region: any) => {
        // Clear old regions so we only have one
        const regions = wsRegions.current.getRegions();
        regions.forEach((r: any) => {
          if (r.id !== region.id) r.remove();
        });
      });

      wsRegions.current.on('region-updated', (region: any) => {
        setTrimRegion({ start: region.start, end: region.end });
      });

      wavesurfer.current.load(`http://localhost:3001${resultUrl}`);
      
      wavesurfer.current.on('finish', () => setIsPlaying(false));
    }
    
    return () => {
      if (wavesurfer.current && status !== 'completed') {
        wavesurfer.current.destroy();
        wavesurfer.current = null;
        wsRegions.current = null;
      }
    };
  }, [status, resultUrl]);

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
        if (wsRegions.current) {
          wsRegions.current.clearRegions();
        }
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
        if (wsRegions.current) {
          wsRegions.current.clearRegions();
        }
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
    if (wavesurfer.current) {
      wavesurfer.current.setPlaybackRate(rate);
    }
  };

  // Status Polling
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (jobId && (status === 'uploading' || status === 'queued' || status === 'waiting' || status === 'delayed' || status === 'active' || status === 'processing')) {
      interval = setInterval(async () => {
        try {
          // Fetch Job Status
          const res = await fetch(`http://localhost:3001/api/jobs/status/${jobId}`);
          if (res.ok) {
            const data = await res.json();
            
            if (data.status === 'completed' && data.resultUrl) {
              setResult(data.resultUrl);
              clearInterval(interval);
            } else if (data.status === 'failed') {
              setError(data.error || 'Job failed');
              clearInterval(interval);
            } else {
              setProgress(data.progress || 0, data.message);
              setStatus(data.status);
            }
          }

          // Fetch System Stats if processing
          if (status === 'processing' || status === 'active') {
             const statsRes = await fetch('http://localhost:8000/system-stats');
             if (statsRes.ok) {
               const statsData = await statsRes.json();
               setSystemStats(statsData);
             }
          }
        } catch (err) {
          console.error(err);
        }
      }, 2000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [jobId, status, setStatus, setProgress, setResult, setError]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  const handleFileUpload = async (file: File) => {
    reset();
    setStatus('uploading');
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('trimSilence', trimSilence.toString());
    
    try {
      const res = await fetch('http://localhost:3001/api/jobs/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!res.ok) throw new Error('Upload failed');
      
      const data = await res.json();
      setJobId(data.jobId);
      setStatus('queued');
    } catch (err) {
      setError('Failed to upload file.');
    }
  };

  const handleYoutubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!youtubeUrl) return;
    
    reset();
    setStatus('uploading');
    
    try {
      const res = await fetch('http://localhost:3001/api/jobs/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl, trimSilence }),
      });
      
      if (!res.ok) throw new Error('Failed to submit YouTube URL');
      
      const data = await res.json();
      setJobId(data.jobId);
      setStatus('queued');
    } catch (err) {
      setError('Failed to process YouTube URL.');
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50 flex flex-col items-center justify-center p-4">
      <div className="max-w-2xl w-full space-y-8">
        
        <div className="text-center space-y-2">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white">Vocal<span className="text-blue-500">Swift</span></h1>
          <p className="text-neutral-400 text-lg">AI-powered high quality vocal isolation.</p>
        </div>

        {status === 'idle' || status === 'failed' ? (
          <div className="space-y-6">
            <div 
              className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors cursor-pointer
                ${dragActive ? 'border-blue-500 bg-blue-500/10' : 'border-neutral-800 bg-neutral-900/50 hover:bg-neutral-900 hover:border-neutral-700'}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                ref={fileInputRef}
                type="file" 
                accept="audio/*" 
                className="hidden" 
                onChange={handleChange}
              />
              <UploadCloud className="w-12 h-12 text-neutral-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-neutral-200">Drag & drop your audio file</p>
              <p className="text-neutral-500 mt-2 text-sm">MP3, WAV, FLAC (Max 15 min)</p>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-neutral-800" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-neutral-950 px-2 text-neutral-500">Or</span>
              </div>
            </div>

            <form onSubmit={handleYoutubeSubmit} className="flex gap-2">
              <input 
                type="url" 
                placeholder="Paste YouTube URL..." 
                className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
              />
              <button 
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 rounded-lg transition-colors"
              >
                Isolate
              </button>
            </form>

            <div className="flex items-center justify-center gap-2 mt-4">
              <input 
                type="checkbox" 
                id="trimSilence" 
                className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-neutral-950"
                checked={trimSilence}
                onChange={(e) => setTrimSilence(e.target.checked)}
              />
              <label htmlFor="trimSilence" className="text-sm text-neutral-300 select-none cursor-pointer">
                Trim long instrumental silence
              </label>
            </div>

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center">
                {error}
              </div>
            )}
          </div>
        ) : status === 'completed' ? (
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                  <FileAudio className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-white">Vocals Isolated</h3>
                  <p className="text-neutral-400 text-sm">Ready to download</p>
                </div>
              </div>
              <button 
                onClick={reset}
                className="p-2 text-neutral-400 hover:text-white transition-colors"
                title="Start over"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-center gap-2">
                  <button 
                    onClick={togglePlay}
                    className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 flex items-center justify-center transition-colors flex-shrink-0"
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 translate-x-0.5" />}
                  </button>
                  <select 
                    value={playbackRate} 
                    onChange={handlePlaybackRateChange}
                    className="bg-neutral-800 text-xs text-neutral-300 border border-neutral-700 rounded px-1 py-0.5 outline-none"
                  >
                    <option value={0.5}>0.5x</option>
                    <option value={1}>1.0x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={2}>2.0x</option>
                  </select>
                </div>
                <div className="flex-1 h-20 bg-neutral-950 rounded-lg" ref={waveformRef}></div>
              </div>
            </div>

            <div className="flex gap-4">
              {trimRegion && (
                <button 
                  onClick={handleTrim}
                  disabled={isTrimming}
                  className="bg-neutral-800 hover:bg-neutral-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {isTrimming ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                  Trim Region
                </button>
              )}
              
              {!trimRegion && (
                <button 
                  onClick={handleAutoTrimSilence}
                  disabled={isTrimming}
                  className="bg-neutral-800 hover:bg-neutral-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  title="Remove silence from start and end"
                >
                  {isTrimming ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                  Auto-Trim Silence
                </button>
              )}
              
              <a 
                href={`http://localhost:3001${resultUrl}`} 
                download
                className="flex-1 bg-white hover:bg-neutral-200 text-black font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                <Download className="w-5 h-5" />
                Download MP3
              </a>
            </div>
          </div>
        ) : (
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-12 text-center space-y-6">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto" />
            <div className="space-y-2">
              <h3 className="text-xl font-medium text-white">
                {message || (
                  status === 'uploading' ? 'Uploading file...' : 
                  (status === 'queued' || status === 'waiting' || status === 'delayed') ? 'Waiting in queue...' : 
                  status === 'active' ? 'Starting separation...' :
                  status === 'processing' ? 'Separating vocals...' :
                  'Processing...'
                )}
              </h3>
              <p className="text-neutral-400 text-sm">
                This might take a few minutes depending on file size.
              </p>
            </div>
            
            {status !== 'uploading' && status !== 'queued' && status !== 'waiting' && status !== 'delayed' && (
              <div className="space-y-4">
                <div className="relative w-full bg-neutral-950 rounded-full h-3 overflow-hidden border border-neutral-800">
                  <div 
                    className="absolute top-0 left-0 h-full transition-all duration-500 ease-out bg-gradient-to-r from-blue-600 via-blue-400 to-blue-600 animate-[pulse_2s_ease-in-out_infinite]" 
                    style={{ width: `${progress}%`, backgroundSize: '200% 100%' }}
                  />
                  <div 
                    className="absolute top-0 left-0 h-full transition-all duration-500 ease-out bg-blue-500/50 blur-sm" 
                    style={{ width: `${progress}%` }}
                  />
                </div>
                
                {systemStats && (
                  <div className="flex justify-between text-xs font-medium text-neutral-500 px-2 animate-in fade-in">
                    <span>CPU: {systemStats.cpu}%</span>
                    <span>RAM: {systemStats.ram}%</span>
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
