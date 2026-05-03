import { Injectable } from '@angular/core';
import { HttpClient, HttpContext, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PUBLIC_API_REQUEST } from './auth.interceptor';

export interface Video {
    createdAt: string;
    durationSeconds?: number;
    id: string;
    filename: string;
    hlsManifestPath?: string;
    height?: number;
    mediaType: 'video' | 'image';
    mimeType?: string;
    originalName: string;
    posterFilename?: string;
    processingError?: string;
    processingStatus: 'pending' | 'processing' | 'ready';
    sourceFilename: string;
    sourceMimeType?: string;
    sourceSize: number;
    size: number;
    storageProvider: 'local' | 'r2';
    r2ObjectKey?: string;
    streamVariant: 'optimized' | 'original';
    updatedAt: string;
    uploadedAt: string;
    usageCount?: number;
    width?: number;
}

export type ProfileOrientation = 'landscape' | 'rotate90' | 'rotate180' | 'rotate270';

export interface Profile {
    createdAt: string;
    id: string;
    name: string;
    orientation: ProfileOrientation;
    playerAccessToken: string;
    slug: string;
    updatedAt: string;
    videoIds: string[];
    videos?: Video[]; // enriched
    lastSeen?: string;
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

export interface AdminDevice {
    assignedProfileId?: string;
    createdAt: string;
    deviceCode: string;
    id: string;
    lastSeen?: string;
    name: string;
    updatedAt: string;
}

export interface DeviceCredentialsResponse {
    deviceCode: string;
    deviceId: string;
    deviceToken: string;
}

export interface StartDeviceRegistrationResponse {
    deviceCode: string;
    expiresAt: string;
    requestId: string;
}

export interface PendingDeviceRegistration {
    createdAt: string;
    expiresAt: string;
    requestId: string;
}

export type DeviceRegistrationStatusResponse =
    | {
        deviceCode: string;
        expiresAt: string;
        requestId: string;
        status: 'pending';
    }
    | ({ status: 'confirmed' } & DeviceCredentialsResponse);

export interface PlayerDeviceBinding {
    device: AdminDevice;
    profile: PlayerProfile;
}

export type PageKey = 'videos' | 'profiles' | 'devices' | 'system' | 'employees';

export type UserRole = 'admin' | 'staff';

export interface AuthLoginUser {
    id: string;
    username: string;
    role: UserRole;
    allowedPages: PageKey[];
    mustChangePassword: boolean;
}

export interface EmployeeView {
    id: string;
    username: string;
    role: 'staff';
    isActive: boolean;
    mustChangePassword: boolean;
    allowedPages: PageKey[];
    createdAt: string;
    updatedAt: string;
}

export interface VideoPolicy {
    allowedMimeTypes: string[];
    mediaProcessingEnabled: boolean;
    maxUploadSizeBytes: number;
    resumableChunkSizeBytes: number;
    storageTargets?: Array<'local' | 'r2'>;
}

export interface UploadSession {
    chunkSizeBytes: number;
    createdAt: string;
    fileKey: string;
    id: string;
    mimeType: string;
    originalName: string;
    status: 'uploading' | 'assembling' | 'completed';
    totalChunks: number;
    totalSizeBytes: number;
    updatedAt: string;
    uploadedChunkIndexes: number[];
    videoId?: string;
}

@Injectable({
    providedIn: 'root'
})
export class ApiService {
    private apiUrl = '/api';

    constructor(private http: HttpClient) { }

    private createPublicRequestContext() {
        return new HttpContext().set(PUBLIC_API_REQUEST, true);
    }

    getVideos(noCache?: boolean): Observable<Video[]> {
        const url = noCache ? `${this.apiUrl}/videos?_t=${Date.now()}` : `${this.apiUrl}/videos`;
        return this.http.get<Video[]>(url);
    }

    getVideoPolicy(): Observable<VideoPolicy> {
        return this.http.get<VideoPolicy>(`${this.apiUrl}/videos/policy`);
    }

    uploadVideo(file: File, storageTarget: 'local' | 'r2' = 'local'): Observable<HttpEvent<Video>> {
        const formData = new FormData();
        formData.append('video', file);
        formData.append('storageTarget', storageTarget);
        return this.http.post<Video>(`${this.apiUrl}/videos`, formData, {
            reportProgress: true,
            observe: 'events'
        });
    }

