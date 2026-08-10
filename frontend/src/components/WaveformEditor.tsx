import { useEffect, useRef, useState } from 'react';
import { useJobStore } from '../store/useJobStore';
import { Play, Pause, Scissors, RefreshCw, Loader2, Download, Check, Wand2, Crop, Trash2 } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';

export function WaveformEditor() {
  const { 
    jobId, status, resultUrl, previewUrl, previewId, previewFile, isYoutubeSource,
    trimSilence, minGapSeconds, normalize, outputFormat, fastMode,
    setStatus, setProgress, setResult, setError, reset, setJobId,
    setAdvancedSettings
  } = useJobStore();
  
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const wsRegions = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trimRegion, setTrimRegion] = useState<{start: number, end: number} | null>(null);
  const [isTrimming, setIsTrimming] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

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

        const audioUrl = status === 'previewing' ? previewUrl : resultUrl ? `http://localhost:3001${resultUrl}` : null;
        if (audioUrl) {
          wavesurfer.current.load(audioUrl.startsWith('http') ? audioUrl : `http://localhost:3001${audioUrl}`);
        }
        
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

  const handleIsolate = async () => {
    if (!previewId) return;
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
        minGapSeconds,
        normalize,
        outputFormat,
        fastMode,
        originalName: previewFile?.name
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

  const handleCut = async () => {
    if (!trimRegion || !jobId) return;
    setIsTrimming(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:3001/api/jobs/cut/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: trimRegion.start, end: trimRegion.end })
      });
      if (!res.ok) throw new Error('Cut failed');
      const data = await res.json();
      if (data.resultUrl) {
        setResult(data.resultUrl);
        setTrimRegion(null);
        if (wsRegions.current) wsRegions.current.clearRegions();
      } else {
        throw new Error(data.error || 'Cut failed');
      }
    } catch (err) {
      setError('Failed to cut audio.');
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

  const handlePlaybackRateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const rate = parseFloat(e.target.value);
    setPlaybackRate(rate);
    if (wavesurfer.current) wavesurfer.current.setPlaybackRate(rate);
  };

  if (status === 'previewing') {
    return (
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

        <div className="bg-neutral-900/50 rounded-2xl p-5 border border-neutral-800/80 space-y-4">
          <h4 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-violet-400" />
            Advanced Audio Processing
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-start gap-3 p-3 rounded-xl hover:bg-neutral-800/50 transition cursor-pointer border border-transparent hover:border-neutral-700/50">
              <input 
                type="checkbox" 
                checked={trimSilence} 
                onChange={(e) => setAdvancedSettings({ trimSilence: e.target.checked })}
                className="mt-1 w-4 h-4 rounded border-neutral-600 text-violet-500 focus:ring-violet-500 bg-neutral-900"
              />
              <div>
                <div className="font-medium text-white text-sm">Trim Instrumental Silence</div>
                <div className="text-xs text-neutral-400 mt-1">Automatically cuts out long silent gaps and crossfades them perfectly.</div>
              </div>
            </label>

            {trimSilence && (
              <div className="flex flex-col gap-2 p-3 rounded-xl bg-neutral-800/30 border border-neutral-800/80">
                <div className="font-medium text-white text-sm">Silence Gap Threshold (Seconds)</div>
                <input 
                  type="range" 
                  min="1.0" max="10.0" step="0.5" 
                  value={minGapSeconds} 
                  onChange={(e) => setAdvancedSettings({ minGapSeconds: parseFloat(e.target.value) })}
                  className="w-full accent-violet-500"
                />
                <div className="text-xs text-neutral-400 text-right">{minGapSeconds.toFixed(1)}s</div>
              </div>
            )}

            <label className="flex items-start gap-3 p-3 rounded-xl hover:bg-neutral-800/50 transition cursor-pointer border border-transparent hover:border-neutral-700/50">
              <input 
                type="checkbox" 
                checked={normalize} 
                onChange={(e) => setAdvancedSettings({ normalize: e.target.checked })}
                className="mt-1 w-4 h-4 rounded border-neutral-600 text-violet-500 focus:ring-violet-500 bg-neutral-900"
              />
              <div>
                <div className="font-medium text-white text-sm">Broadcast Normalization</div>
                <div className="text-xs text-neutral-400 mt-1">Boosts and perfectly balances the volume of the isolated vocals.</div>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-xl hover:bg-neutral-800/50 transition cursor-pointer border border-transparent hover:border-neutral-700/50">
              <input 
                type="checkbox" 
                checked={fastMode} 
                onChange={(e) => setAdvancedSettings({ fastMode: e.target.checked })}
                className="mt-1 w-4 h-4 rounded border-neutral-600 text-violet-500 focus:ring-violet-500 bg-neutral-900"
              />
              <div>
                <div className="font-medium text-white text-sm">Fast Mode (Speed over Quality)</div>
                <div className="text-xs text-neutral-400 mt-1">Uses a faster, lighter AI model instead of the default studio-quality model.</div>
              </div>
            </label>

            <div className="flex flex-col gap-2 p-3 rounded-xl border border-transparent">
              <div className="font-medium text-white text-sm">Export Format</div>
              <select 
                value={outputFormat} 
                onChange={(e) => setAdvancedSettings({ outputFormat: e.target.value })}
                className="bg-neutral-900 border border-neutral-700 rounded-lg p-2 text-sm text-white focus:ring-2 focus:ring-violet-500 outline-none"
              >
                <option value="mp3">MP3 (High Quality, 320kbps)</option>
                <option value="wav">WAV (Lossless)</option>
              </select>
            </div>
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
    );
  }

  if (status === 'completed') {
    return (
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
            <div className="flex gap-2 bg-neutral-800 p-1 rounded-xl">
              <button 
                onClick={handleTrim}
                disabled={isTrimming}
                className="hover:bg-neutral-700 text-white font-semibold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all hover:shadow-lg disabled:opacity-50"
                title="Keep only the selected region"
              >
                {isTrimming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Crop className="w-5 h-5" />}
                Keep Selection
              </button>
              <button 
                onClick={handleCut}
                disabled={isTrimming}
                className="hover:bg-neutral-700 text-rose-400 hover:text-rose-300 font-semibold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all hover:shadow-lg disabled:opacity-50"
                title="Delete the selected region"
              >
                {isTrimming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                Delete Selection
              </button>
            </div>
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
            download={previewFile?.name ? `${previewFile.name.replace(/\.[^/.]+$/, "")}_VF.${outputFormat}` : (isYoutubeSource ? `youtube_audio_VF.${outputFormat}` : `vocals_VF.${outputFormat}`)}
            className="flex-1 bg-white hover:bg-neutral-200 text-black font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-2 transition-transform hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_20px_rgba(255,255,255,0.1)]"
          >
            <Download className="w-5 h-5" />
            Download {outputFormat.toUpperCase()}
          </a>
        </div>
      </div>
    );
  }

  return null;
}
