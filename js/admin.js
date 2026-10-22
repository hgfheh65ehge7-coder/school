/* =============================================
   كتبي — لوحة تحكم وإدارة المحتوى للمشرف
   Kutubi Platform — Admin Control Dashboard Logic
   ============================================= */
'use strict';

const ADMIN_PIN_KEY = 'kutubi_admin_pin';
const DEFAULT_PIN = '1234';
const BOOK_OVERRIDES_KEY = 'kutubi_book_overrides';

const adminState = {
  data: null,
  activeGradeId: 'grade-7',
  searchQuery: '',
  theme: localStorage.getItem('kutubi-theme') || 'light',
  currentEditingBook: null,
  currentEditingPdf: null,
};

// =================== PDF Storage Manager ===================
const PDFStorage = {
  dbName: 'KutubiPDFStorage',
  storeName: 'books_pdf',
  db: null,
  objectUrls: {},

  async init() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' });
        }
      };
      req.onsuccess = async (e) => {
        this.db = e.target.result;
        await this.preloadBlobs();
        resolve(this.db);
      };
      req.onerror = () => resolve(null);
    });
  },

  preloadBlobs() {
    return new Promise((resolve) => {
      if (!this.db) { resolve(); return; }
      try {
        const tx = this.db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.getAll();
        req.onsuccess = () => {
          const items = req.result || [];
          items.forEach(item => {
            if (item && item.blob) {
              this.objectUrls[item.key] = URL.createObjectURL(item.blob);
            }
          });
          resolve();
        };
        req.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  },

  getRegistry() {
    try { return JSON.parse(localStorage.getItem('kutubi_pdf_registry') || '{}'); }
    catch { return {}; }
  },

  setRegistry(reg) {
    localStorage.setItem('kutubi_pdf_registry', JSON.stringify(reg));
  },

  async saveFile(bookId, partNum, file) {
    const key = `${bookId}_p${partNum}`;
    const fileSizeFormatted = formatBytes(file.size);
    const item = {
      key,
      bookId,
      partNum,
      type: 'file',
      fileName: file.name,
      fileSize: fileSizeFormatted,
      blob: file,
      updatedAt: Date.now()
    };

    if (this.db) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    if (this.objectUrls[key]) {
      URL.revokeObjectURL(this.objectUrls[key]);
    }
    this.objectUrls[key] = URL.createObjectURL(file);

    const reg = this.getRegistry();
    reg[key] = {
      type: 'file',
      fileName: file.name,
      fileSize: fileSizeFormatted,
      hasBlob: true,
      updatedAt: Date.now()
    };
    this.setRegistry(reg);
    return item;
  },

  async saveUrl(bookId, partNum, url, customFileName) {
    const key = `${bookId}_p${partNum}`;
    const cleanUrl = url.trim();

    if (this.db) {
      try {
        const tx = this.db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).delete(key);
      } catch (e) {}
    }
    if (this.objectUrls[key]) {
      URL.revokeObjectURL(this.objectUrls[key]);
      delete this.objectUrls[key];
    }

    const reg = this.getRegistry();
    reg[key] = {
      type: 'url',
      url: cleanUrl,
      fileName: customFileName || '',
      updatedAt: Date.now()
    };
    this.setRegistry(reg);
  },

  async removePdf(bookId, partNum) {
    const key = `${bookId}_p${partNum}`;
    const reg = this.getRegistry();
    delete reg[key];
    this.setRegistry(reg);

    if (this.db) {
      try {
        const tx = this.db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).delete(key);
      } catch (e) {}
    }
    if (this.objectUrls[key]) {
      URL.revokeObjectURL(this.objectUrls[key]);
      delete this.objectUrls[key];
    }
  },

  getPartPdfInfo(bookId, partNum, defaultPart = {}) {
    const key = `${bookId}_p${partNum}`;
    const reg = this.getRegistry();
    const entry = reg[key];

    if (entry) {
      if (entry.type === 'file') {
        const objUrl = this.objectUrls[key];
        return {
          hasPdf: true,
          type: 'file',
          openUrl: objUrl || '#',
          downloadUrl: objUrl || '#',
          fileName: entry.fileName || `${defaultPart.fileName || 'book'}.pdf`,
          fileSize: entry.fileSize || ''
        };
      } else if (entry.type === 'url' && entry.url) {
        return {
          hasPdf: true,
          type: 'url',
          openUrl: entry.url,
          downloadUrl: entry.url,
          fileName: entry.fileName || defaultPart.fileName || 'book.pdf',
          fileSize: ''
        };
      }
    }

    if (defaultPart && defaultPart.openUrl && defaultPart.openUrl.trim() !== '') {
      return {
        hasPdf: true,
        type: 'default',
        openUrl: defaultPart.openUrl,
        downloadUrl: defaultPart.downloadUrl || defaultPart.openUrl,
        fileName: defaultPart.fileName || 'book.pdf',
        fileSize: ''
      };
    }

    return { hasPdf: false };
  }
};

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// =================== Overrides Management ===================
function getBookOverrides() {
  try { return JSON.parse(localStorage.getItem(BOOK_OVERRIDES_KEY) || '{}'); }
  catch { return {}; }
}