    createUploadSession(payload: {
        fileKey: string;
        mimeType: string;
        originalName: string;
        totalSizeBytes: number;
    }): Observable<UploadSession> {
        return this.http.post<UploadSession>(`${this.apiUrl}/videos/uploads/sessions`, payload);
    }

    getUploadSession(id: string): Observable<UploadSession> {
        return this.http.get<UploadSession>(`${this.apiUrl}/videos/uploads/sessions/${id}`);
    }

    uploadChunk(sessionId: string, chunkIndex: number, chunk: Blob): Observable<HttpEvent<{ sessionId: string; uploadedChunkIndexes: number[] }>> {
        return this.http.put<{ sessionId: string; uploadedChunkIndexes: number[] }>(
            `${this.apiUrl}/videos/uploads/sessions/${sessionId}/chunks/${chunkIndex}`,
            chunk,
            {
                headers: {
                    'Content-Type': 'application/octet-stream',
                },
                observe: 'events',
                reportProgress: true,
            },
        );
    }

    completeUploadSession(id: string): Observable<Video> {
        return this.http.post<Video>(`${this.apiUrl}/videos/uploads/sessions/${id}/complete`, {});
    }

    cancelUploadSession(id: string): Observable<{ success: boolean }> {
        return this.http.delete<{ success: boolean }>(`${this.apiUrl}/videos/uploads/sessions/${id}`);
    }

    deleteVideo(id: string): Observable<any> {
        return this.http.delete(`${this.apiUrl}/videos/${id}`);
    }

    getProfiles(noCache?: boolean): Observable<Profile[]> {
        const url = noCache ? `${this.apiUrl}/profiles?_t=${Date.now()}` : `${this.apiUrl}/profiles`;
        return this.http.get<Profile[]>(url);
    }

    getPlayerProfiles(noCache?: boolean): Observable<PlayerProfileSummary[]> {
        const url = noCache ? `${this.apiUrl}/profiles?_t=${Date.now()}` : `${this.apiUrl}/profiles`;
        return this.http.get<PlayerProfileSummary[]>(url, {
            context: this.createPublicRequestContext(),
        });
    }

    registerDevice(name?: string): Observable<StartDeviceRegistrationResponse> {
        return this.http.post<StartDeviceRegistrationResponse>(`${this.apiUrl}/devices/register`, { name }, {
            context: this.createPublicRequestContext(),
        });
    }

    getDeviceRegistrationStatus(requestId: string): Observable<DeviceRegistrationStatusResponse> {
        return this.http.get<DeviceRegistrationStatusResponse>(`${this.apiUrl}/devices/register/${requestId}/status`, {
            context: this.createPublicRequestContext(),
        });
    }

    getPlayerBindingByDevice(deviceId: string, deviceToken: string): Observable<PlayerDeviceBinding> {
        return this.http.get<PlayerDeviceBinding>(`${this.apiUrl}/player/device/${deviceId}`, {
            context: this.createPublicRequestContext(),
            headers: {
                'X-Device-Token': deviceToken,
            },
        });
    }

    sendDeviceHeartbeat(deviceId: string, deviceToken: string): Observable<any> {
        return this.http.post(`${this.apiUrl}/player/device/${deviceId}/heartbeat`, {}, {
            context: this.createPublicRequestContext(),
            headers: {
                'X-Device-Token': deviceToken,
            },
        });
    }

    getDevices(): Observable<AdminDevice[]> {
        return this.http.get<AdminDevice[]>(`${this.apiUrl}/devices`);
    }

    getPendingDeviceRegistrations(): Observable<PendingDeviceRegistration[]> {
        return this.http.get<PendingDeviceRegistration[]>(`${this.apiUrl}/devices/pending`);
    }

    confirmPendingDeviceRegistration(requestId: string, deviceCode: string): Observable<AdminDevice> {
        return this.http.post<AdminDevice>(`${this.apiUrl}/devices/pending/${requestId}/confirm`, { deviceCode });
    }

    assignDeviceProfile(deviceId: string, profileId: string): Observable<AdminDevice> {
        return this.http.post<AdminDevice>(`${this.apiUrl}/devices/${deviceId}/assign-profile`, { profileId });
    }

    unassignDeviceProfile(deviceId: string): Observable<AdminDevice> {
        return this.http.post<AdminDevice>(`${this.apiUrl}/devices/${deviceId}/unassign`, {});
    }

    renameDevice(deviceId: string, name: string): Observable<AdminDevice> {
        return this.http.patch<AdminDevice>(`${this.apiUrl}/devices/${deviceId}`, { name });
    }

