const $ = selector => document.querySelector(selector);
const pageRole = document.body.dataset.role;
let currentUser = null;
let allReports = [];
let editingReportId = null;
let reportSubmitting = false;
let userSubmitting = false;
let currentReportPage = 1;
const reportsPerPage = 6;
const dateInput = $('#tanggal');
let noticeTimer;
dateInput.value = new Date().toLocaleDateString('en-CA');
$('#todayLabel').textContent = new Intl.DateTimeFormat('id-ID', { dateStyle: 'full' }).format(new Date());

if (pageRole === 'admin' || pageRole === 'user') {
  const themeToggle = $('#themeToggle');
  const themeStorageKey = `laporan-pa-${pageRole}-theme`;
  const setDarkMode = enabled => {
    document.body.classList.toggle('dark-mode', enabled);
    themeToggle.setAttribute('aria-pressed', String(enabled));
    themeToggle.setAttribute('aria-label', enabled ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
    themeToggle.title = enabled ? 'Aktifkan mode terang' : 'Aktifkan mode gelap';
    themeToggle.querySelector('span').textContent = enabled ? '☀' : '☾';
  };

  setDarkMode(localStorage.getItem(themeStorageKey) === 'dark');
  themeToggle.addEventListener('click', () => {
    const enabled = !document.body.classList.contains('dark-mode');
    setDarkMode(enabled);
    localStorage.setItem(themeStorageKey, enabled ? 'dark' : 'light');
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || 'Permintaan gagal.');
  return data;
}

function showNotice(message, type = 'success') {
  const box = $('#notice');
  const icon = box.querySelector('.notice-icon');
  const text = box.querySelector('.notice-message');
  const isError = type === 'error';
  icon.textContent = isError ? '!' : '✓';
  text.textContent = message;
  box.classList.toggle('notice-error', isError);
  box.classList.toggle('notice-success', !isError);
  box.setAttribute('role', isError ? 'alert' : 'status');
  box.classList.remove('hidden');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => box.classList.add('hidden'), 4200);
}

function confirmAction({ title, message, detail = '', confirmLabel = 'Ya, hapus' }) {
  const dialog = $('#confirmDialog');
  const detailBox = $('#confirmDetail');
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  detailBox.textContent = detail;
  detailBox.classList.toggle('hidden', !detail);
  $('#confirmAcceptBtn').textContent = confirmLabel;

  return new Promise(resolve => {
    const handleClose = () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
      $('#confirmCancelBtn').removeEventListener('click', handleCancelClick);
      $('#confirmAcceptBtn').removeEventListener('click', handleConfirm);
      resolve(dialog.returnValue === 'confirm');
    };
    const handleCancel = () => {
      dialog.returnValue = 'cancel';
    };
    const handleCancelClick = () => dialog.close('cancel');
    const handleConfirm = () => {
      dialog.close('confirm');
    };

    dialog.returnValue = 'cancel';
    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('cancel', handleCancel);
    $('#confirmCancelBtn').addEventListener('click', handleCancelClick);
    $('#confirmAcceptBtn').addEventListener('click', handleConfirm);
    dialog.showModal();
  });
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function renderAttachment(report) {
  if (!report.attachment) return '<span class="report-meta">Tidak ada lampiran</span>';

  const attachment = report.attachment;
  const extension = String(attachment.filename || attachment.name || '')
    .split('.')
    .pop()
    .toLowerCase();
  const previewUrl = `/api/reports/${encodeURIComponent(report.id)}/preview`;
  const downloadUrl = `/api/reports/${encodeURIComponent(report.id)}/file`;
  const details = `<span class="attachment-name">${esc(attachment.name)} <small>${(attachment.size / 1024).toFixed(0)} KB</small></span>`;
  const download = `<a class="attachment-download" href="${downloadUrl}" download>Unduh</a>`;

  if (['png', 'jpg', 'jpeg'].includes(extension)) {
    return `<div class="attachment-item"><a class="attachment-preview image-preview" href="${previewUrl}" target="_blank" rel="noopener"><img src="${previewUrl}" alt="Pratinjau ${esc(attachment.name)}" loading="lazy"></a><div class="attachment-info">${details}${download}</div></div>`;
  }

  if (extension === 'pdf') {
    return `<div class="attachment-item pdf-attachment"><span class="file-type-icon" aria-hidden="true">PDF</span><div class="attachment-info">${details}<div class="attachment-links"><a class="attachment-preview" href="${previewUrl}" target="_blank" rel="noopener">Lihat PDF</a>${download}</div></div></div>`;
  }

  return `<div class="attachment-item document-attachment"><span class="file-type-icon" aria-hidden="true">FILE</span><div class="attachment-info">${details}${download}</div></div>`;
}

function reportFilename(report, extension) {
  const safeName = String(report.paName || 'laporan')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'laporan';
  return `laporan-${safeName}-${report.tanggal}.${extension}`;
}

function wrapCanvasText(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text || '-').split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

function saveReportJpg(report) {
  const width = 1200;
  const padding = 88;
  const contentWidth = width - padding * 2;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Browser tidak mendukung pembuatan gambar laporan.');

  context.font = '26px "Segoe UI", Arial, sans-serif';
  const noteLines = wrapCanvasText(context, report.catatan, contentWidth);
  const lineHeight = 42;
  const noteHeight = Math.max(lineHeight, noteLines.length * lineHeight);
  const height = Math.max(820, 580 + noteHeight + (report.attachment ? 80 : 0));
  if (height > 30000) throw new Error('Catatan terlalu panjang untuk diekspor sebagai JPG.');
  canvas.width = width;
  canvas.height = height;

  context.fillStyle = '#f1f5f9';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#ffffff';
  context.fillRect(36, 36, width - 72, height - 72);
  context.fillStyle = '#102a43';
  context.fillRect(36, 36, width - 72, 210);

  context.fillStyle = '#bfdbfe';
  context.font = 'bold 20px "Segoe UI", Arial, sans-serif';
  context.fillText('LP3I DEPOK  ·  LAPORAN PEMBIMBING AKADEMIK', padding, 95);
  context.fillStyle = '#ffffff';
  context.font = 'bold 40px "Segoe UI", Arial, sans-serif';
  context.fillText('Laporan Pembimbing Akademik', padding, 160);
  context.font = '22px "Segoe UI", Arial, sans-serif';
  context.fillStyle = '#dbeafe';
  context.fillText(`Tanggal laporan: ${report.tanggal}`, padding, 205);

  let y = 300;
  const details = [
    ['NAMA PEMBIMBING AKADEMIK', report.paName],
    ['KELAS', report.kelas],
    ['DIBUAT OLEH', report.ownerName]
  ];
  for (const [label, value] of details) {
    context.fillStyle = '#64748b';
    context.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    context.fillText(label, padding, y);
    context.fillStyle = '#1e293b';
    context.font = '28px "Segoe UI", Arial, sans-serif';
    context.fillText(String(value || '-'), padding, y + 38, contentWidth);
    y += 95;
  }

  y += 8;
  context.strokeStyle = '#dbe4ee';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(padding, y);
  context.lineTo(width - padding, y);
  context.stroke();
  y += 54;
  context.fillStyle = '#102a43';
  context.font = 'bold 26px "Segoe UI", Arial, sans-serif';
  context.fillText('CATATAN LAPORAN', padding, y);
  y += 50;
  context.fillStyle = '#334155';
  context.font = '26px "Segoe UI", Arial, sans-serif';
  for (const line of noteLines) {
    context.fillText(line, padding, y);
    y += lineHeight;
  }

  if (report.attachment) {
    y += 25;
    context.fillStyle = '#64748b';
    context.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    context.fillText('LAMPIRAN', padding, y);
    context.fillStyle = '#334155';
    context.font = '22px "Segoe UI", Arial, sans-serif';
    context.fillText(report.attachment.name, padding, y + 34, contentWidth);
  }

  context.fillStyle = '#64748b';
  context.font = '18px "Segoe UI", Arial, sans-serif';
  context.fillText('LP3I Depok · Sistem Laporan Pembimbing Akademik', padding, height - 70);

  canvas.toBlob(blob => {
    if (!blob) {
      showNotice('Gagal membuat gambar JPG laporan.', 'error');
      return;
    }
    downloadReportFile(blob, reportFilename(report, 'jpg'));
    showNotice('File JPG laporan berhasil dibuat.');
  }, 'image/jpeg', 0.92);
}

function downloadReportFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

async function saveReportPdf(report) {
  const response = await fetch(`/api/reports/${encodeURIComponent(report.id)}/pdf`);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.message || 'Gagal membuat file PDF laporan.');
  }
  downloadReportFile(await response.blob(), reportFilename(report, 'pdf'));
}

