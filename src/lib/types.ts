export type Role = 'user' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  disabled?: boolean;
  disabledAt?: string;
  createdAt: string;
}

export type ProcessingStageId =
  | 'queued'
  | 'context'
  | 'transcribe'
  | 'vision'
  | 'write'
  | 'review'
  | 'complete';

export interface ProcessingStage {
  id: ProcessingStageId;
  label: string;
  description: string;
  progress: number;
  status: 'pending' | 'active' | 'done';
}

export interface Shot {
  id: string;
  timeRange: string;
  visual: string;
  camera: string;
  audio: string;
  narrative: string;
}

export interface VideoResult {
  title: string;
  summary: string;
  styleTags: string[];
  transcript: Array<{ time: string; text: string }>;
  shots: Shot[];
  fullScriptMarkdown: string;
  storyboardMarkdown: string;
  imitationMarkdown?: string;
  assumptions: string[];
}

export interface VideoJob {
  id: string;
  userId: string;
  title: string;
  fileName: string;
  fileUrl?: string;
  sourcePath?: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  currentStage: ProcessingStageId;
  progress: number;
  stages: ProcessingStage[];
  result?: VideoResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobArtifactFile {
  name: string;
  url: string;
  relativePath: string;
  timestampSeconds?: number;
}

export interface JobArtifacts {
  frames: JobArtifactFile[];
  markdown: JobArtifactFile[];
  audio?: JobArtifactFile;
}

export interface AiProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  scriptModel: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiProviderInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  scriptModel: string;
  enabled: boolean;
}

export interface SessionPayload {
  token: string;
  user: User;
}