function saveBookOverrides(overrides) {
  localStorage.setItem(BOOK_OVERRIDES_KEY, JSON.stringify(overrides));
}

function applyBookOverrides() {
  const overrides = getBookOverrides();
  if (!adminState.data) return;

  adminState.data.grades.forEach(grade => {
    // Add custom added books
    if (Array.isArray(overrides[`_new_books_${grade.id}`])) {
      overrides[`_new_books_${grade.id}`].forEach(newBook => {
        if (!grade.books.some(b => b.id === newBook.id)) {
          grade.books.push(JSON.parse(JSON.stringify(newBook)));
        }
      });
    }

    // Filter deleted books
    if (Array.isArray(overrides[`_deleted_books_${grade.id}`])) {
      const deletedIds = overrides[`_deleted_books_${grade.id}`];
      grade.books = grade.books.filter(b => !deletedIds.includes(b.id));
    }

    // Apply per-book edits
    grade.books.forEach(book => {
      const key = book.id;
      if (overrides[key]) {
        const ov = overrides[key];
        if (ov.nameAr) book.nameAr = ov.nameAr;
        if (ov.subject) book.subject = ov.subject;
        if (typeof ov.partsCount === 'number' && ov.partsCount !== book.parts.length) {
          const current = book.parts.length;
          const target = ov.partsCount;
          if (target > current) {
            for (let i = current; i < target; i++) {
              const partNum = i + 1;
              book.parts.push({
                part: partNum,
                title: `${book.nameAr} — الجزء ${partNum === 1 ? 'الأول' : partNum === 2 ? 'الثاني' : 'الثالث'}`,
                openUrl: `pdf/${book.id}-p${partNum}.pdf`,
                downloadUrl: `pdf/${book.id}-p${partNum}.pdf`,
                fileName: `${book.nameAr} - الجزء ${partNum} - ${grade.nameAr}.pdf`,
                format: 'PDF',
                suggestedFileName: `${book.id}-p${partNum}.pdf`
              });
            }
          } else if (target < current) {
            book.parts = book.parts.slice(0, target);
          }
        }
      }
    });
  });
}

// =================== Authentication ===================
function checkAdminAuth() {
  const isAuth = sessionStorage.getItem('kutubi_admin_auth') === 'true';
  const lock = document.getElementById('admin-lock-screen');
  const app = document.getElementById('admin-app');

  if (isAuth) {
    if (lock) lock.style.display = 'none';
    if (app) app.style.display = 'block';
  } else {
    if (lock) lock.style.display = 'flex';
    if (app) app.style.display = 'none';
  }
}

function handleAdminLogin(e) {
  e.preventDefault();
  const input = document.getElementById('admin-passcode');
  const pin = input ? input.value.trim() : '';
  const expected = localStorage.getItem(ADMIN_PIN_KEY) || DEFAULT_PIN;

  if (pin === expected) {
    sessionStorage.setItem('kutubi_admin_auth', 'true');
    checkAdminAuth();
    showToast('تم تسجيل الدخول بنجاح! مرحباً بك في لوحة المشرف 🔓', 'success');
  } else {
    showToast('رمز المرور غير صحيح! الرمز الافتراضي هو 1234', 'error');
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}

function adminLogout() {
  sessionStorage.removeItem('kutubi_admin_auth');
  checkAdminAuth();
  showToast('تم قفل لوحة المشرف 🔒', 'info');
}

// =================== DOM Ready ===================
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(adminState.theme);
  await PDFStorage.init();
  await loadAdminData();
  applyBookOverrides();
  checkAdminAuth();
  renderAdminStats();
  renderGradeTabs();
  renderBooksList();
});

async function loadAdminData() {
  if (window.KUTUBI_DATA) {
    adminState.data = JSON.parse(JSON.stringify(window.KUTUBI_DATA));
    return;
  }
  try {
    const res = await fetch('./data.json');
    adminState.data = await res.json();
  } catch (e) {
    console.error('Failed to load data.json', e);
  }
}

// =================== Theme ===================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  adminState.theme = theme;
  localStorage.setItem('kutubi-theme', theme);
  const btn = document.getElementById('admin-theme-btn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  applyTheme(adminState.theme === 'light' ? 'dark' : 'light');
}