function showUser(user) {
  currentUser = user;
  $('#sideName').textContent = user.name;
  $('#topName').textContent = user.name;
  const initials = String(user.name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => Array.from(part)[0])
    .join('')
    .toLocaleUpperCase('id-ID') || 'U';
  const avatarLabel = `Profil ${user.name || 'pengguna'}`;
  $('#sideAvatar').textContent = initials;
  $('#sideAvatar').setAttribute('aria-label', avatarLabel);
  $('#sideAvatar').title = avatarLabel;
  $('#profileAvatar').textContent = initials;
  $('#profileAvatar').setAttribute('aria-label', avatarLabel);
  $('#profileAvatar').title = avatarLabel;
  scheduleNavigationUpdate();
  loadReports();
  if (pageRole === 'admin') loadUsers();
}

const navigationLinks = [...document.querySelectorAll('.sidebar .nav')];

function setActiveNavigation(link) {
  navigationLinks.forEach(item => {
    const isActive = item === link;
    item.classList.toggle('active', isActive);
    if (isActive) item.setAttribute('aria-current', 'location');
    else item.removeAttribute('aria-current');
  });
}

navigationLinks.forEach(link => {
  link.addEventListener('click', () => {
    setActiveNavigation(link);
  });
});

let navigationFrame = 0;
function updateActiveNavigation() {
  navigationFrame = 0;
  const activationLine = Math.min(window.innerHeight * 0.35, 220);
  const targets = navigationLinks
    .map(link => ({
      link,
      target: document.querySelector(link.getAttribute('href')),
    }))
    .filter(item => item.target);
  const visibleTargets = targets
    .map(item => ({ ...item, bounds: item.target.getBoundingClientRect() }))
    .filter(item => item.bounds.top <= activationLine && item.bounds.bottom > activationLine)
    .sort((a, b) => b.bounds.top - a.bounds.top);

  if (visibleTargets.length) {
    setActiveNavigation(visibleTargets[0].link);
    return;
  }

  const nextTarget = targets
    .map(item => ({ ...item, top: item.target.getBoundingClientRect().top }))
    .filter(item => item.top > activationLine)
    .sort((a, b) => a.top - b.top)[0];
  if (nextTarget) setActiveNavigation(nextTarget.link);
}