    rotateDeviceToken(deviceId: string): Observable<DeviceCredentialsResponse> {
        return this.http.post<DeviceCredentialsResponse>(`${this.apiUrl}/devices/${deviceId}/rotate-token`, {});
    }

    deleteDevice(deviceId: string): Observable<{ success: boolean }> {
        return this.http.delete<{ success: boolean }>(`${this.apiUrl}/devices/${deviceId}`);
    }

    getProfile(id: string): Observable<Profile> {
        return this.http.get<Profile>(`${this.apiUrl}/profiles/${id}`);
    }

    getProfileBySlug(slug: string): Observable<PlayerProfile> {
        return this.http.get<PlayerProfile>(`${this.apiUrl}/profiles/slug/${slug}`, {
            context: this.createPublicRequestContext(),
        });
    }

    createProfile(name: string, videoIds: string[], orientation: ProfileOrientation): Observable<any> {
        return this.http.post(`${this.apiUrl}/profiles`, { name, orientation, videoIds });
    }

    updateProfile(id: string, name: string, videoIds: string[], orientation: ProfileOrientation): Observable<any> {
        return this.http.post(`${this.apiUrl}/profiles`, { id, name, orientation, videoIds });
    }

    deleteProfile(id: string): Observable<any> {
        return this.http.delete(`${this.apiUrl}/profiles/${id}`);
    }

    getSystemStatus(): Observable<{ online: boolean; uptime: number; localIps: string[] }> {
        return this.http.get<{ online: boolean; uptime: number; localIps: string[] }>(`${this.apiUrl}/system/status`);
    }

    getEmployees(): Observable<EmployeeView[]> {
        return this.http.get<EmployeeView[]>(`${this.apiUrl}/employees`);
    }

    createEmployee(payload: {
        username: string;
        password: string;
        allowedPages: PageKey[];
    }): Observable<EmployeeView> {
        return this.http.post<EmployeeView>(`${this.apiUrl}/employees`, payload);
    }

    updateEmployeeAllowedPages(id: string, allowedPages: PageKey[]): Observable<EmployeeView> {
        return this.http.patch<EmployeeView>(`${this.apiUrl}/employees/${id}/pages`, { allowedPages });
    }

    updateEmployee(id: string, payload: {
        username?: string;
        password?: string;
        allowedPages?: PageKey[];
    }): Observable<EmployeeView> {
        return this.http.patch<EmployeeView>(`${this.apiUrl}/employees/${id}`, payload);
    }

    updateEmployeeActiveStatus(id: string, isActive: boolean): Observable<EmployeeView> {
        return this.http.patch<EmployeeView>(`${this.apiUrl}/employees/${id}/active`, { isActive });
    }

    resetEmployeeFirstPassword(id: string): Observable<EmployeeView> {
        return this.http.patch<EmployeeView>(`${this.apiUrl}/employees/${id}/reset-first-password`, {});
    }

    changePasswordFirstLogin(newPassword: string): Observable<{ token: string; user: AuthLoginUser }> {
        return this.http.post<{ token: string; user: AuthLoginUser }>(
            `${this.apiUrl}/auth/change-password-first-login`,
            { newPassword },
        );
    }

    sendHeartbeat(profileSlug: string, playerAccessToken: string): Observable<any> {
        return this.http.post(`${this.apiUrl}/profiles/slug/${profileSlug}/heartbeat`, {}, {
            context: this.createPublicRequestContext(),
            headers: {
                'X-Profile-Token': playerAccessToken,
            },
        });
    }

    getVideoStreamUrl(video: Pick<Video, 'id' | 'updatedAt'>): string {
        return `${this.apiUrl}/videos/${video.id}/stream?v=${encodeURIComponent(video.updatedAt)}`;
    }

    getMediaStreamUrl(video: Pick<Video, 'id' | 'updatedAt'>): string {
        return this.getVideoStreamUrl(video);
    }

    getVideoPosterUrl(video: Pick<Video, 'id' | 'updatedAt'>): string {
        return `${this.apiUrl}/videos/${video.id}/poster?v=${encodeURIComponent(video.updatedAt)}`;
    }

    getVideoHlsManifestUrl(video: Pick<Video, 'id' | 'updatedAt'>): string {
        return `${this.apiUrl}/videos/${video.id}/hls/playlist.m3u8?v=${encodeURIComponent(video.updatedAt)}`;
    }
}
