// Auth State Helpers
function getAuthEmail() {
  return localStorage.getItem('licenseEmail');
}

function getSessionToken() {
  return localStorage.getItem('sessionToken');
}

function getAuthHeaders() {
  return {
    'x-license-email': getAuthEmail() || '',
    'x-session-token': getSessionToken() || ''
  };
}

// Redirect if not authenticated
function checkAuth() {
  const email = getAuthEmail();
  const token = getSessionToken();

  if (!email || !token) {
    window.location.href = '/login';
    return false;
  }

  // Display user badge
  const userBadge = document.getElementById('userEmailBadge');
  if (userBadge) {
    userBadge.innerText = email;
  }

  // Update download links with query tokens
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.href = `/api/export?licenseEmail=${encodeURIComponent(email)}&sessionToken=${encodeURIComponent(token)}`;
  }
  const templateLink = document.querySelector('a[href^="/api/template"]');
  if (templateLink) {
    templateLink.href = `/api/template?licenseEmail=${encodeURIComponent(email)}&sessionToken=${encodeURIComponent(token)}`;
  }

  return true;
}

// Heartbeat checking for Single Active Device (Auto Logout if logged in elsewhere)
let heartbeatInterval = null;
function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  heartbeatInterval = setInterval(async () => {
    const email = getAuthEmail();
    const token = getSessionToken();
    if (!email || !token) return;

    try {
      const res = await fetch('/api/auth/check', {
        headers: getAuthHeaders()
      });
      const data = await res.json();

      if (!res.ok || !data.valid) {
        clearInterval(heartbeatInterval);
        localStorage.removeItem('sessionToken');
        alert('⚠️ Sesi Anda Telah Berakhir!\n\nAkun lisensi ini baru saja login di perangkat lain atau dinonaktifkan oleh Admin.');
        window.location.href = '/login?reason=overridden';
      }
    } catch (err) {
      // Network error, ignore temporary hiccup
    }
  }, 4000); // Check every 4 seconds
}

async function userLogout() {
  if (confirm('Apakah Anda yakin ingin keluar dari perangkat ini?')) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: getAuthEmail(),
          sessionToken: getSessionToken()
        })
      });
    } catch (e) {}

    localStorage.removeItem('sessionToken');
    localStorage.removeItem('licenseEmail');
    localStorage.removeItem('licenseName');
    window.location.href = '/login';
  }
}

// State variables
let queueState = {
  isRunning: false,
  isPaused: false,
  delayMs: 2500,
  currentIndex: 0,
  total: 0,
  completed: 0,
  successDitemukan: 0,
  tidakDitemukan: 0,
  errorCount: 0,
  desilSummary: { desil1_4: 0, desil5: 0, desil6_10: 0 },
  items: []
};

// Setup SSE EventSource
function initSSE() {
  const email = getAuthEmail();
  const token = getSessionToken();
  if (!email || !token) return;

  const url = `/api/events?licenseEmail=${encodeURIComponent(email)}&sessionToken=${encodeURIComponent(token)}`;
  const evtSource = new EventSource(url);

  evtSource.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data);
      if (payload.type === 'INIT' || payload.type === 'STATE_CHANGE' || payload.type === 'ALL_COMPLETED') {
        queueState = payload.data;
        updateUI();
      } else if (payload.type === 'ITEM_PROCESSING') {
        const { index, item } = payload.data;
        if (queueState.items[index]) {
          queueState.items[index] = item;
        }
        updateStatusText(`Sedang memproses baris ${index + 1} (${item.nik})...`);
        renderTable();
      } else if (payload.type === 'ITEM_COMPLETED') {
        const { index, item, summary } = payload.data;
        if (queueState.items[index]) {
          queueState.items[index] = item;
        }
        if (summary) {
          queueState = summary;
        }
        updateUI();
      }
    } catch (err) {
      console.error('SSE Error parsing:', err);
    }
  };

  evtSource.onerror = () => {
    // Check if session invalid
    fetch('/api/auth/check', { headers: getAuthHeaders() }).then(r => {
      if (r.status === 401) {
        evtSource.close();
        window.location.href = '/login?reason=overridden';
      }
    }).catch(() => {});
  };
}

