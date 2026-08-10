import { useJobStore } from '../store/useJobStore';
import { Loader2 } from 'lucide-react';

export function JobProgress() {
  const { status, progress, message } = useJobStore();

  return (
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
      
      {(status === 'processing' || status === 'active' || status === 'uploading' || status === 'queued') && (
        <div className="space-y-4 max-w-sm mx-auto">
          <div className="flex justify-between items-end mb-1">
            <span className="text-sm font-semibold text-neutral-300">Progress</span>
            <span className="text-sm font-bold text-blue-400">{Math.round(progress)}%</span>
          </div>
          <div className="relative w-full bg-neutral-950 rounded-full h-5 overflow-hidden border border-neutral-800 shadow-inner">
            <div 
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-600 to-violet-500 rounded-full transition-all duration-300 ease-out shadow-[0_0_15px_rgba(139,92,246,0.5)]"
              style={{ width: `${Math.round(progress)}%` }}
            >
              <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite] -skew-x-12"></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
