import { useEffect, useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import { useJobStore } from '../store/useJobStore';

export function JobHistory() {
  const [history, setHistory] = useState<any[]>([]);
  const { status, resultUrl } = useJobStore();

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3001/api/jobs/history');
      if (res.ok) setHistory(await res.json());
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory, status, resultUrl]); // Re-fetch when status changes or a new result is ready

  if (history.length === 0) return null;

  return (
    <div className="w-full max-w-2xl mt-12 bg-neutral-900/40 rounded-3xl p-6 md:p-8 border border-neutral-800/50 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-8">
      <h3 className="text-xl font-bold text-white mb-6">Your Previous Vocals</h3>
      <div className="space-y-3">
        {history.map((job) => (
          <div key={job.jobId} className="flex items-center justify-between bg-neutral-950/50 p-4 rounded-xl border border-neutral-800 hover:border-neutral-700 transition-colors">
            <div className="overflow-hidden flex-1 mr-4">
              <p className="text-sm font-semibold text-neutral-200 truncate" title={job.name}>{job.name}</p>
              <p className="text-xs text-neutral-500 mt-1">
                {new Date(job.finishedOn).toLocaleString(undefined, { 
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                })}
              </p>
            </div>
            <a 
              href={`http://localhost:3001${job.resultUrl}`} 
              download
              className="w-10 h-10 rounded-lg bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center text-neutral-300 hover:text-white transition-all hover:scale-105 active:scale-95 shrink-0"
              title="Download MP3"
            >
              <Download className="w-5 h-5" />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
