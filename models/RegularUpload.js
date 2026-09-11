const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');

class RegularUpload {
  static create(data) {
    const id = uuidv4();
    const {
      user_id,
      youtube_channel_id,
      video_id = null,
      video_path,
      video_title = null,
      title,
      description = '',
      tags = '',
      category_id = '22',
      privacy_status = 'public',
      made_for_kids = 0,
      thumbnail_path = null,
      scheduled_publish_at = null,
      schedule_mode = 'youtube',
      delete_after_upload = 1,
      playlist_id = null,
      status = 'pending'
    } = data;

    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO regular_uploads (
          id, user_id, youtube_channel_id, video_id, video_path, video_title,
          title, description, tags, category_id, privacy_status, made_for_kids,
          thumbnail_path, scheduled_publish_at, schedule_mode, delete_after_upload,
          playlist_id, status, progress
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          id,
          user_id,
          youtube_channel_id,
          video_id,
          video_path,
          video_title,
          title,
          description,
          tags,
          category_id,
          privacy_status,
          made_for_kids ? 1 : 0,
          thumbnail_path,
          scheduled_publish_at,
          schedule_mode,
          delete_after_upload ? 1 : 0,
          playlist_id,
          status
        ],
        function (err) {
          if (err) {
            console.error('[RegularUpload] Error inserting record:', err.message);
            return reject(err);
          }
          resolve({ id, ...data, progress: 0, status });
        }
      );
    });
  }

  static findPendingScheduled(beforeDate = new Date()) {
    const isoString = beforeDate.toISOString();
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM regular_uploads 
         WHERE status = 'scheduled' 
           AND schedule_mode = 'vps' 
           AND scheduled_publish_at <= ? 
         ORDER BY scheduled_publish_at ASC`,
        [isoString],
        (err, rows) => {
          if (err) {
            console.error('[RegularUpload] Error finding pending scheduled:', err.message);
            return reject(err);
          }
          resolve(rows || []);
        }
      );
    });
  }

  static findById(id) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT r.*, c.channel_name, c.channel_thumbnail 
         FROM regular_uploads r
         LEFT JOIN youtube_channels c ON r.youtube_channel_id = c.id
         WHERE r.id = ?`,
        [id],
        (err, row) => {
          if (err) {
            console.error('[RegularUpload] Error finding record:', err.message);
            return reject(err);
          }
          resolve(row || null);
        }
      );
    });
  }

  static findAll(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT r.*, c.channel_name, c.channel_thumbnail 
         FROM regular_uploads r
         LEFT JOIN youtube_channels c ON r.youtube_channel_id = c.id
         WHERE r.user_id = ?
         ORDER BY r.created_at DESC`,
        [userId],
        (err, rows) => {
          if (err) {
            console.error('[RegularUpload] Error fetching records:', err.message);
            return reject(err);
          }
          resolve(rows || []);
        }
      );
    });
  }

  static update(id, data) {
    const fields = [];
    const values = [];

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    });

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE regular_uploads SET ${fields.join(', ')} WHERE id = ?`,
        values,
        function (err) {
          if (err) {
            console.error('[RegularUpload] Error updating record:', err.message);
            return reject(err);
          }
          resolve(true);
        }
      );
    });
  }

  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM regular_uploads WHERE id = ? AND user_id = ?`,
        [id, userId],
        function (err) {
          if (err) {
            console.error('[RegularUpload] Error deleting record:', err.message);
            return reject(err);
          }
          resolve(this.changes > 0);
        }
      );
    });
  }
}

module.exports = RegularUpload;
