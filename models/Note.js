const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');

class Note {
  static create({ userId, title, content, category = 'general' }) {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      const now = new Date().toISOString();
      const cleanCategory = category ? category.trim().toLowerCase() : 'general';

      db.run(
        `INSERT INTO user_notes (id, user_id, title, content, category, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, title.trim(), content.trim(), cleanCategory, now, now],
        function (err) {
          if (err) {
            console.error('Error creating note:', err.message);
            return reject(err);
          }
          resolve({
            id,
            user_id: userId,
            title: title.trim(),
            content: content.trim(),
            category: cleanCategory,
            created_at: now,
            updated_at: now
          });
        }
      );
    });
  }

  static findAll(userId, { search = '', category = '' } = {}) {
    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM user_notes WHERE user_id = ?`;
      const params = [userId];

      if (category && category !== 'all') {
        query += ` AND category = ?`;
        params.push(category.trim().toLowerCase());
      }

      if (search && search.trim() !== '') {
        query += ` AND (title LIKE ? OR content LIKE ?)`;
        const term = `%${search.trim()}%`;
        params.push(term, term);
      }

      query += ` ORDER BY updated_at DESC`;

      db.all(query, params, (err, rows) => {
        if (err) {
          console.error('Error fetching notes:', err.message);
          return reject(err);
        }
        resolve(rows || []);
      });
    });
  }

  static findById(id, userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM user_notes WHERE id = ? AND user_id = ?`,
        [id, userId],
        (err, row) => {
          if (err) {
            console.error('Error fetching note by id:', err.message);
            return reject(err);
          }
          resolve(row || null);
        }
      );
    });
  }

  static update(id, userId, { title, content, category }) {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      const updates = [];
      const params = [];

      if (title !== undefined) {
        updates.push('title = ?');
        params.push(title.trim());
      }
      if (content !== undefined) {
        updates.push('content = ?');
        params.push(content.trim());
      }
      if (category !== undefined) {
        updates.push('category = ?');
        params.push(category.trim().toLowerCase());
      }

      if (updates.length === 0) {
        return resolve(null);
      }

      updates.push('updated_at = ?');
      params.push(now);

      params.push(id, userId);

      const query = `UPDATE user_notes SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`;

      db.run(query, params, function (err) {
        if (err) {
          console.error('Error updating note:', err.message);
          return reject(err);
        }
        if (this.changes === 0) {
          return resolve(null);
        }
        Note.findById(id, userId).then(resolve).catch(reject);
      });
    });
  }

  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM user_notes WHERE id = ? AND user_id = ?`,
        [id, userId],
        function (err) {
          if (err) {
            console.error('Error deleting note:', err.message);
            return reject(err);
          }
          resolve(this.changes > 0);
        }
      );
    });
  }
}

module.exports = Note;