// =================== Admin Stats ===================
function renderAdminStats() {
  const container = document.getElementById('admin-stats-grid');
  if (!container || !adminState.data) return;

  const totalGrades = adminState.data.grades.length;
  let totalBooks = 0;
  let totalParts = 0;
  let readyPdfs = 0;

  adminState.data.grades.forEach(g => {
    totalBooks += g.books.length;
    g.books.forEach(b => {
      totalParts += b.parts.length;
      b.parts.forEach((p, idx) => {
        const pNum = typeof p.part === 'number' ? p.part : idx;
        const info = PDFStorage.getPartPdfInfo(b.id, pNum, p);
        if (info.hasPdf) readyPdfs++;
      });
    });
  });

  const overridesCount = Object.keys(getBookOverrides()).length;

  container.innerHTML = `
    <div class="admin-stat-card animate-in">
      <div class="admin-stat-icon">🏫</div>
      <div>
        <div class="admin-stat-value">${totalGrades}</div>
        <div class="admin-stat-label">المراحل الدراسية</div>
      </div>
    </div>
    <div class="admin-stat-card animate-in stagger-1">
      <div class="admin-stat-icon">📚</div>
      <div>
        <div class="admin-stat-value">${totalBooks}</div>
        <div class="admin-stat-label">المناهج الدراسية</div>
      </div>
    </div>
    <div class="admin-stat-card animate-in stagger-2">
      <div class="admin-stat-icon">📑</div>
      <div>
        <div class="admin-stat-value">${totalParts}</div>
        <div class="admin-stat-label">إجمالي الكتب والأجزاء</div>
      </div>
    </div>
    <div class="admin-stat-card animate-in stagger-3">
      <div class="admin-stat-icon" style="background:rgba(16,185,129,0.12)">✅</div>
      <div>
        <div class="admin-stat-value" style="color:#059669">${readyPdfs}</div>
        <div class="admin-stat-label">ملفات PDF الجاهزة</div>
      </div>
    </div>
    <div class="admin-stat-card animate-in stagger-4">
      <div class="admin-stat-icon" style="background:rgba(184,149,71,0.15)">✏️</div>
      <div>
        <div class="admin-stat-value" style="color:var(--brand-accent)">${overridesCount}</div>
        <div class="admin-stat-label">تعديلات المشرف المحفوظة</div>
      </div>
    </div>
  `;
}

// =================== Grade Tabs ===================
function renderGradeTabs() {
  const container = document.getElementById('admin-grade-tabs');
  if (!container || !adminState.data) return;

  container.innerHTML = adminState.data.grades.map(g => `
    <button class="admin-grade-tab ${g.id === adminState.activeGradeId ? 'active' : ''}"
            onclick="selectAdminGrade('${g.id}')">
      ${getGradeEmoji(g.order)} ${g.nameAr} (${g.books.length} مادة)
    </button>
  `).join('');
}

function selectAdminGrade(gradeId) {
  adminState.activeGradeId = gradeId;
  renderGradeTabs();
  renderBooksList();
}

function handleAdminSearch(query) {
  adminState.searchQuery = (query || '').trim().toLowerCase();
  renderBooksList();
}

