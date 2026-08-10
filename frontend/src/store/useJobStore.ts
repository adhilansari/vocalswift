import { create } from 'zustand';

type JobStatus = 'idle' | 'previewing' | 'uploading' | 'queued' | 'waiting' | 'delayed' | 'active' | 'processing' | 'completed' | 'failed';

interface JobState {
  jobId: string | null;
  status: JobStatus;
  progress: number;
  message: string | null;
  resultUrl: string | null;
  error: string | null;
  previewFile: File | null;
  previewUrl: string | null;
  previewId: string | null;
  
  // Advanced Settings
  trimSilence: boolean;
  minGapSeconds: number;
  normalize: boolean;
  outputFormat: string;
  fastMode: boolean;
  isYoutubeSource: boolean;
  
  setJobId: (id: string) => void;
  setStatus: (status: JobStatus) => void;
  setProgress: (progress: number, message?: string) => void;
  setResult: (url: string) => void;
  setError: (error: string | null) => void;
  setPreview: (file: File | null, url: string | null, id: string | null) => void;
  setIsYoutubeSource: (isYoutube: boolean) => void;
  setAdvancedSettings: (settings: Partial<{trimSilence: boolean, minGapSeconds: number, normalize: boolean, outputFormat: string, fastMode: boolean}>) => void;
  reset: () => void;
}

export const useJobStore = create<JobState>((set) => ({
  jobId: null,
  status: 'idle',
  progress: 0,
  message: null,
  resultUrl: null,
  error: null,
  previewFile: null,
  previewUrl: null,
  previewId: null,
  
  trimSilence: false,
  minGapSeconds: 3.0,
  normalize: true,
  outputFormat: 'mp3',
  fastMode: false,
  isYoutubeSource: false,
  
  setJobId: (id) => set({ jobId: id }),
  setStatus: (status) => set({ status }),
  setProgress: (progress, message) => set((state) => ({ progress, message: message || state.message })),
  setResult: (url) => set({ resultUrl: url, status: 'completed' }),
  setError: (error) => set({ error, status: 'failed' }),
  setPreview: (file, url, id) => set({ previewFile: file, previewUrl: url, previewId: id, status: 'previewing' }),
  setIsYoutubeSource: (isYoutubeSource) => set({ isYoutubeSource }),
  setAdvancedSettings: (settings) => set((state) => ({ ...state, ...settings })),
  reset: () => set({ 
    jobId: null, 
    status: 'idle', 
    progress: 0, 
    message: null,
    resultUrl: null, 
    error: null,
    previewFile: null,
    previewUrl: null,
    previewId: null,
    isYoutubeSource: false,
  }),
}));