function scheduleNavigationUpdate() {
  if (!navigationFrame) navigationFrame = window.requestAnimationFrame(updateActiveNavigation);
}

window.addEventListener('scroll', scheduleNavigationUpdate, { passive: true });
window.addEventListener('resize', scheduleNavigationUpdate);
window.addEventListener('hashchange', scheduleNavigationUpdate);

$('#logoutBtn').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
    window.location.assign('/');
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

$('#lampiran').addEventListener('change', event => {
  const fileName = event.target.files[0]?.name;
  $('#fileLabel').textContent = fileName || (editingReportId
    ? 'Lampiran lama tetap digunakan jika tidak diganti'
    : 'Pilih file laporan');
});

function resetReportForm() {
  const form = $('#reportForm');
  form.reset();
  editingReportId = null;
  dateInput.value = new Date().toLocaleDateString('en-CA');
  $('#fileLabel').textContent = 'Pilih file laporan';
  $('#reportFormTitle').textContent = 'Buat laporan';
  $('#reportFormDescription').textContent = 'Isi informasi laporan di bawah ini.';
  $('#reportSubmitBtn').textContent = '＋　Simpan laporan';
  $('#cancelEditBtn').classList.add('hidden');
}

function startReportEdit(report) {
  editingReportId = report.id;
  $('#reportForm').elements.paName.value = report.paName;
  $('#reportForm').elements.kelas.value = report.kelas;
  dateInput.value = report.tanggal;
  $('#reportForm').elements.catatan.value = report.catatan;
  $('#lampiran').value = '';
  $('#fileLabel').textContent = report.attachment
    ? `${report.attachment.name} (lampiran saat ini)`
    : 'Pilih file pengganti (opsional)';
  $('#reportFormTitle').textContent = 'Edit laporan';
  $('#reportFormDescription').textContent = 'Perbarui informasi laporan. Lampiran lama tetap digunakan jika tidak diganti.';
  $('#reportSubmitBtn').textContent = 'Simpan perubahan';
  $('#cancelEditBtn').classList.remove('hidden');
  $('#formError').textContent = '';
  $('#reportFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#reportForm').elements.paName.focus({ preventScroll: true });
}