// Switch between tabs
function switchTab(tab) {
  const tabBatch = document.getElementById('tabBatch');
  const tabSingle = document.getElementById('tabSingle');
  const tabBatchBtn = document.getElementById('tabBatchBtn');
  const tabSingleBtn = document.getElementById('tabSingleBtn');

  if (tab === 'batch') {
    tabBatch.classList.remove('hidden');
    tabSingle.classList.add('hidden');
    tabBatchBtn.className = 'py-3 px-6 text-sm font-semibold border-b-2 border-blue-700 text-blue-700 flex items-center gap-2';
    tabSingleBtn.className = 'py-3 px-6 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2';
  } else {
    tabBatch.classList.add('hidden');
    tabSingle.classList.remove('hidden');
    tabSingleBtn.className = 'py-3 px-6 text-sm font-semibold border-b-2 border-blue-700 text-blue-700 flex items-center gap-2';
    tabBatchBtn.className = 'py-3 px-6 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2';
  }
}

// File Upload Drag & Drop
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('excelFileInput');

if (dropZone && fileInput) {
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-blue-500', 'bg-blue-50/50');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-blue-500', 'bg-blue-50/50');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-blue-500', 'bg-blue-50/50');
    if (e.dataTransfer.files.length) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
      handleFileUpload(e.target.files[0]);
    }
  });
}

async function handleFileUpload(file) {
  const formData = new FormData();
  formData.append('file', file);

  document.getElementById('progressStatus').innerText = 'Mengunggah & memproses file Excel...';

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        window.location.href = '/login?reason=overridden';
        return;
      }
      throw new Error(data.error || 'Gagal mengunggah file');
    }

    document.getElementById('fileName').innerText = file.name;
    document.getElementById('fileRows').innerText = `(${data.count} NIK ditemukan)`;
    document.getElementById('fileInfo').classList.remove('hidden');
    document.getElementById('fileInfo').classList.add('flex');

    alert(`Berhasil memuat ${data.count} NIK dari file Excel.`);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function clearUploadedFile() {
  if (fileInput) fileInput.value = '';
  document.getElementById('fileInfo').classList.add('hidden');
  document.getElementById('fileInfo').classList.remove('flex');
}

// Delay Slider
const delayInput = document.getElementById('delayInput');
const delayLabel = document.getElementById('delayLabel');

if (delayInput) {
  delayInput.addEventListener('input', async (e) => {
    const val = parseFloat(e.target.value);
    delayLabel.innerText = `${val.toFixed(1)} detik`;
    await fetch('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ delayMs: val * 1000 })
    });
  });
}

// Control actions
async function startProcessing() {
  await fetch('/api/process/start', {
    method: 'POST',
    headers: getAuthHeaders()
  });
}

async function pauseProcessing() {
  await fetch('/api/process/pause', {
    method: 'POST',
    headers: getAuthHeaders()
  });
}

async function stopProcessing() {
  if (confirm('Apakah Anda yakin ingin menghentikan proses pengecekan?')) {
    await fetch('/api/process/stop', {
      method: 'POST',
      headers: getAuthHeaders()
    });
  }
}

