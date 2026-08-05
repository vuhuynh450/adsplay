export type MediaType = 'video' | 'image';
export type VideoProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type VideoStorageProvider = 'local';
export type VideoStreamVariant = 'optimized' | 'original' | 'hls-only';
export type UploadSessionStatus = 'uploading' | 'assembling' | 'completed';
export type ProfileOrientation = 'landscape' | 'rotate90' | 'rotate180' | 'rotate270';

import type { PageKey } from './constants/page-access';
export type { PageKey };
export type UserRole = 'admin' | 'staff';

export interface Video {
    createdAt: string;
    filename: string;
    hlsManifestPath?: string;
    id: string;
    height?: number;
    mediaType: MediaType;
    mimeType?: string;
    originalName: string;
    posterFilename?: string;
    processingError?: string;
    processingStatus: VideoProcessingStatus;
    sourceFilename: string;
    sourceMimeType?: string;
    sourceSize: number;
    size: number;
    storageProvider: VideoStorageProvider;
    streamVariant: VideoStreamVariant;
    durationSeconds?: number;
    updatedAt: string;
    uploadedAt: string;
    usageCount?: number;
    width?: number;
}

export interface Profile {
    createdAt: string;
    id: string;
    lastSeen?: string;
    name: string;
    orientation: ProfileOrientation;
    updatedAt: string;
    videoIds: string[];
}

export interface Device {
    assignedProfileId?: string;
    createdAt: string;
    deviceCode: string;
    id: string;
    lastSeen?: string;
    name: string;
    secretHash: string;
    updatedAt: string;
}

export interface AdminDevice {
    assignedProfileId?: string;
    createdAt: string;
    deviceCode: string;
    id: string;
    lastSeen?: string;
    name: string;
    updatedAt: string;
}

export interface PlayerDeviceBinding {
    device: AdminDevice;
    profile: PlayerProfile;
}

export interface User {
    id: string;
    username: string;
    passwordHash: string;
    role: UserRole;
    isActive: boolean;
    mustChangePassword: boolean;
    allowedPages: PageKey[];
    createdAt: string;
    updatedAt: string;
}

export interface DatabaseSchema {
    devices: Device[];
    profiles: Profile[];
    users: User[];
    videos: Video[];
}

export interface DetailedProfile extends Profile {
    slug: string;
    videos: Video[];
}

export interface AdminProfile extends Profile {
    playerAccessToken: string;
    slug: string;
}

export interface AdminDetailedProfile extends DetailedProfile {
    playerAccessToken: string;
}

export interface PlayerProfileSummary {
    name: string;
    slug: string;
    videoCount: number;
}

export interface PlayerProfile {
    name: string;
    orientation: ProfileOrientation;
    slug: string;
    videos: Video[];
}

export interface UploadSessionManifest {
    chunkSizeBytes: number;
    createdAt: string;
    fileKey: string;
    id: string;
    mimeType: string;
    originalName: string;
    status: UploadSessionStatus;
    totalChunks: number;
    totalSizeBytes: number;
    updatedAt: string;
    uploadedChunkIndexes: number[];
    videoId?: string;
}