// =================== Books List ===================
function renderBooksList() {
  const container = document.getElementById('admin-books-container');
  if (!container || !adminState.data) return;

  const grade = adminState.data.grades.find(g => g.id === adminState.activeGradeId);
  if (!grade) {
    container.innerHTML = '<p>المرحلة غير موجودة</p>';
    return;
  }

  let books = grade.books;
  if (adminState.searchQuery) {
    books = books.filter(b => 
      b.nameAr.toLowerCase().includes(adminState.searchQuery) ||
      b.subject.toLowerCase().includes(adminState.searchQuery)
    );
  }

  if (books.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-title">لا توجد كتب مطابقة لبحثك</div>
        <div class="empty-state-desc">جرّب كتابة اسم مادة أو اضغط على زر إضافة كتاب جديد</div>
      </div>
    `;
    return;
  }

  container.innerHTML = books.map((book, bIdx) => {
    const subj = adminState.data.subjects[book.subject] || { emoji: '📖', nameAr: book.nameAr };

    const partsHtml = book.parts.map((part, pIdx) => {
      const partNum = typeof part.part === 'number' ? part.part : pIdx;
      const pdfInfo = PDFStorage.getPartPdfInfo(book.id, partNum, part);

      let statusBadge = '';
      let testBtn = '';

      if (pdfInfo.hasPdf) {
        statusBadge = `<span class="admin-status-badge admin-status-available">✅ متوفر (${pdfInfo.type === 'file' ? 'ملف مرفوع' : 'رابط مباشر'})</span>`;
        testBtn = `
          <a href="${pdfInfo.openUrl}" target="_blank" class="btn-admin btn-admin-secondary" style="font-size:0.78rem; padding:0.35rem 0.75rem;">
            📖 فحص PDF
          </a>
        `;
      } else {
        statusBadge = `<span class="admin-status-badge admin-status-missing">⚠️ غير متوفر</span>`;
      }

      return `
        <div class="admin-part-row">
          <div class="admin-part-info">
            <span style="font-size:1.2rem">${part.part === 0 ? '📘' : (part.part === 1 ? '📗' : '📙')}</span>
            <div>
              <div class="admin-part-name">${part.title || `${book.nameAr} — جزء ${partNum}`}</div>
              <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.15rem;">
                اسم الملف: <code>${part.suggestedFileName || `${book.id}-p${partNum}.pdf`}</code>
              </div>
            </div>
            ${statusBadge}
          </div>

          <div class="admin-part-btns">
            ${testBtn}
            <button class="btn-admin btn-admin-primary" style="font-size:0.78rem; padding:0.35rem 0.75rem;"
                    onclick="openAdminPdfModal('${grade.id}', '${book.id}', ${partNum})">
              ⚙️ إدارة الـ PDF
            </button>
            ${pdfInfo.hasPdf ? `
              <button class="btn-admin btn-admin-danger" style="font-size:0.78rem; padding:0.35rem 0.65rem;"
                      onclick="confirmRemovePdf('${grade.id}', '${book.id}', ${partNum})"
                      title="إزالة الـ PDF لهذا الجزء">
                🗑️ إزالة
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    return `
      <article class="admin-book-card animate-in stagger-${Math.min(bIdx + 1, 6)}">
        <div class="admin-book-header">
          <div class="admin-book-title-wrap">
            <span style="font-size:1.6rem">${subj.emoji}</span>
            <div>
              <h3 class="admin-book-title">${book.nameAr}</h3>
              <div style="font-size:0.78rem; color:var(--text-muted);">
                المادة: <strong>${subj.nameAr || book.subject}</strong> • معرف: <code>${book.id}</code> • 
                عدد الأجزاء: <strong>${book.parts.length}</strong>
              </div>
            </div>
          </div>

          <div style="display:flex; gap:0.5rem; align-items:center;">
            <button class="btn-admin btn-admin-secondary" onclick="openAdminEditBookModal('${grade.id}', '${book.id}')">
              ✏️ تعديل بيانات الكتاب
            </button>
            <button class="btn-admin btn-admin-danger" onclick="confirmDeleteBook('${grade.id}', '${book.id}')" title="حذف هذا الكتاب من المرحلة">
              🗑️ حذف
            </button>
          </div>
        </div>

        <div class="admin-parts-list">
          ${partsHtml}
        </div>
      </article>
    `;
  }).join('');
}

// =================== Book Edit Modal ===================
function openAdminEditBookModal(gradeId, bookId) {
  const grade = adminState.data.grades.find(g => g.id === gradeId);
  if (!grade) return;
  const book = grade.books.find(b => b.id === bookId);
  if (!book) return;

  adminState.currentEditingBook = { gradeId, bookId, grade, book };
  const currentParts = book.parts.length;

  const subjectsOptions = Object.entries(adminState.data.subjects).map(([k, s]) => `
    <option value="${k}" ${book.subject === k ? 'selected' : ''}>${s.emoji} ${s.nameAr}</option>
  `).join('');

  const container = document.getElementById('admin-modal-container');
  container.innerHTML = `
    <div class="modal-overlay open" onclick="closeAdminModalOnOverlay(event)">
      <div class="modal-card" style="max-width:540px;" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div class="modal-header-titles">
            <div class="modal-header-icon">✏️</div>
            <div>
              <h3 class="modal-title">تعديل بيانات الكتاب</h3>
              <div class="modal-subtitle">${grade.nameAr} — ${book.nameAr}</div>
            </div>
          </div>
          <button class="modal-close-btn" onclick="closeAdminModal()">✕</button>
        </div>

        <div class="modal-body" style="padding:1.5rem; display:flex; flex-direction:column; gap:1.25rem;">
          <div>
            <label style="display:block; font-weight:700; font-size:0.88rem; margin-bottom:0.4rem; color:var(--text-primary);">
              اسم الكتاب (باللغة العربية):
            </label>
            <input type="text" id="edit-book-name" class="admin-lock-input" style="text-align:right; font-size:1rem;" value="${escapeHtml(book.nameAr)}">
          </div>

          <div>
            <label style="display:block; font-weight:700; font-size:0.88rem; margin-bottom:0.4rem; color:var(--text-primary);">
              المادة الدراسية:
            </label>
            <select id="edit-book-subject" class="admin-lock-input" style="text-align:right; font-size:0.95rem;">
              ${subjectsOptions}
            </select>
          </div>

          <div>
            <label style="display:block; font-weight:700; font-size:0.88rem; margin-bottom:0.5rem; color:var(--text-primary);">
              عدد أجزاء الكتاب المقررة:
            </label>
            <div style="display:flex; gap:0.6rem;">
              <button type="button" class="parts-btn ${currentParts === 1 ? 'active' : ''}" style="flex:1" onclick="setEditPartsCount(1)">
                كتاب جزء واحد (منهج كامل)
              </button>
              <button type="button" class="parts-btn ${currentParts === 2 ? 'active' : ''}" style="flex:1" onclick="setEditPartsCount(2)">
                كتاب من جزئين (أول وثاني)
              </button>
            </div>
            <input type="hidden" id="edit-parts-count" value="${currentParts}">
          </div>
        </div>

        <div class="modal-footer" style="padding:1.25rem 1.5rem; display:flex; justify-content:flex-end; gap:0.6rem; border-top:1px solid var(--border-subtle);">
          <button class="btn-admin btn-admin-secondary" onclick="closeAdminModal()">إلغاء</button>
          <button class="btn-admin btn-admin-primary" onclick="saveAdminBookEdit()">💾 حفظ التعديلات</button>
        </div>
      </div>
    </div>
  `;
}

function setEditPartsCount(n) {
  document.getElementById('edit-parts-count').value = n;
  const btns = document.querySelectorAll('#admin-modal-container .parts-btn');
  btns.forEach((btn, idx) => {
    btn.classList.toggle('active', (idx + 1) === n);
  });
}

function saveAdminBookEdit() {
  if (!adminState.currentEditingBook) return;
  const { gradeId, bookId, book } = adminState.currentEditingBook;

  const newName = document.getElementById('edit-book-name').value.trim();
  const newSubject = document.getElementById('edit-book-subject').value;
  const newPartsCount = parseInt(document.getElementById('edit-parts-count').value, 10);

  if (!newName) {
    showToast('يرجى كتابة اسم الكتاب', 'error');
    return;
  }

  const overrides = getBookOverrides();
  overrides[bookId] = {
    ...(overrides[bookId] || {}),
    nameAr: newName,
    subject: newSubject,
    partsCount: newPartsCount,
    updatedAt: Date.now()
  };
  saveBookOverrides(overrides);

  book.nameAr = newName;
  book.subject = newSubject;
  if (newPartsCount !== book.parts.length) {
    if (newPartsCount > book.parts.length) {
      for (let i = book.parts.length; i < newPartsCount; i++) {
        const pNum = i + 1;
        book.parts.push({
          part: pNum,
          title: `${newName} — الجزء ${pNum === 1 ? 'الأول' : 'الثاني'}`,
          openUrl: `pdf/${bookId}-p${pNum}.pdf`,
          downloadUrl: `pdf/${bookId}-p${pNum}.pdf`,
          fileName: `${newName} - الجزء ${pNum}.pdf`,
          format: 'PDF',
          suggestedFileName: `${bookId}-p${pNum}.pdf`
        });
      }
    } else {
      book.parts = book.parts.slice(0, newPartsCount);
    }
  }

  closeAdminModal();
  renderAdminStats();
  renderBooksList();
  showToast(`تم تحديث بيانات كتاب ${newName} بنجاح! ✅`, 'success');
}

// =================== Add Book Modal ===================
function openAddBookModal() {
  const grade = adminState.data.grades.find(g => g.id === adminState.activeGradeId);
  if (!grade) return;

  const subjectsOptions = Object.entries(adminState.data.subjects).map(([k, s]) => `
    <option value="${k}">${s.emoji} ${s.nameAr}</option>
  `).join('');

  const container = document.getElementById('admin-modal-container');
  container.innerHTML = `
    <div class="modal-overlay open" onclick="closeAdminModalOnOverlay(event)">
      <div class="modal-card" style="max-width:540px;" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div class="modal-header-titles">
            <div class="modal-header-icon">➕</div>
            <div>
              <h3 class="modal-title">إضافة كتاب جديد للمرحلة</h3>
              <div class="modal-subtitle">${grade.nameAr}</div>
            </div>
          </div>
          <button class="modal-close-btn" onclick="closeAdminModal()">✕</button>
        </div>

        <div class="modal-body" style="padding:1.5rem; display:flex; flex-direction:column; gap:1.25rem;">
          <div>
            <label style="display:block; font-weight:700; font-size:0.88rem; margin-bottom:0.4rem; color:var(--text-primary);">
              اسم المادة / الكتاب الجديد:
            </label>
            <input type="text" id="add-book-name" class="admin-lock-input" style="text-align:right; font-size:1rem;" placeholder="مثلاً: علم الأرض أو مبادئ الفلسفة">
          </div>

          <div>
            <label style="display:block; font-weight:700; font-size:0.88rem; margin-bottom:0.4rem; color:var(--text-primary);">
              المادة التابع لها:
            </label>
            <select id="add-book-subject" class="admin-lock-input" style="text-align:right; font-size:0.95rem;">
              ${subjectsOptions}
            </select>
          </div>

          <div>
            <label style="display:block; font-weight:700; font-size:0.88rem; margin-bottom:0.5rem; color:var(--text-primary);">
              عدد الأجزاء:
            </label>
            <div style="display:flex; gap:0.6rem;">
              <button type="button" class="parts-btn active" style="flex:1" onclick="setAddPartsCount(1)">
                جزء واحد (كامل)
              </button>
              <button type="button" class="parts-btn" style="flex:1" onclick="setAddPartsCount(2)">
                جزئين (أول وثاني)
              </button>
            </div>
            <input type="hidden" id="add-parts-count" value="1">
          </div>
        </div>

        <div class="modal-footer" style="padding:1.25rem 1.5rem; display:flex; justify-content:flex-end; gap:0.6rem; border-top:1px solid var(--border-subtle);">
          <button class="btn-admin btn-admin-secondary" onclick="closeAdminModal()">إلغاء</button>
          <button class="btn-admin btn-admin-primary" onclick="saveAdminAddBook('${grade.id}')">➕ إضافة الكتاب</button>
        </div>
      </div>
    </div>
  `;
}

function setAddPartsCount(n) {
  document.getElementById('add-parts-count').value = n;
  const btns = document.querySelectorAll('#admin-modal-container .parts-btn');
  btns.forEach((btn, idx) => {
    btn.classList.toggle('active', (idx + 1) === n);
  });
}

function saveAdminAddBook(gradeId) {
  const grade = adminState.data.grades.find(g => g.id === gradeId);
  if (!grade) return;

  const nameAr = document.getElementById('add-book-name').value.trim();
  const subject = document.getElementById('add-book-subject').value;
  const partsCount = parseInt(document.getElementById('add-parts-count').value, 10);

  if (!nameAr) {
    showToast('يرجى كتابة اسم الكتاب أولاً', 'error');
    return;
  }

  const bookId = `${grade.slug}-${subject}-${Date.now().toString().slice(-4)}`;
  const parts = [];
  for (let i = 1; i <= partsCount; i++) {
    const title = partsCount === 1 ? `${nameAr}` : `${nameAr} — الجزء ${i === 1 ? 'الأول' : 'الثاني'}`;
    const sFileName = `${bookId}-p${i}.pdf`;
    parts.push({
      part: partsCount === 1 ? 0 : i,
      title,
      openUrl: `pdf/${sFileName}`,
      downloadUrl: `pdf/${sFileName}`,
      fileName: `${title} - ${grade.nameAr}.pdf`,
      format: 'PDF',
      suggestedFileName: sFileName
    });
  }

  const newBook = {
    id: bookId,
    subject,
    nameAr,
    parts
  };

  grade.books.push(newBook);

  // Save to overrides
  const overrides = getBookOverrides();
  const listKey = `_new_books_${gradeId}`;
  overrides[listKey] = overrides[listKey] || [];
  overrides[listKey].push(newBook);
  saveBookOverrides(overrides);

  closeAdminModal();
  renderAdminStats();
  renderBooksList();
  showToast(`تمت إضافة كتاب ${nameAr} بنجاح! ✨`, 'success');
}

// =================== Delete Book ===================
function confirmDeleteBook(gradeId, bookId) {
  const grade = adminState.data.grades.find(g => g.id === gradeId);
  if (!grade) return;
  const book = grade.books.find(b => b.id === bookId);
  if (!book) return;

  if (confirm(`هل أنت متأكد من حذف كتاب "${book.nameAr}" من ${grade.nameAr}؟`)) {
    grade.books = grade.books.filter(b => b.id !== bookId);

    const overrides = getBookOverrides();
    const delKey = `_deleted_books_${gradeId}`;
    overrides[delKey] = overrides[delKey] || [];
    if (!overrides[delKey].includes(bookId)) {
      overrides[delKey].push(bookId);
    }
    // Also remove from new books if was added before
    const newKey = `_new_books_${gradeId}`;
    if (Array.isArray(overrides[newKey])) {
      overrides[newKey] = overrides[newKey].filter(b => b.id !== bookId);
    }
    delete overrides[bookId];
    saveBookOverrides(overrides);

    renderAdminStats();
    renderBooksList();
    showToast(`تم حذف كتاب ${book.nameAr} بنجاح`, 'info');
  }
}

// =================== PDF Management Modal ===================
function openAdminPdfModal(gradeId, bookId, partNum) {
  const grade = adminState.data.grades.find(g => g.id === gradeId);
  if (!grade) return;
  const book = grade.books.find(b => b.id === bookId);
  if (!book) return;
  const part = book.parts.find(p => (typeof p.part === 'number' ? p.part : 0) === partNum) || book.parts[0];

  adminState.currentEditingPdf = { gradeId, bookId, partNum, grade, book, part };
  const pdfInfo = PDFStorage.getPartPdfInfo(bookId, partNum, part);

  const container = document.getElementById('admin-modal-container');
  container.innerHTML = `
    <div class="modal-overlay open" onclick="closeAdminModalOnOverlay(event)">
      <div class="modal-card" style="max-width:580px;" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div class="modal-header-titles">
            <div class="modal-header-icon">📑</div>
            <div>
              <h3 class="modal-title">إدارة ملف الـ PDF</h3>
              <div class="modal-subtitle">${grade.nameAr} — ${book.nameAr} (${part.title || 'الكتاب'})</div>
            </div>
          </div>
          <button class="modal-close-btn" onclick="closeAdminModal()">✕</button>
        </div>

        <div class="modal-body" style="padding:1.5rem; display:flex; flex-direction:column; gap:1.25rem;">
          
          <div class="modal-tabs" style="display:flex; gap:0.5rem; border-bottom:1.5px solid var(--border-color); padding-bottom:0.75rem;">
            <button class="modal-tab-btn active" id="tab-btn-upload" onclick="switchAdminPdfTab('upload')">
              📤 رفع ملف PDF من الكمبيوتر
            </button>
            <button class="modal-tab-btn" id="tab-btn-url" onclick="switchAdminPdfTab('url')">
              🔗 رابط خارجي مباشر
            </button>
          </div>

          <!-- Tab 1: Upload -->
          <div id="tab-panel-upload" class="modal-tab-panel">
            <div class="dropzone" id="admin-dropzone" onclick="document.getElementById('admin-pdf-input').click()">
              <div class="dropzone-icon">📥</div>
              <div class="dropzone-text">اضغط هنا لاختيار ملف PDF من جهازك أو اسحبه وأفلته هنا</div>
              <div class="dropzone-sub">يدعم ملفات بصيغة .pdf</div>
              <input type="file" id="admin-pdf-input" accept=".pdf,application/pdf" style="display:none" onchange="handleAdminFileSelected(this)">
            </div>
            <div id="admin-file-preview" style="margin-top:0.75rem; font-size:0.85rem; font-weight:700; color:var(--brand-primary);"></div>
          </div>

          <!-- Tab 2: URL -->
          <div id="tab-panel-url" class="modal-tab-panel" style="display:none">
            <label style="display:block; font-weight:700; font-size:0.88rem; margin-bottom:0.4rem; color:var(--text-primary);">
              أدخل رابط ملف الـ PDF (رابط مباشر، Google Drive، Telegram، أو موقع الوزارة):
            </label>
            <input type="url" id="admin-pdf-url" class="admin-lock-input" style="text-align:left; direction:ltr; font-size:0.95rem;" 
                   placeholder="https://example.com/book.pdf" 
                   value="${pdfInfo.type === 'url' ? escapeHtml(pdfInfo.openUrl) : (pdfInfo.hasPdf ? escapeHtml(pdfInfo.openUrl) : '')}">
          </div>

          <div style="background:var(--bg-card-hover); padding:0.85rem 1rem; border-radius:var(--radius-md); font-size:0.82rem; color:var(--text-secondary); line-height:1.6;">
            💡 <strong>المسار القياسي المقترح:</strong> <code>pdf/${part.suggestedFileName || `${book.id}-p${partNum}.pdf`}</code><br>
            يمكنك رفع الملف مباشرة أو وضع رابط يعمل عبر الإنترنت.
          </div>

        </div>

        <div class="modal-footer" style="padding:1.25rem 1.5rem; display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-subtle);">
          <div>
            ${pdfInfo.hasPdf ? `
              <a href="${pdfInfo.openUrl}" target="_blank" class="btn-admin btn-admin-secondary" style="font-size:0.8rem">
                📖 معاينة الملف الحالي
              </a>
            ` : ''}
          </div>
          <div style="display:flex; gap:0.6rem;">
            <button class="btn-admin btn-admin-secondary" onclick="closeAdminModal()">إلغاء</button>
            <button class="btn-admin btn-admin-primary" onclick="saveAdminPdfModal()">💾 حفظ التعديل</button>
          </div>
        </div>
      </div>
    </div>
  `;

  initAdminDropzone();
}

let activePdfTab = 'upload';
let selectedPdfFile = null;

function switchAdminPdfTab(tab) {
  activePdfTab = tab;
  document.getElementById('tab-btn-upload').classList.toggle('active', tab === 'upload');
  document.getElementById('tab-btn-url').classList.toggle('active', tab === 'url');
  document.getElementById('tab-panel-upload').style.display = tab === 'upload' ? 'block' : 'none';
  document.getElementById('tab-panel-url').style.display = tab === 'url' ? 'block' : 'none';
}

function handleAdminFileSelected(input) {
  if (input.files && input.files[0]) {
    selectedPdfFile = input.files[0];
    const preview = document.getElementById('admin-file-preview');
    if (preview) {
      preview.textContent = `✅ تم اختيار الملف: ${selectedPdfFile.name} (${formatBytes(selectedPdfFile.size)})`;
    }
  }
}

function initAdminDropzone() {
  const zone = document.getElementById('admin-dropzone');
  if (!zone) return;
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('dragover'); };
  zone.ondragleave = () => { zone.classList.remove('dragover'); };
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      selectedPdfFile = e.dataTransfer.files[0];
      const preview = document.getElementById('admin-file-preview');
      if (preview) {
        preview.textContent = `✅ تم اختيار الملف: ${selectedPdfFile.name} (${formatBytes(selectedPdfFile.size)})`;
      }
    }
  };
}

async function saveAdminPdfModal() {
  if (!adminState.currentEditingPdf) return;
  const { bookId, partNum, part } = adminState.currentEditingPdf;

  if (activePdfTab === 'upload') {
    if (!selectedPdfFile) {
      showToast('يرجى اختيار ملف PDF أولاً من جهازك', 'error');
      return;
    }
    await PDFStorage.saveFile(bookId, partNum, selectedPdfFile);
    showToast(`تم حفظ وتخزين ملف ${selectedPdfFile.name} بنجاح! 📕`, 'success');
  } else {
    const url = document.getElementById('admin-pdf-url').value.trim();
    if (!url) {
      showToast('يرجى إدخال الرابط', 'error');
      return;
    }
    await PDFStorage.saveUrl(bookId, partNum, url, part.suggestedFileName);
    showToast(`تم حفظ رابط الـ PDF بنجاح! 🔗`, 'success');
  }

  selectedPdfFile = null;
  closeAdminModal();
  renderAdminStats();
  renderBooksList();
}

async function confirmRemovePdf(gradeId, bookId, partNum) {
  if (confirm('هل أنت متأكد من إزالة ملف الـ PDF لهذا الجزء؟')) {
    await PDFStorage.removePdf(bookId, partNum);
    renderAdminStats();
    renderBooksList();
    showToast('تمت إزالة ملف الـ PDF', 'info');
  }
}

// =================== Modal Helpers ===================
function closeAdminModal() {
  const container = document.getElementById('admin-modal-container');
  if (container) container.innerHTML = '';
  adminState.currentEditingBook = null;
  adminState.currentEditingPdf = null;
  selectedPdfFile = null;
}

function closeAdminModalOnOverlay(e) {
  if (e.target.classList.contains('modal-overlay')) {
    closeAdminModal();
  }
}

// =================== Export to GitHub ===================
function openExportModal() {
  const reg = PDFStorage.getRegistry();
  const exported = JSON.parse(JSON.stringify(adminState.data));

  exported.grades.forEach(g => {
    g.books.forEach(b => {
      b.parts.forEach((p, idx) => {
        const partNum = typeof p.part === 'number' ? p.part : idx;
        const key = `${b.id}_p${partNum}`;
        const entry = reg[key];
        if (entry) {
          if (entry.type === 'url' && entry.url) {
            p.openUrl = entry.url;
            p.downloadUrl = entry.url;
          } else if (entry.type === 'file') {
            const path = `pdf/${p.suggestedFileName || entry.fileName}`;
            p.openUrl = path;
            p.downloadUrl = path;
          }
        }
      });
    });
  });

  const jsonStr = JSON.stringify(exported, null, 2);
  const jsStr = `window.KUTUBI_DATA = ${jsonStr};`;

  const container = document.getElementById('admin-modal-container');
  container.innerHTML = `
    <div class="modal-overlay open" onclick="closeAdminModalOnOverlay(event)">
      <div class="modal-card" style="max-width:620px;" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div class="modal-header-titles">
            <div class="modal-header-icon">🚀</div>
            <div>
              <h3 class="modal-title">تصدير التحديثات لـ GitHub</h3>
              <div class="modal-subtitle">نشر كافة تعديلات المشرف للمستخدمين والطلاب عالمياً</div>
            </div>
          </div>
          <button class="modal-close-btn" onclick="closeAdminModal()">✕</button>
        </div>

        <div class="modal-body" style="padding:1.5rem; display:flex; flex-direction:column; gap:1.25rem;">
          
          <div style="background:var(--bg-card); border:1.5px solid var(--border-color); border-radius:var(--radius-md); padding:1.25rem;">
            <h4 style="font-size:1.05rem; font-weight:800; color:var(--brand-primary); margin-bottom:0.75rem;">
              📥 خطوة 1: تحميل ملفات البيانات المحدثة
            </h4>
            <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
              <button class="btn-admin btn-admin-success" onclick="downloadFile('data.json', ${JSON.stringify(jsonStr)})">
                ⬇️ تحميل data.json
              </button>
              <button class="btn-admin btn-admin-primary" onclick="downloadFile('data.js', ${JSON.stringify(jsStr)})">
                ⬇️ تحميل js/data.js
              </button>
            </div>
          </div>

          <div style="background:var(--bg-card-hover); border-radius:var(--radius-md); padding:1.25rem;">
            <h4 style="font-size:1.05rem; font-weight:800; color:var(--text-primary); margin-bottom:0.75rem;">
              🌐 خطوة 2: رفعها إلى مستودع GitHub
            </h4>
            
            <div class="export-guide-step">
              <div class="export-step-num">1</div>
              <div class="export-step-text">
                افتح مستودعك على GitHub: <strong>github.com/hgfheh65ehge7-coder/schoolweb</strong>
              </div>
            </div>

            <div class="export-guide-step">
              <div class="export-step-num">2</div>
              <div class="export-step-text">
                اسحب ملف <strong>data.json</strong> وضعه في المسار الرئيسي، واسحب <strong>data.js</strong> إلى مجلد <strong>js/</strong>.
              </div>
            </div>

            <div class="export-guide-step">
              <div class="export-step-num">3</div>
              <div class="export-step-text">
                اضغط على زر <strong>Commit Changes</strong> وسيتحدث موقع الطلاب مباشرة لجميع الزوار!
              </div>
            </div>

          </div>

        </div>

        <div class="modal-footer" style="padding:1.25rem 1.5rem; display:flex; justify-content:flex-end; gap:0.6rem; border-top:1px solid var(--border-subtle);">
          <button class="btn-admin btn-admin-primary" onclick="closeAdminModal()">تم، إغلاق النافذة</button>
        </div>
      </div>
    </div>
  `;
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: filename.endsWith('.json') ? 'application/json' : 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`تم تنزيل ملف ${filename} بنجاح! 📥`, 'success');
}

// =================== Reset Overrides ===================
function confirmResetOverrides() {
  if (confirm('هل أنت متأكد من إعادة ضبط كافة التعديلات والمناهج المحفوظة للوضع الأصلي الافتراضي؟')) {
    localStorage.removeItem(BOOK_OVERRIDES_KEY);
    localStorage.removeItem('kutubi_pdf_registry');
    window.location.reload();
  }
}

// =================== Toast Notifications ===================
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
  toast.innerHTML = `<span class="toast-icon">${icon}</span> <span class="toast-msg">${message}</span>`;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

function getGradeEmoji(order) {
  const emojis = ['📗', '📘', '📙', '🔬', '🧪', '🎓'];
  return emojis[order - 1] || '📚';
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
