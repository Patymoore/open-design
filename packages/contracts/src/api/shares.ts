import type { LiveArtifactSummary } from './live-artifacts.js';

export type ResourceShareTargetType = 'live_artifact';
export type ResourceShareRole = 'viewer';

export interface ResourceShare {
  id: string;
  token: string;
  targetType: ResourceShareTargetType;
  projectId: string;
  projectName?: string;
  artifactId?: string;
  role: ResourceShareRole;
  createdByUserId: string;
  createdAt: number;
  revokedAt?: number;
  shareUrl?: string;
}

export interface LiveArtifactShareResponse {
  share: ResourceShare;
}

export interface WorkspaceResourceSharesResponse {
  shares: ResourceShare[];
}

export type PublicResourceShare = Pick<ResourceShare, 'targetType' | 'role' | 'createdAt' | 'projectName'>;

export type PublicLiveArtifactSummary = Pick<
  LiveArtifactSummary,
  'schemaVersion' | 'title' | 'slug' | 'status' | 'pinned' | 'preview' | 'refreshStatus' | 'createdAt' | 'updatedAt' | 'hasDocument'
>;

export interface PublicLiveArtifactShareResponse {
  share: PublicResourceShare;
  artifact: PublicLiveArtifactSummary;
  previewUrl: string;
}
