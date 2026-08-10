'use client';

import { useEffect } from 'react';
import { useJobStore } from '../store/useJobStore';
import { HeroUploader } from '../components/HeroUploader';
import { JobProgress } from '../components/JobProgress';
import { WaveformEditor } from '../components/WaveformEditor';
import { JobHistory } from '../components/JobHistory';

export default function Home() {
  const { 
    jobId, status, 
    setStatus, setProgress, setResult, setPreview, setError 
  } = useJobStore();

  // Status Polling for Separation and YT Download using Server-Sent Events (SSE)
  useEffect(() => {
    if (!jobId || status === 'completed' || status === 'failed' || status === 'previewing') return;

    const eventSource = new EventSource(`http://localhost:3001/api/jobs/events/${jobId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status === 'completed') {
          if (data.previewUrl) {
            setPreview(null, data.previewUrl, data.previewId);
          } else if (data.resultUrl) {
            setResult(data.resultUrl);
          }
          eventSource.close();
        } else if (data.status === 'failed') {
          setError(data.error || 'Job failed');
          eventSource.close();
        } else {
          let progressVal = 0;
          let msg = 'Processing...';
          if (data.progress !== undefined) {
             if (typeof data.progress === 'number') {
                progressVal = data.progress;
             } else {
                progressVal = data.progress.percent || 0;
                msg = data.progress.message || msg;
             }
          }
          setProgress(progressVal, msg);
          setStatus(data.status);
        }
      } catch (err) {
        console.error('Error parsing SSE data', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE Error:', err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [jobId, status, setStatus, setProgress, setResult, setPreview, setError]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50 flex flex-col items-center justify-center p-4 selection:bg-blue-500/30">
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-blue-900/20 to-neutral-950 -z-10 pointer-events-none" />
      
      <div className="max-w-2xl w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="text-center space-y-3">
          <h1 className="text-5xl md:text-6xl font-black tracking-tight text-white drop-shadow-sm">Vocal<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-500">Swift</span></h1>
          <p className="text-neutral-400 text-lg font-medium">AI-powered high quality vocal isolation.</p>
        </div>

        {(status === 'idle' || status === 'failed') && <HeroUploader />}
        
        {(status === 'processing' || status === 'uploading' || status === 'queued' || status === 'waiting' || status === 'active' || status === 'delayed') && <JobProgress />}
        
        {(status === 'previewing' || status === 'completed') && <WaveformEditor />}
      </div>

      <JobHistory />
    </main>
  );
}