async function retryFailed() {
  if (queueState.isRunning) return;

  try {
    const res = await fetch('/api/process/retry-failed', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (data.state) queueState = data.state;
    updateUI();
  } catch (err) {
    console.error('Error retrying failed items:', err);
  }
}

async function resetData() {
  if (queueState.total === 0) return;
  
  const confirmMsg = queueState.isRunning 
    ? 'Proses sedang berjalan. Apakah Anda yakin ingin membatalkan dan menghapus semua data riwayat pengecekan?'
    : 'Apakah Anda yakin ingin menghapus semua data riwayat hasil pengecekan?';

  if (confirm(confirmMsg)) {
    try {
      const res = await fetch('/api/process/reset', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (data.state) queueState = data.state;
      clearUploadedFile();
      updateUI();
    } catch (err) {
      console.error('Error resetting data:', err);
    }
  }
}

function updateStatusText(text) {
  const el = document.getElementById('progressStatus');
  el.innerHTML = `<span class="w-2 h-2 rounded-full bg-blue-500 animate-ping"></span> ${text}`;
}

// Update all UI elements based on state
function updateUI() {
  const { total, completed, successDitemukan, tidakDitemukan, errorCount, desilSummary, isRunning, isPaused, items } = queueState;

  // Count failed items that can be retried (status not Ditemukan and not Tidak Ditemukan)
  let retryableCount = 0;
  if (items && items.length) {
    retryableCount = items.filter(item => item.status && item.status !== 'Antrean' && item.status !== 'Sedang Memproses' && item.status !== 'Ditemukan' && item.status !== 'Tidak Ditemukan').length;
  }

  // Stats Counters
  document.getElementById('statTotal').innerText = total;
  document.getElementById('statCompleted').innerText = completed;
  document.getElementById('statDesil14').innerText = desilSummary ? desilSummary.desil1_4 : 0;
  document.getElementById('statDesil5').innerText = desilSummary ? desilSummary.desil5 : 0;
  document.getElementById('statDesil610').innerText = desilSummary ? desilSummary.desil6_10 : 0;
  document.getElementById('statNotFound').innerText = tidakDitemukan + errorCount;

  // Progress Bar
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  document.getElementById('progressBar').style.width = `${pct}%`;
  document.getElementById('progressPercent').innerText = `${pct}%`;

  // Status text
  if (isRunning) {
    updateStatusText(`Sedang memproses (${completed}/${total})...`);
  } else if (isPaused) {
    document.getElementById('progressStatus').innerHTML = `
      <span class="w-2 h-2 rounded-full bg-amber-500"></span> Pengecekan Dijeda (${completed}/${total})
    `;
  } else if (total > 0 && completed >= total) {
    if (retryableCount > 0) {
      document.getElementById('progressStatus').innerHTML = `
        <span class="w-2 h-2 rounded-full bg-amber-500"></span> Selesai, terdapat ${retryableCount} data yang perlu dicek ulang.
      `;
    } else {
      document.getElementById('progressStatus').innerHTML = `
        <span class="w-2 h-2 rounded-full bg-emerald-500"></span> Selesai! Semua data telah berhasil dicek (${completed}/${total}).
      `;
    }
  } else {
    document.getElementById('progressStatus').innerHTML = `
      <span class="w-2 h-2 rounded-full bg-slate-400"></span> Menunggu proses dimulai...
    `;
  }

  // Buttons state
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const stopBtn = document.getElementById('stopBtn');
  const resetBtn = document.getElementById('resetBtn');
  const tableResetBtn = document.getElementById('tableResetBtn');
  const retryFailedBtn = document.getElementById('retryFailedBtn');
  const failedCountLabel = document.getElementById('failedCountLabel');

  if (failedCountLabel) failedCountLabel.innerText = retryableCount;
  if (retryFailedBtn) retryFailedBtn.disabled = isRunning || retryableCount === 0;

  if (resetBtn) resetBtn.disabled = total === 0;
  if (tableResetBtn) tableResetBtn.disabled = total === 0;

  if (total === 0) {
    startBtn.disabled = true;
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
  } else if (isRunning) {
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
  } else if (isPaused) {
    startBtn.disabled = false;
    startBtn.innerHTML = '<i class="fa-solid fa-play"></i> Lanjutkan';
    pauseBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    startBtn.disabled = completed >= total;
    startBtn.innerHTML = '<i class="fa-solid fa-play"></i> Mulai Cek';
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
  }

  renderTable();
}

// Render Result Table with filtering & search
function renderTable() {
  const tbody = document.getElementById('resultTableBody');
  const filter = document.getElementById('desilFilter').value;
  const search = document.getElementById('searchInput').value.toLowerCase().trim();

  let filtered = queueState.items || [];

  // Filter by Desil Category
  if (filter === '1-4') {
    filtered = filtered.filter(item => ['1', '2', '3', '4'].includes(String(item.desil).trim()));
  } else if (filter === '5') {
    filtered = filtered.filter(item => String(item.desil).trim() === '5');
  } else if (filter === '6-10') {
    filtered = filtered.filter(item => String(item.desil).includes('6') || String(item.desil).includes('10'));
  } else if (filter === 'TIDAK_DITEMUKAN') {
    filtered = filtered.filter(item => item.status === 'Tidak Ditemukan' || item.status === 'Error');
  }

  // Filter by Search text
  if (search) {
    filtered = filtered.filter(item => 
      (item.nik && item.nik.includes(search)) || 
      (item.nama && item.nama.toLowerCase().includes(search)) ||
      (item.namaMasked && item.namaMasked.toLowerCase().includes(search))
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center py-8 text-slate-400">
          ${queueState.items.length === 0 ? 'Belum ada data. Silakan unggah file Excel.' : 'Tidak ada data yang sesuai dengan filter/pencarian.'}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((item, idx) => {
    // Desil badge
    let desilBadge = '<span class="text-slate-400">-</span>';
    const d = String(item.desil || '').trim();
    if (['1', '2', '3', '4'].includes(d)) {
      desilBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded font-bold text-xs bg-emerald-100 text-emerald-800 border border-emerald-300">Desil ${d}</span>`;
    } else if (d === '5') {
      desilBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded font-bold text-xs bg-amber-100 text-amber-800 border border-amber-300">Desil 5</span>`;
    } else if (d.includes('6') || d.includes('10')) {
      desilBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded font-medium text-xs bg-slate-100 text-slate-700 border border-slate-300">${d}</span>`;
    } else if (item.status === 'Tidak Ditemukan') {
      desilBadge = `<span class="text-xs text-rose-500 font-medium">Tidak Terdaftar</span>`;
    }

    // Bansos badges
    const sembakoBadge = item.sembakoStatus === 'YA' 
      ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">YA</span>`
      : `<span class="text-slate-400 text-xs">${item.sembakoStatus || '-'}</span>`;

    const pkhBadge = item.pkhStatus === 'YA' 
      ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">YA</span>`
      : `<span class="text-slate-400 text-xs">${item.pkhStatus || '-'}</span>`;

    const pbiBadge = item.pbiStatus === 'YA' 
      ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">YA</span>`
      : `<span class="text-slate-400 text-xs">${item.pbiStatus || '-'}</span>`;

    // Row status badge
    let statusCol = `<span class="text-slate-400">${item.status || 'Antrean'}</span>`;
    if (item.status === 'Sedang Memproses') {
      statusCol = `<span class="text-blue-600 font-medium flex items-center justify-center gap-1"><i class="fa-solid fa-spinner fa-spin"></i> Proses</span>`;
    } else if (item.status === 'Ditemukan') {
      statusCol = `<span class="text-emerald-600 font-semibold flex items-center justify-center gap-1"><i class="fa-solid fa-circle-check"></i> Ditemukan</span>`;
    } else if (item.status === 'Tidak Ditemukan') {
      statusCol = `<span class="text-rose-500 font-medium flex items-center justify-center gap-1"><i class="fa-solid fa-circle-xmark"></i> Tidak Ada</span>`;
    } else if (item.status === 'Error' || item.status?.includes('Gagal')) {
      statusCol = `<span class="text-amber-600 font-medium">${item.status}</span>`;
    }

    return `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="px-3 py-2.5 text-center font-mono text-slate-400">${item.id || idx + 1}</td>
        <td class="px-4 py-2.5 font-mono font-medium text-slate-800">${item.nik}</td>
        <td class="px-4 py-2.5 text-slate-700">${item.nama || '-'}</td>
        <td class="px-4 py-2.5 text-slate-700">${item.namaMasked || '-'}</td>
        <td class="px-3 py-2.5 text-center">${desilBadge}</td>
        <td class="px-3 py-2.5 text-center">${sembakoBadge}</td>
        <td class="px-3 py-2.5 text-center">${pkhBadge}</td>
        <td class="px-3 py-2.5 text-center">${pbiBadge}</td>
        <td class="px-3 py-2.5 text-center">${item.kpdStatus || '-'}</td>
        <td class="px-4 py-2.5 text-center">${statusCol}</td>
      </tr>
    `;
  }).join('');
}

// Single NIK Check Function
async function checkSingleNik(e) {
  e.preventDefault();
  const nik = document.getElementById('singleNikInput').value.trim();
  const btn = document.getElementById('singleSubmitBtn');
  const resContainer = document.getElementById('singleResultContainer');
  const resContent = document.getElementById('singleResultContent');

  if (nik.length !== 16) {
    alert('NIK harus 16 digit!');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menghubungi Server Kemensos & Menyelesaikan Captcha...';
  resContainer.classList.remove('hidden');
  resContent.innerHTML = `
    <div class="p-6 text-center text-slate-500">
      <i class="fa-solid fa-circle-notch fa-spin text-3xl text-blue-600 mb-3 block"></i>
      <p class="font-medium text-slate-700">Sedang mengecek NIK ${nik}...</p>
      <p class="text-xs text-slate-400 mt-1">Mengambil data DTSEN & auto-solving captcha...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/check-single', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ nik })
    });
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        window.location.href = '/login?reason=overridden';
        return;
      }
      throw new Error(data.error || 'Gagal mengecek NIK');
    }

    if (data.status === 'Ditemukan') {
      resContent.innerHTML = `
        <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
          <div class="flex justify-between items-start">
            <div>
              <span class="text-xs font-semibold text-emerald-800 uppercase tracking-wider bg-emerald-200/60 px-2 py-0.5 rounded">Data Ditemukan</span>
              <h3 class="text-base font-bold text-slate-800 mt-1">${data.namaMasked}</h3>
              <p class="text-xs text-slate-500">NIK: ${data.nik} &bull; ${data.dtsenPeriod}</p>
            </div>
            <div class="text-right">
              <span class="text-xs text-slate-500 font-medium block">Hasil Desil</span>
              <span class="text-lg font-black text-emerald-700 bg-white px-3 py-1 rounded-lg border border-emerald-300 shadow-sm inline-block mt-0.5">
                Desil ${data.desil}
              </span>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2 pt-2 border-t border-emerald-200/60 text-xs">
            <div class="bg-white p-2.5 rounded-lg border border-emerald-100">
              <p class="text-[10px] text-slate-400 uppercase font-bold">Sembako</p>
              <p class="font-semibold text-slate-700 mt-0.5">${data.sembakoStatus}</p>
              <p class="text-[10px] text-slate-400">${data.sembakoPeriode}</p>
            </div>
            <div class="bg-white p-2.5 rounded-lg border border-emerald-100">
              <p class="text-[10px] text-slate-400 uppercase font-bold">PKH</p>
              <p class="font-semibold text-slate-700 mt-0.5">${data.pkhStatus}</p>
              <p class="text-[10px] text-slate-400">${data.pkhPeriode}</p>
            </div>
            <div class="bg-white p-2.5 rounded-lg border border-emerald-100">
              <p class="text-[10px] text-slate-400 uppercase font-bold">PBI-JK</p>
              <p class="font-semibold text-slate-700 mt-0.5">${data.pbiStatus}</p>
              <p class="text-[10px] text-slate-400 truncate">${data.pbiPeriode}</p>
            </div>
          </div>
        </div>
      `;
    } else {
      resContent.innerHTML = `
        <div class="bg-rose-50 border border-rose-200 rounded-xl p-4 text-center space-y-2">
          <i class="fa-solid fa-circle-xmark text-rose-500 text-2xl"></i>
          <h4 class="font-bold text-rose-800 text-sm">Data Tidak Ditemukan</h4>
          <p class="text-xs text-rose-600">${data.rawText || data.error || 'NIK tidak terdaftar dalam data DTSEN Kemensos.'}</p>
        </div>
      `;
    }
  } catch (err) {
    resContent.innerHTML = `
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center space-y-1">
        <p class="text-xs font-semibold text-amber-800">Terjadi Kesalahan Koneksi</p>
        <p class="text-xs text-amber-600">${err.message}</p>
      </div>
    `;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-search"></i> Cari Data di DTSEN';
  }
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  if (checkAuth()) {
    initSSE();
    startHeartbeat();
  }
});
