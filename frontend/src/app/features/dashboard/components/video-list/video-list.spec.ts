import { VideoList } from './video-list';
import { Video } from '../../../../services/api.service';

const video = (partial: Partial<Video>): Video => ({
  createdAt: '2026-03-10T00:00:00.000Z',
  filename: 'file.mp4',
  id: '1',
  mediaType: 'video',
  originalName: 'Promo.mp4',
  processingStatus: 'ready',
  sourceFilename: 'file.mp4',
  sourceSize: 100,
  size: 100,
  storageProvider: 'local',
  streamVariant: 'original',
  updatedAt: '2026-03-10T00:00:00.000Z',
  uploadedAt: '2026-03-10T00:00:00.000Z',
  ...partial,
});

describe('VideoList', () => {
  it('filters by query and sorts by usage count', () => {
    const component = new VideoList();
    component.videos = [
      video({ filename: 'promo-a.mp4', id: '1', originalName: 'Promo A', usageCount: 2 }),
      video({ filename: 'promo-b.mp4', id: '2', originalName: 'Seasonal', usageCount: 5 }),
      video({ filename: 'menu.mp4', id: '3', originalName: 'Menu Board', usageCount: 1 }),
    ];

    component.query = 'promo';
    component.sortBy = 'most-used';

    expect(component.filteredVideos.map((item) => item.id)).toEqual(['2', '1']);
  });

  it('rejects files that exceed the current upload limit', () => {
    const component = new VideoList();
    component.maxUploadSizeBytes = 500 * 1024 * 1024;
    const oversizedFile = new File([new Uint8Array(1)], 'large.mp4', { type: 'video/mp4' });
    Object.defineProperty(oversizedFile, 'size', { value: 600 * 1024 * 1024 });

    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [oversizedFile] });

    component.onFileSelected({ target: input } as unknown as Event);

    expect(component.uploadError).toContain('0.5 GB');
  });

  it('emits selected local files without a storage target', () => {
    const component = new VideoList();
    const emitted: unknown[] = [];
    component.upload.subscribe((payload) => emitted.push(payload));
    const file = new File(['hello'], 'promo.mp4', { type: 'video/mp4' });

    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    component.onFileSelected({ target: input } as unknown as Event);

    expect(emitted).toEqual([{ file }]);
    expect(component.uploadError).toBeNull();
  });

  it('uses only local supported upload formats', () => {
    const component = new VideoList();

    expect(component.getFileAccept()).toBe('video/mp4,video/webm,video/ogg,video/quicktime,image/jpeg,image/png,image/webp,image/gif');
    expect(component.getUploadHint()).toContain('MP4, WebM, OGG, MOV, JPG, PNG, GIF, WebP');
    expect(component.getUploadHint()).not.toContain('R2');
  });

  it('labels a ready hls-only video with the HLS-only label', () => {
    const component = new VideoList();

    expect(component.getProcessingLabel({ ...video({ streamVariant: 'hls-only' }) })).toBe('Sẵn sàng HLS gốc');
  });

  it('uses the HLS manifest URL for a ready hls-only video preview', () => {
    const component = new VideoList();
    const hlsOnlyVideo = video({
      hlsManifestPath: 'processed/hls/v1/playlist.m3u8',
      streamVariant: 'hls-only',
    });

    expect(component.getPreviewUrl(hlsOnlyVideo)).toBe(
      `/api/videos/${hlsOnlyVideo.id}/hls/playlist.m3u8?v=${encodeURIComponent(hlsOnlyVideo.updatedAt)}`,
    );
  });

  it('keeps the stream URL for a legacy ready video preview', () => {
    const component = new VideoList();
    const legacyVideo = video({ hlsManifestPath: 'processed/hls/v1/playlist.m3u8' });

    expect(component.getPreviewUrl(legacyVideo)).toBe(
      `/api/videos/${legacyVideo.id}/stream?v=${encodeURIComponent(legacyVideo.updatedAt)}`,
    );
  });

  it('labels a failed video with the failure label', () => {
    const component = new VideoList();

    expect(component.getProcessingLabel({ ...video({ processingStatus: 'failed' }) })).toBe('Xử lý thất bại');
  });
});