$('#cancelEditBtn').addEventListener('click', resetReportForm);

$('#reportForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (reportSubmitting) return;
  $('#formError').textContent = '';
  const form = event.currentTarget;
  const file = $('#lampiran').files[0];
  if (file && file.size > 10 * 1024 * 1024) {
    $('#formError').textContent = 'Ukuran file maksimal 10 MB.';
    return;
  }

  const isEditing = editingReportId !== null;
  const formData = new FormData(form);
  const controls = [...form.elements].map(control => [control, control.disabled]);
  const submitButton = $('#reportSubmitBtn');
  reportSubmitting = true;
  form.setAttribute('aria-busy', 'true');
  controls.forEach(([control]) => { control.disabled = true; });
  submitButton.textContent = isEditing ? 'Menyimpan perubahan…' : 'Menyimpan laporan…';

  try {
    const endpoint = isEditing
      ? '/api/reports/' + encodeURIComponent(editingReportId)
      : '/api/reports';
    const result = await api(endpoint, { method: isEditing ? 'PUT' : 'POST', body: formData });
    resetReportForm();
    await loadReports();
    showNotice(result.message || (isEditing ? 'Laporan berhasil diperbarui.' : 'Laporan berhasil disimpan.'));
  } catch (error) {
    $('#formError').textContent = error.message;
    showNotice(error.message, 'error');
  } finally {
    controls.forEach(([control, wasDisabled]) => { control.disabled = wasDisabled; });
    form.removeAttribute('aria-busy');
    reportSubmitting = false;
    submitButton.textContent = editingReportId !== null ? 'Simpan perubahan' : '＋　Simpan laporan';
  }
});

$('#searchInput').addEventListener('input', () => {
  currentReportPage = 1;
  renderReports();
});
$('#classFilter').addEventListener('change', () => {
  currentReportPage = 1;
  renderReports();
});
$('#sortOrder').addEventListener('change', () => {
  currentReportPage = 1;
  renderReports();
});
$('#clearFiltersBtn').addEventListener('click', () => {
  $('#searchInput').value = '';
  $('#classFilter').value = '';
  $('#sortOrder').value = 'newest';
  currentReportPage = 1;
  renderReports();
  $('#searchInput').focus();
});
$('#previousPageBtn').addEventListener('click', () => {
  if (currentReportPage > 1) {
    currentReportPage -= 1;
    renderReports();
  }
});
$('#nextPageBtn').addEventListener('click', () => {
  const pageCount = Math.ceil(getFilteredReports().length / reportsPerPage);
  if (currentReportPage < pageCount) {
    currentReportPage += 1;
    renderReports();
  }
});

