
export interface SrtSegment {
  id: number;
  startTime: number; // in seconds
  endTime: number; // in seconds
  text: string;
  imageData?: string; // base64 or blob url
  videoData?: string; // URL to video
  isGenerating?: boolean;
  generationType?: 'image' | 'video';
  isRecommendedForVideo?: boolean;
}

export interface ReferenceImage {
  id: string;
  name: string;
  data: string;
}

export interface VideoState {
  audioFile: File | null;
  audioFileName?: string;
  srtFile: File | null;
  srtFileName?: string;
  referenceImages: ReferenceImage[];
  segments: SrtSegment[];
  status: 'idle' | 'parsing' | 'generating' | 'ready' | 'exporting';
  currentSegmentIndex: number;
}
