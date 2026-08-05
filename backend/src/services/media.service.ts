import fs from 'fs-extra';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { getConfig } from '../config';
import { dbRepository } from '../db';
import { AppError } from '../errors';
import { logError, logInfo } from '../logger';
import type { Video } from '../types';

const config = getConfig();
const execFileAsync = promisify(execFile);
const FFMPEG_ERROR_BUFFER_LIMIT = 8192;
const queue: string[] = [];
let isProcessing = false;

interface FfprobeStream {
    codec_name?: string;
    codec_type?: string;
    height?: number;
    width?: number;
}

interface FfprobeOutput {
    format?: {
        duration?: string;
    };
    streams?: FfprobeStream[];
}

const getRequiredBinary = (binaryPath: string | null | undefined, toolName: string) => {
    if (!binaryPath) {
        throw new Error(`${toolName} binary is not available.`);
    }

    return binaryPath;
};

const appendProcessErrorChunk = (stderr: string, chunk: Buffer | string) =>
    (stderr + chunk.toString()).slice(-FFMPEG_ERROR_BUFFER_LIMIT);

const probe = async (inputPath: string): Promise<Partial<Video>> => {
    const ffprobePath = getRequiredBinary(ffprobeStatic.path, 'ffprobe');
    const { stdout } = await execFileAsync(ffprobePath, [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        inputPath,
    ]);

    const metadata = JSON.parse(stdout) as FfprobeOutput;
    const videoStream = metadata.streams?.find((stream) => stream.codec_type === 'video');
    const duration = metadata.format?.duration ? Number(metadata.format.duration) : undefined;

    return {
        durationSeconds: Number.isFinite(duration) ? duration : undefined,
        height: videoStream?.height,
        width: videoStream?.width,
    };
};

const ensurePosterPath = (videoId: string) =>
    path.join(config.processedUploadsDir, 'posters', `${videoId}.jpg`);

const ensureHlsDir = (videoId: string) => path.join(config.processedUploadsDir, 'hls', videoId);

const toUploadsRelativePath = (absolutePath: string) => path.relative(config.uploadsDir, absolutePath);

const createPoster = async (sourcePath: string, outputPath: string) => {
    const ffmpegBinary = getRequiredBinary(ffmpegPath, 'ffmpeg');
    await fs.ensureDir(path.dirname(outputPath));

    await new Promise<void>((resolve, reject) => {
        const process = spawn(ffmpegBinary, [
            '-y',
            '-ss',
            '00:00:00.500',
            '-i',
            sourcePath,
            '-frames:v',
            '1',
            '-vf',
            'scale=w=1280:h=720:force_original_aspect_ratio=decrease',
            '-q:v',
            '2',
            outputPath,
        ]);

        let stderr = '';

        process.stderr.on('data', (chunk: Buffer | string) => {
            stderr = appendProcessErrorChunk(stderr, chunk);
        });

        process.on('error', reject);
        process.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(stderr.trim() || `ffmpeg poster exited with code ${code}`));
        });
    });
};

export const validateHlsOnlySource = async (sourcePath: string): Promise<Partial<Video>> => {
    const ffprobePath = getRequiredBinary(ffprobeStatic.path, 'ffprobe');
    let metadata: FfprobeOutput;

    try {
        const { stdout } = await execFileAsync(ffprobePath, [
            '-v',
            'error',
            '-print_format',
            'json',
            '-show_format',
            '-show_streams',
            sourcePath,
        ]);

        metadata = JSON.parse(stdout) as FfprobeOutput;
    } catch {
        throw new AppError(
            400,
            'VIDEO_CODEC_UNSUPPORTED',
            'Không thể đọc video, file có thể bị hỏng hoặc không phải video hợp lệ. Chỉ hỗ trợ video H.264/AAC (HLS stream copy).',
        );
    }

    const videoStream = metadata.streams?.find((stream) => stream.codec_type === 'video');
    const audioStreams = metadata.streams?.filter((stream) => stream.codec_type === 'audio') ?? [];

    if (videoStream?.codec_name !== 'h264') {
        const detected = videoStream?.codec_name ? ` ${videoStream.codec_name}` : ' (none detected)';
        throw new AppError(
            400,
            'VIDEO_CODEC_UNSUPPORTED',
            `Chỉ hỗ trợ video H.264/AAC (HLS stream copy). Phát hiện codec${detected}.`,
        );
    }

    const unsupportedAudioCodec = audioStreams.find((stream) => stream.codec_name !== 'aac');
    if (unsupportedAudioCodec?.codec_name) {
        throw new AppError(
            400,
            'VIDEO_CODEC_UNSUPPORTED',
            `Chỉ hỗ trợ audio AAC hoặc video không có audio (HLS stream copy). Phát hiện audio codec ${unsupportedAudioCodec.codec_name}.`,
        );
    }

    const duration = metadata.format?.duration ? Number(metadata.format.duration) : undefined;

    return {
        durationSeconds: Number.isFinite(duration) ? duration : undefined,
        height: videoStream?.height,
        width: videoStream?.width,
    };
};

