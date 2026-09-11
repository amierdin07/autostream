// Quick Notes & SEO Snippets Drawer Manager
(function () {
  let notesData = [];
  let currentCategory = 'all';
  let searchQuery = '';
  let editingNoteId = null;
  let searchDebounceTimeout = null;

  // Initialize once DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    initQuickNotes();
  });

  function initQuickNotes() {
    const drawer = document.getElementById('quick-notes-drawer');
    if (!drawer) return;

    // Search input listener
    const searchInput = document.getElementById('quick-notes-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimeout);
        searchDebounceTimeout = setTimeout(() => {
          searchQuery = e.target.value.trim();
          renderNotes();
        }, 200);
      });
    }

    // Category filter pills
    const filterButtons = document.querySelectorAll('.notes-category-pill');
    filterButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        filterButtons.forEach((b) => {
          b.classList.remove('bg-primary', 'text-white', 'border-primary');
          b.classList.add('bg-dark-700', 'text-gray-400', 'border-gray-700');
        });
        btn.classList.remove('bg-dark-700', 'text-gray-400', 'border-gray-700');
        btn.classList.add('bg-primary', 'text-white', 'border-primary');
        currentCategory = btn.getAttribute('data-category') || 'all';
        renderNotes();
      });
    });

    // Content counter listener
    const contentTextarea = document.getElementById('note-form-content');
    const categorySelect = document.getElementById('note-form-category');
    if (contentTextarea) {
      contentTextarea.addEventListener('input', updateContentCounters);
    }
    if (categorySelect) {
      categorySelect.addEventListener('change', updateContentCounters);
    }

    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const isDrawerOpen = !drawer.classList.contains('translate-x-full');
        if (isDrawerOpen) {
          closeQuickNotesDrawer();
        }
      }
    });
  }

  // Global functions exposed to window
  window.toggleQuickNotesDrawer = function () {
    const drawer = document.getElementById('quick-notes-drawer');
    const backdrop = document.getElementById('quick-notes-backdrop');
    if (!drawer || !backdrop) return;

    const isClosed = drawer.classList.contains('translate-x-full');
    if (isClosed) {
      openQuickNotesDrawer();
    } else {
      closeQuickNotesDrawer();
    }
  };

  window.openQuickNotesDrawer = function () {
    const drawer = document.getElementById('quick-notes-drawer');
    const backdrop = document.getElementById('quick-notes-backdrop');
    if (!drawer || !backdrop) return;

    backdrop.classList.remove('hidden');
    // Force reflow for smooth transition
    void backdrop.offsetWidth;
    backdrop.classList.remove('opacity-0');
    backdrop.classList.add('opacity-100');

    drawer.classList.remove('translate-x-full');
    drawer.classList.add('translate-x-0');

    // Fetch latest notes
    fetchNotes();
  };

  window.closeQuickNotesDrawer = function () {
    const drawer = document.getElementById('quick-notes-drawer');
    const backdrop = document.getElementById('quick-notes-backdrop');
    if (!drawer || !backdrop) return;

    drawer.classList.remove('translate-x-0');
    drawer.classList.add('translate-x-full');

    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0');

    setTimeout(() => {
      backdrop.classList.add('hidden');
    }, 300);
  };

  window.toggleNoteForm = function (show, noteId = null) {
    const formContainer = document.getElementById('quick-notes-form-container');
    const listContainer = document.getElementById('quick-notes-list-container');
    const formTitle = document.getElementById('note-form-header-title');
    const noteIdInput = document.getElementById('note-form-id');
    const titleInput = document.getElementById('note-form-title');
    const categorySelect = document.getElementById('note-form-category');
    const contentInput = document.getElementById('note-form-content');

    if (!formContainer || !listContainer) return;

    if (show) {
      editingNoteId = noteId;
      if (noteId) {
        // Edit mode
        const note = notesData.find((n) => n.id === noteId);
        if (note) {
          formTitle.textContent = 'Edit Catatan';
          noteIdInput.value = note.id;
          titleInput.value = note.title;
          categorySelect.value = note.category || 'general';
          contentInput.value = note.content;
        }
      } else {
        // Create mode
        formTitle.textContent = 'Tambah Catatan Baru';
        noteIdInput.value = '';
        titleInput.value = '';
        categorySelect.value = currentCategory !== 'all' ? currentCategory : 'general';
        contentInput.value = '';
      }

      updateContentCounters();
      formContainer.classList.remove('hidden');
      listContainer.classList.add('hidden');
      titleInput.focus();
    } else {
      editingNoteId = null;
      formContainer.classList.add('hidden');
      listContainer.classList.remove('hidden');
    }
  };

  window.saveQuickNote = async function (e) {
    if (e) e.preventDefault();
    const titleInput = document.getElementById('note-form-title');
    const categorySelect = document.getElementById('note-form-category');
    const contentInput = document.getElementById('note-form-content');
    const saveBtn = document.getElementById('note-form-save-btn');

    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    const category = categorySelect.value || 'general';

    if (!title) {
      alert('Judul catatan harus diisi!');
      titleInput.focus();
      return;
    }
    if (!content) {
      alert('Isi catatan tidak boleh kosong!');
      contentInput.focus();
      return;
    }

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="ti ti-loader animate-spin mr-1"></i> Menyimpan...';
      }

      let res;
      if (editingNoteId) {
        res = await fetch(`/api/notes/${editingNoteId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content, category })
        });
      } else {
        res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content, category })
        });
      }

      const result = await res.json();
      if (result.success) {
        await fetchNotes();
        toggleNoteForm(false);
      } else {
        alert(result.message || 'Gagal menyimpan catatan');
      }
    } catch (err) {
      console.error('Save note error:', err);
      alert('Terjadi kesalahan saat menyimpan catatan');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="ti ti-check mr-1"></i> Simpan Catatan';
      }
    }
  };

  window.deleteQuickNote = async function (id, event) {
    if (event) event.stopPropagation();
    if (!confirm('Yakin ingin menghapus catatan ini?')) return;

    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: 'DELETE'
      });
      const result = await res.json();
      if (result.success) {
        notesData = notesData.filter((n) => n.id !== id);
        renderNotes();
      } else {
        alert(result.message || 'Gagal menghapus catatan');
      }
    } catch (err) {
      console.error('Delete note error:', err);
      alert('Gagal menghapus catatan');
    }
  };

  window.copyNoteContent = async function (id, buttonEl, event) {
    if (event) event.stopPropagation();
    const note = notesData.find((n) => n.id === id);
    if (!note) return;

    try {
      await navigator.clipboard.writeText(note.content);
      const originalHTML = buttonEl.innerHTML;
      buttonEl.innerHTML = '<i class="ti ti-check text-green-400"></i> <span class="text-green-400">Tersalin!</span>';
      buttonEl.classList.add('bg-green-500/10', 'border-green-500/30');

      setTimeout(() => {
        buttonEl.innerHTML = originalHTML;
        buttonEl.classList.remove('bg-green-500/10', 'border-green-500/30');
      }, 1800);
    } catch (err) {
      console.error('Clipboard copy error:', err);
      // Fallback copy
      const tempTextArea = document.createElement('textarea');
      tempTextArea.value = note.content;
      document.body.appendChild(tempTextArea);
      tempTextArea.select();
      document.execCommand('copy');
      document.body.removeChild(tempTextArea);

      const originalHTML = buttonEl.innerHTML;
      buttonEl.innerHTML = '<i class="ti ti-check text-green-400"></i> <span class="text-green-400">Tersalin!</span>';
      setTimeout(() => {
        buttonEl.innerHTML = originalHTML;
      }, 1800);
    }
  };

  async function fetchNotes() {
    const listContainer = document.getElementById('quick-notes-cards');
    if (!listContainer) return;

    try {
      const res = await fetch('/api/notes');
      const data = await res.json();
      if (data.success) {
        notesData = data.notes || [];
        renderNotes();
      }
    } catch (err) {
      console.error('Fetch notes error:', err);
      listContainer.innerHTML = `
        <div class="text-center py-10 text-red-400 text-sm">
          <i class="ti ti-alert-circle text-2xl mb-1 block"></i>
          Gagal memuat catatan.
        </div>
      `;
    }
  }

  function renderNotes() {
    const listContainer = document.getElementById('quick-notes-cards');
    const emptyState = document.getElementById('quick-notes-empty');
    const notesCountBadge = document.getElementById('quick-notes-total-badge');
    if (!listContainer) return;

    let filtered = notesData;

    // Filter by category
    if (currentCategory && currentCategory !== 'all') {
      filtered = filtered.filter((n) => (n.category || 'general') === currentCategory);
    }

    // Filter by search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (n) => (n.title && n.title.toLowerCase().includes(q)) || (n.content && n.content.toLowerCase().includes(q))
      );
    }

    if (notesCountBadge) {
      notesCountBadge.textContent = `${filtered.length} Catatan`;
    }

    if (filtered.length === 0) {
      listContainer.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    listContainer.innerHTML = filtered
      .map((note) => {
        const categoryBadge = getCategoryBadge(note.category);
        const charCount = note.content ? note.content.length : 0;
        const tagCount = note.category === 'tags' && note.content ? note.content.split(',').filter(t => t.trim()).length : null;

        // Escape HTML
        const safeTitle = escapeHTML(note.title);
        const safeContent = escapeHTML(note.content);

        return `
          <div class="bg-dark-700/80 hover:bg-dark-700 border border-gray-700/70 hover:border-gray-600 rounded-xl p-4 transition-all duration-200 shadow-sm group">
            <div class="flex items-start justify-between gap-3 mb-2.5">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                  ${categoryBadge}
                  <span class="text-[11px] text-gray-400">
                    ${formatTimeAgo(note.updated_at || note.created_at)}
                  </span>
                </div>
                <h4 class="font-semibold text-white text-sm truncate" title="${safeTitle}">
                  ${safeTitle}
                </h4>
              </div>
              <div class="flex items-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button type="button" onclick="copyNoteContent('${note.id}', this, event)"
                  class="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-dark-800 hover:bg-dark-600 border border-gray-600/70 text-gray-200 hover:text-white transition-all shadow-sm active:scale-95"
                  title="Salin ke Clipboard">
                  <i class="ti ti-copy text-sm"></i>
                  <span>Salin</span>
                </button>
                <button type="button" onclick="toggleNoteForm(true, '${note.id}')"
                  class="p-1.5 rounded-lg bg-dark-800 hover:bg-dark-600 border border-gray-600/70 text-gray-300 hover:text-white transition-colors"
                  title="Edit Catatan">
                  <i class="ti ti-edit text-sm"></i>
                </button>
                <button type="button" onclick="deleteQuickNote('${note.id}', event)"
                  class="p-1.5 rounded-lg bg-dark-800 hover:bg-red-500/20 border border-gray-600/70 text-gray-300 hover:text-red-400 transition-colors"
                  title="Hapus Catatan">
                  <i class="ti ti-trash text-sm"></i>
                </button>
              </div>
            </div>

            <div class="relative bg-dark-900/90 rounded-lg p-3 border border-gray-800 font-mono text-xs text-gray-300 max-h-36 overflow-y-auto whitespace-pre-wrap select-all leading-relaxed custom-scrollbar">
              ${safeContent}
            </div>

            <div class="flex items-center justify-between mt-2 pt-2 border-t border-gray-700/40 text-[11px] text-gray-400">
              <span>${charCount} karakter ${tagCount !== null ? `• ${tagCount} tags` : ''}</span>
              <span class="text-gray-400 italic">Klik kotak isi untuk select all</span>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function updateContentCounters() {
    const contentInput = document.getElementById('note-form-content');
    const categorySelect = document.getElementById('note-form-category');
    const counterEl = document.getElementById('note-form-char-count');
    if (!contentInput || !counterEl) return;

    const len = contentInput.value.length;
    const cat = categorySelect ? categorySelect.value : 'general';

    if (cat === 'tags') {
      const tagCount = contentInput.value.split(',').filter(t => t.trim()).length;
      counterEl.textContent = `${len}/500 karakter • ${tagCount} tags (pisahkan dengan koma)`;
      counterEl.className = len > 500 ? 'text-xs text-red-400 font-medium' : 'text-xs text-gray-400';
    } else if (cat === 'description') {
      counterEl.textContent = `${len}/5000 karakter (Batas YouTube)`;
      counterEl.className = len > 5000 ? 'text-xs text-red-400 font-medium' : 'text-xs text-gray-400';
    } else if (cat === 'title') {
      counterEl.textContent = `${len}/100 karakter (Batas YouTube)`;
      counterEl.className = len > 100 ? 'text-xs text-red-400 font-medium' : 'text-xs text-gray-400';
    } else {
      counterEl.textContent = `${len} karakter`;
      counterEl.className = 'text-xs text-gray-400';
    }
  }

  function getCategoryBadge(category) {
    switch (category) {
      case 'description':
        return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30"><i class="ti ti-file-description"></i> Deskripsi</span>';
      case 'tags':
        return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30"><i class="ti ti-tags"></i> Tags</span>';
      case 'title':
        return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30"><i class="ti ti-heading"></i> Judul</span>';
      default:
        return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-500/15 text-gray-300 border border-gray-500/30"><i class="ti ti-notes"></i> Umum</span>';
    }
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffSeconds = Math.floor((now - date) / 1000);

    if (diffSeconds < 60) return 'Baru saja';
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes} mnt lalu`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} jam lalu`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays} hr lalu`;

    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
