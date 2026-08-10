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
          <div className="relative w-full bg-neutral-950 rounded-full h-5 overflow-hidden border border-neutral-800 shadow-inner flex">
            {/* 4-Stage Multi-Segment Progress Bar */}
            {[1, 2, 3, 4].map((stage) => {
              // Determine if we are in this pass, past it, or before it
              const msg = message || '';
              const passMatch = msg.match(/\(Pass (\d+)\/4\)/);
              let currentPass = 1;
              if (passMatch && passMatch[1]) {
                currentPass = parseInt(passMatch[1], 10);
              } else if (progress > 95 || msg.includes('Trimming') || msg.includes('Normalizing') || msg.includes('Finalizing')) {
                currentPass = 5; // all done
              }
              
              // Calculate width of this specific segment
              let segmentWidth = 0;
              if (currentPass > stage) {
                segmentWidth = 100; // fully completed
              } else if (currentPass === stage) {
                // In current pass, we extract the internal progress_val from the message
                const valMatch = msg.match(/(\d+)%/);
                segmentWidth = valMatch ? parseInt(valMatch[1], 10) : 0;
                
                // fallback to general progress calculation if we don't have pass info
                if (!passMatch) {
                   segmentWidth = Math.round(progress) > (stage * 25) ? 100 : (Math.round(progress) - ((stage-1)*25)) * 4;
                   segmentWidth = Math.max(0, Math.min(100, segmentWidth));
                }
              }

              // Different colors for each bag model pass
              const colors = [
                "from-blue-600 to-cyan-400 shadow-[0_0_15px_rgba(56,189,248,0.5)]",
                "from-cyan-500 to-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.5)]",
                "from-purple-500 to-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.5)]",
                "from-pink-500 to-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.5)]"
              ];

              return (
                <div key={stage} className="h-full flex-1 relative border-r border-neutral-900/50 last:border-0 bg-neutral-900/30 overflow-hidden">
                  <div 
                    className={`absolute top-0 left-0 h-full bg-gradient-to-r ${colors[stage - 1]} transition-all duration-300 ease-out`}
                    style={{ width: `${segmentWidth}%` }}
                  >
                    <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite] -skew-x-12"></div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Subtle indicator dots */}
          <div className="flex justify-between px-6">
             <div className={`w-1.5 h-1.5 rounded-full ${(message || '').includes('(Pass 1/4)') || progress >= 25 ? 'bg-blue-400' : 'bg-neutral-800'}`} />
             <div className={`w-1.5 h-1.5 rounded-full ${(message || '').includes('(Pass 2/4)') || progress >= 50 ? 'bg-purple-400' : 'bg-neutral-800'}`} />
             <div className={`w-1.5 h-1.5 rounded-full ${(message || '').includes('(Pass 3/4)') || progress >= 75 ? 'bg-pink-400' : 'bg-neutral-800'}`} />
             <div className={`w-1.5 h-1.5 rounded-full ${(message || '').includes('(Pass 4/4)') || progress >= 95 ? 'bg-rose-400' : 'bg-neutral-800'}`} />
          </div>
        </div>
      )}
    </div>
  );
}
