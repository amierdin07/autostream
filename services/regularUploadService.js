const fs = require('fs');
const path = require('path');
const RegularUpload = require('../models/RegularUpload');
const { uploadVideoToYoutube } = require('./youtubeService');

// Map of currently running upload jobs: id -> { progress, cancelToken, etc. }
const activeUploads = new Map();

class RegularUploadService {
  /**
   * Initialize background timer for VPS-held scheduled uploads.
   */
  static init() {
    if (this._schedulerInterval) return;
    console.log('[RegularUploadService] Initializing VPS upload scheduler worker...');
    this._schedulerInterval = setInterval(() => {
      this.checkScheduledUploads();
    }, 20000); // Check every 20 seconds
    this.checkScheduledUploads();
  }

  /**
   * Check if any scheduled uploads held on VPS have reached their publish time.
   */
  static async checkScheduledUploads() {
    try {
      const pendingList = await RegularUpload.findPendingScheduled(new Date());
      for (const record of pendingList) {
        if (!activeUploads.has(record.id)) {
          console.log(`[RegularUploadService] Time reached for job ${record.id} ("${record.title}"). Starting upload to YouTube now...`);
          this.startUpload(record);
        }
      }
    } catch (err) {
      console.error('[RegularUploadService] Error checking scheduled uploads:', err.message);
    }
  }

  /**
   * Start a background upload task for a regular video.
   * @param {Object} uploadRecord The database record from regular_uploads
   */
  static async startUpload(uploadRecord) {
    const { id, user_id, youtube_channel_id, video_path, thumbnail_path } = uploadRecord;

    if (activeUploads.has(id)) {
      console.log(`[RegularUploadService] Upload ${id} already active.`);
      return;
    }

    activeUploads.set(id, {
      id,
      progress: 0,
      startTime: Date.now()
    });

    // Mark as uploading in DB
    await RegularUpload.update(id, {
      status: 'uploading',
      progress: 0,
      error_message: null
    });

    // Run upload in background (detached promise)
    (async () => {
      try {
        console.log(`[RegularUploadService] Starting background upload for job ${id}`);

        let lastReportedProgress = 0;
        let lastReportTime = 0;

        const onProgress = (percent) => {
          const now = Date.now();
          const active = activeUploads.get(id);
          if (active) {
            active.progress = percent;
          }

          // Throttle DB updates to avoid excessive writes
          if (percent - lastReportedProgress >= 3 || percent === 100 || now - lastReportTime >= 3000) {
            lastReportedProgress = percent;
            lastReportTime = now;
            RegularUpload.update(id, { progress: percent }).catch(e => {
              console.warn(`[RegularUploadService] Failed to update progress in DB:`, e.message);
            });
          }
        };

        // If scheduled via YouTube API, we send publishAt.
        // If scheduled via VPS hold, now is the time to publish directly with chosen privacy status.
        const isYoutubeSchedule = uploadRecord.schedule_mode === 'youtube' && uploadRecord.scheduled_publish_at;

        const result = await uploadVideoToYoutube(user_id, youtube_channel_id, video_path, {
          title: uploadRecord.title,
          description: uploadRecord.description,
          tags: uploadRecord.tags,
          category: uploadRecord.category_id,
          privacy: uploadRecord.privacy_status,
          madeForKids: uploadRecord.made_for_kids,
          publishAt: isYoutubeSchedule ? uploadRecord.scheduled_publish_at : undefined,
          thumbnailPath: thumbnail_path,
          playlistId: uploadRecord.playlist_id,
          onProgress
        });

        console.log(`[RegularUploadService] Upload ${id} completed successfully! Video ID: ${result.videoId}`);

        await RegularUpload.update(id, {
          status: 'completed',
          progress: 100,
          youtube_video_id: result.videoId,
          completed_at: new Date().toISOString()
        });

        // Auto-delete video from VPS storage if requested to save disk space
        if (uploadRecord.delete_after_upload === 1 || uploadRecord.delete_after_upload === true) {
          try {
            if (fs.existsSync(video_path)) {
              fs.unlinkSync(video_path);
              console.log(`[RegularUploadService] Deleted local video file to free VPS disk space: ${video_path}`);
            }
            if (uploadRecord.video_id) {
              const Video = require('../models/Video');
              await Video.delete(uploadRecord.video_id);
              console.log(`[RegularUploadService] Removed video record from gallery: ${uploadRecord.video_id}`);
            }
          } catch (delErr) {
            console.warn(`[RegularUploadService] Failed to auto-delete video file:`, delErr.message);
          }
        }
      } catch (err) {
        console.error(`[RegularUploadService] Upload ${id} failed:`, err.message);
        await RegularUpload.update(id, {
          status: 'failed',
          error_message: err.message || 'Upload failed'
        });
      } finally {
        activeUploads.delete(id);
      }
    })();
  }

  /**
   * Get real-time status of an upload job.
   */
  static async getStatus(id, userId) {
    const record = await RegularUpload.findById(id);
    if (!record || record.user_id !== userId) {
      return null;
    }

    const active = activeUploads.get(id);
    if (active) {
      record.progress = Math.max(record.progress || 0, active.progress || 0);
      record.status = 'uploading';
    }

    return record;
  }
}

module.exports = RegularUploadService;
