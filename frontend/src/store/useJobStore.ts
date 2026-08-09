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
  
  setJobId: (id: string) => void;
  setStatus: (status: JobStatus) => void;
  setProgress: (progress: number, message?: string) => void;
  setResult: (url: string) => void;
  setError: (error: string | null) => void;
  setPreview: (file: File | null, url: string | null, id: string | null) => void;
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
  
  setJobId: (id) => set({ jobId: id }),
  setStatus: (status) => set({ status }),
  setProgress: (progress, message) => set((state) => ({ progress, message: message || state.message })),
  setResult: (url) => set({ resultUrl: url, status: 'completed' }),
  setError: (error) => set({ error, status: 'failed' }),
  setPreview: (file, url, id) => set({ previewFile: file, previewUrl: url, previewId: id, status: 'previewing' }),
  reset: () => set({ 
    jobId: null, 
    status: 'idle', 
    progress: 0, 
    message: null,
    resultUrl: null, 
    error: null,
    previewFile: null,
    previewUrl: null,
    previewId: null
  }),
}));