const packageStreamCopy = async (sourcePath: string, hlsDir: string): Promise<string> => {
    const ffmpegBinary = getRequiredBinary(ffmpegPath, 'ffmpeg');
    await fs.emptyDir(hlsDir);

    const playlistPath = path.join(hlsDir, 'playlist.m3u8');
    const segmentPattern = path.join(hlsDir, 'segment-%03d.ts');

    await new Promise<void>((resolve, reject) => {
        const process = spawn(ffmpegBinary, [
            '-y',
            '-i',
            sourcePath,
            '-c:v',
            'copy',
            '-c:a',
            'copy',
            '-hls_time',
            '6',
            '-hls_playlist_type',
            'vod',
            '-hls_segment_filename',
            segmentPattern,
            '-f',
            'hls',
            playlistPath,
        ]);

        let stderr = '';

        process.stderr.on('data', (chunk: Buffer | string) => {
            stderr = appendProcessErrorChunk(stderr, chunk);
        });

        process.on('error', reject);
        process.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(stderr.trim() || `ffmpeg HLS exited with code ${code}`));
        });
    });

    const playlistContent = await fs.readFile(playlistPath, 'utf8');
    const segmentEntries = [...playlistContent.matchAll(/(?:^|\n)segment-\d+\.ts/g)].map(
        (match) => match[0].trim(),
    );

    if (!segmentEntries.length) {
        await fs.remove(hlsDir);
        throw hlsGenerationError('no segments found in the generated playlist.');
    }

    const existingSegments = await Promise.all(
        segmentEntries.map(async (entry) => {
            const segmentPath = path.join(hlsDir, entry);
            const segmentStats = await fs.stat(segmentPath).catch(() => null);
            return segmentStats && segmentStats.size > 0 ? segmentPath : null;
        }),
    );

    if (!existingSegments.some(Boolean)) {
        await fs.remove(hlsDir);
        throw hlsGenerationError('playlist has no segment file with content on disk.');
    }

    return playlistPath;
};

const hlsGenerationError = (message: string) => {
    const error = new Error(`VIDEO_HLS_GENERATION_FAILED: ${message}`) as Error & {
        code?: string;
    };
    error.code = 'VIDEO_HLS_GENERATION_FAILED';

    return error;
};

export const packageHlsOnly = async (
    sourcePath: string,
    videoId: string,
): Promise<{ hlsManifestPath: string }> => {
    const hlsDir = ensureHlsDir(videoId);
    const playlistPath = await packageStreamCopy(sourcePath, hlsDir);

    return { hlsManifestPath: playlistPath };
};

const processNext = async () => {
    if (isProcessing || !queue.length) {
        return;
    }

    isProcessing = true;
    const videoId = queue.shift() as string;

    try {
        const video = await dbRepository.findVideoById(videoId);
        if (!video) {
            return;
        }

        await dbRepository.updateVideo(videoId, (draft) => {
            draft.processingStatus = 'processing';
            draft.processingError = undefined;
        });

        const sourcePath = path.join(config.uploadsDir, video.sourceFilename);
        const [sourceStats, mediaMetadata] = await Promise.all([
            fs.stat(sourcePath),
            probe(sourcePath),
        ]);

        const posterPath = ensurePosterPath(video.id);
        let posterFilename: string | undefined;
        try {
            await createPoster(sourcePath, posterPath);
            posterFilename = toUploadsRelativePath(posterPath);
        } catch (error) {
            await fs.remove(posterPath);
            logError('media.poster_failed', {
                error: error instanceof Error ? error.message : String(error),
                videoId,
            });
        }

        const { hlsManifestPath: manifestPath } = await packageHlsOnly(sourcePath, video.id);
        const hlsManifestPath = toUploadsRelativePath(manifestPath);

        await dbRepository.updateVideo(videoId, (draft) => {
            draft.filename = video.sourceFilename;
            draft.mimeType = video.sourceMimeType || video.mimeType || 'video/mp4';
            draft.processingError = undefined;
            draft.size = sourceStats.size;
            draft.durationSeconds = mediaMetadata.durationSeconds || draft.durationSeconds;
            draft.height = mediaMetadata.height || draft.height;
            draft.width = mediaMetadata.width || draft.width;
            draft.hlsManifestPath = hlsManifestPath;
            draft.posterFilename = posterFilename;
            draft.processingStatus = 'ready';
        });

        try {
            await fs.remove(sourcePath);
        } catch (error) {
            logError('media.source_remove_failed', {
                error: error instanceof Error ? error.message : String(error),
                sourcePath,
                videoId,
            });
        }

        logInfo('media.processed', { videoId });
    } catch (error) {
        logError('media.process_failed', {
            error: error instanceof Error ? error.message : String(error),
            videoId,
        });
        await fs.remove(ensurePosterPath(videoId));
        await fs.remove(ensureHlsDir(videoId));
        await dbRepository.updateVideo(videoId, (draft) => {
            draft.hlsManifestPath = undefined;
            draft.posterFilename = undefined;
            draft.processingStatus = 'failed';
            draft.processingError = 'Không thể tạo HLS từ video gốc, video đã giữ lại nguồn gốc.';
        });
    } finally {
        isProcessing = false;
        if (queue.length) {
            void processNext();
        }
    }
};

export const enqueueVideoProcessing = async (videoId: string) => {
    if (!config.mediaProcessingEnabled) {
        return;
    }

    const video = await dbRepository.findVideoById(videoId);
    if (!video || video.mediaType !== 'video') {
        return;
    }

    queue.push(videoId);
    await processNext();
};