async function loadReports() {
  try {
    allReports = await api('/api/reports');
    const selectedClass = $('#classFilter').value;
    const classes = [...new Set(allReports.map(report => String(report.kelas || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'id', { sensitivity: 'base' }));
    $('#classFilter').innerHTML = '<option value="">Semua kelas</option>' +
      classes.map(kelas => `<option value="${esc(kelas)}">${esc(kelas)}</option>`).join('');
    if (classes.includes(selectedClass)) $('#classFilter').value = selectedClass;
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    $('#statReports').textContent = allReports.length;
    $('#statMonth').textContent = allReports.filter(report => String(report.tanggal || '').startsWith(monthPrefix)).length;
    $('#statPA').textContent = new Set(allReports.map(report => report.paName.toLowerCase())).size;
    $('#statFiles').textContent = allReports.filter(report => report.attachment).length;
    renderReports();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

function getFilteredReports() {
  const query = $('#searchInput').value.toLowerCase();
  const selectedClass = $('#classFilter').value;
  const sortOrder = $('#sortOrder').value;
  return allReports
    .filter(report =>
      (!selectedClass || String(report.kelas || '').trim() === selectedClass) &&
      [report.paName, report.kelas, report.catatan, report.ownerName]
        .some(value => String(value || '').toLowerCase().includes(query))
    )
    .sort((a, b) => {
      const comparison = String(a.tanggal || '').localeCompare(String(b.tanggal || ''));
      return sortOrder === 'oldest' ? comparison : -comparison;
    });
}

function renderReports() {
  const reports = getFilteredReports();
  const pageCount = Math.ceil(reports.length / reportsPerPage);
  currentReportPage = Math.min(currentReportPage, Math.max(pageCount, 1));
  const query = $('#searchInput').value.trim();
  const selectedClass = $('#classFilter').value;
  const hasFilters = Boolean(query || selectedClass);
  $('#clearFiltersBtn').disabled = !query && !selectedClass && $('#sortOrder').value === 'newest';
  $('#exportBtn').disabled = reports.length === 0;
  $('#exportBtn').title = reports.length
    ? `Ekspor ${reports.length} laporan sesuai pencarian dan filter`
    : 'Tidak ada laporan untuk diekspor';
  if (!reports.length) {
    $('#countLabel').textContent = `Menampilkan 0 dari ${allReports.length} laporan`;
    $('#reportsList').innerHTML = `<div class="empty">${hasFilters ? 'Laporan tidak ditemukan' : 'Belum ada laporan'}<small>${hasFilters ? 'Coba kata kunci atau filter yang berbeda.' : 'Mulai catat aktivitas bimbingan agar arsip Anda tersusun rapi.'}</small>${hasFilters ? '' : '<a class="empty-action" href="#reportFormPanel">Buat laporan pertama <span aria-hidden="true">→</span></a>'}</div>`;
    $('#pagination').classList.add('hidden');
    return;
  }

  const pageStart = (currentReportPage - 1) * reportsPerPage;
  const visibleReports = reports.slice(pageStart, pageStart + reportsPerPage);
  const firstVisible = pageStart + 1;
  const lastVisible = pageStart + visibleReports.length;
  $('#countLabel').textContent = `Menampilkan ${firstVisible}–${lastVisible} dari ${reports.length} laporan${hasFilters ? ` · ${allReports.length} total` : ''}`;
  $('#pagination').classList.toggle('hidden', pageCount <= 1);
  $('#pageLabel').textContent = `Halaman ${currentReportPage} dari ${pageCount}`;
  $('#previousPageBtn').disabled = currentReportPage <= 1;
  $('#nextPageBtn').disabled = currentReportPage >= pageCount;

  $('#reportsList').innerHTML = visibleReports.map(report => `<article class="report-card">
    <div class="report-head"><div><h3>${esc(report.paName)}</h3><div class="report-meta">${esc(report.kelas)} · ${esc(report.tanggal)}${pageRole === 'admin' ? ' · Oleh ' + esc(report.ownerName) : ''}</div></div><div class="report-manage-actions"><button class="edit-btn" type="button" data-edit="${esc(report.id)}">Edit</button><button class="delete-btn" data-delete="${esc(report.id)}">Hapus</button></div></div>
    <p class="report-note">${esc(report.catatan)}</p>
    <div class="report-export-actions"><button class="light" data-export-pdf="${esc(report.id)}">Simpan PDF</button><button class="light" data-export-jpg="${esc(report.id)}">Simpan JPG/JPEG</button></div>
    <div class="report-actions">${renderAttachment(report)}</div>
  </article>`).join('');

  document.querySelectorAll('[data-edit]').forEach(button => {
    button.addEventListener('click', () => {
      const report = allReports.find(item => String(item.id) === button.dataset.edit);
      if (report) startReportEdit(report);
    });
  });

  document.querySelectorAll('[data-export-pdf]').forEach(button => {
    button.addEventListener('click', async () => {
      const report = allReports.find(item => String(item.id) === button.dataset.exportPdf);
      if (!report) return;
      button.disabled = true;
      try {
        await saveReportPdf(report);
        showNotice('File PDF laporan berhasil dibuat.');
      } catch (error) {
        showNotice(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-export-jpg]').forEach(button => {
    button.addEventListener('click', () => {
      const report = allReports.find(item => String(item.id) === button.dataset.exportJpg);
      if (!report) return;
      try {
        saveReportJpg(report);
      } catch (error) {
        showNotice(error.message, 'error');
      }
    });
  });

  document.querySelectorAll('[data-delete]').forEach(button => {
    button.addEventListener('click', async () => {
      const report = allReports.find(item => String(item.id) === button.dataset.delete);
      if (!report) return;
      const confirmed = await confirmAction({
        title: 'Hapus laporan ini?',
        message: 'Laporan yang dihapus tidak dapat dipulihkan.',
        detail: `${report.paName} · ${report.kelas} · ${report.tanggal}`,
      });
      if (!confirmed) return;
      try {
        await api('/api/reports/' + encodeURIComponent(button.dataset.delete), { method: 'DELETE' });
        await loadReports();
        showNotice('Laporan berhasil dihapus.');
      } catch (error) {
        showNotice(error.message, 'error');
      }
    });
  });
}

$('#exportBtn').addEventListener('click', () => {
  let url;
  try {
    const headers = ['Nama PA', 'Kelas', 'Tanggal', 'Catatan', 'Pemilik', 'Lampiran'];
    const rows = getFilteredReports().map(report => [
      report.paName, report.kelas, report.tanggal, report.catatan, report.ownerName, report.attachment?.name || ''
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(','))
      .join('\r\n');
    url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `laporan-pa-lp3i-${new Date().toLocaleDateString('en-CA')}.csv`;
    anchor.click();
    showNotice(`Ekspor CSV berhasil. ${rows.length} laporan siap diunduh.`);
  } catch (error) {
    showNotice(`Gagal mengekspor CSV: ${error.message}`, 'error');
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});

if (pageRole === 'admin') {
  $('#userForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (userSubmitting) return;
    $('#userError').textContent = '';
    const form = event.currentTarget;
    const userData = Object.fromEntries(new FormData(form));
    const controls = [...form.elements].map(control => [control, control.disabled]);
    const submitButton = form.querySelector('button[type="submit"]');
    userSubmitting = true;
    form.setAttribute('aria-busy', 'true');
    controls.forEach(([control]) => { control.disabled = true; });
    submitButton.textContent = 'Membuat akun…';

    try {
      await api('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });
      form.reset();
      await loadUsers();
      showNotice('Akun baru berhasil dibuat.');
    } catch (error) {
      $('#userError').textContent = error.message;
      showNotice(error.message, 'error');
    } finally {
      controls.forEach(([control, wasDisabled]) => { control.disabled = wasDisabled; });
      form.removeAttribute('aria-busy');
      userSubmitting = false;
      submitButton.textContent = 'Tambah akun';
    }
  });
}

async function loadUsers() {
  try {
    const users = await api('/api/users');
    if (!users.length) {
      $('#usersList').innerHTML = '<div class="empty">Belum ada akun pengguna.</div>';
      return;
    }

    $('#usersList').innerHTML = users.map(user => `<div class="user-row">
      <span class="user-details"><b>${esc(user.name)}</b><span class="report-meta">@${esc(user.username)}${user.username === currentUser.username ? ' · Akun Anda' : ''}</span></span>
      <span class="role-tag ${user.role === 'admin' ? 'admin-role' : ''}">${user.role === 'admin' ? 'ADMIN' : 'USER'}</span>
      ${user.username === currentUser.username
        ? '<span class="current-user-label">Aktif</span>'
        : `<button class="user-delete-btn" type="button" data-user-delete="${esc(user.id)}" data-username="${esc(user.username)}" aria-label="Hapus akun ${esc(user.username)}">Hapus</button>`}
    </div>`).join('');

    document.querySelectorAll('[data-user-delete]').forEach(button => {
      button.addEventListener('click', async () => {
        const username = button.dataset.username;
        const confirmed = await confirmAction({
          title: 'Hapus akun ini?',
          message: 'Akun yang dihapus tidak dapat digunakan untuk login.',
          detail: `@${username}`,
        });
        if (!confirmed) return;

        button.disabled = true;
        try {
          await api('/api/users/' + encodeURIComponent(button.dataset.userDelete), { method: 'DELETE' });
          await loadUsers();
          showNotice(`Akun @${username} berhasil dihapus.`);
        } catch (error) {
          button.disabled = false;
          showNotice(error.message, 'error');
        }
      });
    });
  } catch (error) {
    $('#userError').textContent = error.message;
  }
}

api('/api/me').then(data => {
  if (!data.user) {
    window.location.replace(`/${pageRole}`);
    return;
  }
  if (data.user.role !== pageRole) {
    window.location.replace(data.user.role === 'admin' ? '/admin/dashboard' : '/user/dashboard');
    return;
  }
  showUser(data.user);
}).catch(error => {
  showNotice(error.message, 'error');
  window.location.replace(`/${pageRole}`);
});
