// Polyfill global File for Node.js 18 undici compatibility
if (typeof globalThis.File === 'undefined') {
  const { Blob } = require('buffer');
  class File extends Blob {
    constructor(chunks, filename, options = {}) {
      super(chunks, options);
      this.name = String(filename);
      this.lastModified = options.lastModified || Date.now();
    }
    get [Symbol.toStringTag]() {
      return 'File';
    }
  }
  globalThis.File = File;
}

const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const queueManager = require('./services/queueManager');
const licenseService = require('./services/licenseService');
const { requireLicenseAuth, requireAdminAuth } = require('./middleware/authMiddleware');
const { parseUploadedExcel, generateTemplateExcel, generateResultExcel } = require('./services/excelService');
const { checkNik } = require('./services/kemensosScraper');
const { getWorker } = require('./services/captchaSolver');

const app = express();
const PORT = process.env.PORT || 3003;

// Trust Nginx Reverse Proxy (fixes X-Forwarded-For warning)
app.set('trust proxy', 1);

app.disable('x-powered-by');

// Permissive headers to ensure zero script blocking on mobile/extensions
app.use((req, res, next) => {
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('X-Content-Security-Policy');
  res.removeHeader('X-WebKit-CSP');
  next();
});

// Setup upload storage in memory with size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB limit
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ==========================================
// 🛡️ SECURITY RATE LIMITERS
// ==========================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Terlalu banyak percobaan login. Silakan tunggu 15 menit demi keamanan.' }
});

const adminPinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { error: 'Terlalu banyak percobaan PIN Admin salah. Akses dibekukan selama 15 menit.' }
});

const singleCheckLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 100,
  message: { error: 'Batas laju pengecekan satuan tercapai. Silakan coba sesaat lagi.' }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { error: 'Terlalu banyak unggahan file. Silakan tunggu beberapa saat.' }
});

// Convenient clean URL routes
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// ==========================================
// 🔑 USER AUTHENTICATION & LICENSE ROUTES
// ==========================================

// Login with license email
app.post('/api/auth/login', authLimiter, (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email lisensi wajib diisi.' });
    }

    const deviceInfo = {
      userAgent: req.headers['user-agent'] || 'Unknown Browser',
      ip: req.ip || req.connection?.remoteAddress || '127.0.0.1'
    };

    const result = licenseService.loginLicense(email, deviceInfo, req.ip);
    if (!result.success) {
      return res.status(403).json({ error: result.error });
    }

    res.json(result);
  } catch (err) {
    console.error('Auth Login Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Logout current session
app.post('/api/auth/logout', (req, res) => {
  const { email, sessionToken } = req.body;
  if (email && sessionToken) {
    licenseService.logoutLicense(email, sessionToken);
  }
  res.json({ success: true });
});

// Heartbeat & session verification (Checks if session has been overridden by another device)
app.get('/api/auth/check', (req, res) => {
  const email = req.headers['x-license-email'] || req.query.licenseEmail;
  const sessionToken = req.headers['x-session-token'] || req.query.sessionToken;

  if (!email || !sessionToken) {
    return res.status(401).json({ valid: false, reason: 'MISSING_CREDENTIALS' });
  }

  const isValid = licenseService.verifySession(email, sessionToken);
  if (!isValid) {
    return res.status(401).json({
      valid: false,
      reason: 'SESSION_OVERRIDDEN',
      message: 'Sesi Anda telah berakhir karena akun telah login di perangkat lain atau dinonaktifkan.'
    });
  }

  res.json({ valid: true });
});

// ==========================================
// 🛡️ ADMIN MANAGEMENT ROUTES
// ==========================================

// Admin Login (PIN Authentication with Brute-Force Protection)
app.post('/api/admin/login', adminPinLimiter, (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ error: 'PIN Admin wajib diisi.' });
    }
    const result = licenseService.verifyAdminPin(pin);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }
    res.json({ success: true, token: result.token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get All Licenses (Admin Only)
app.get('/api/admin/licenses', requireAdminAuth, (req, res) => {
  try {
    const licenses = licenseService.getAllLicenses();
    res.json({ success: true, licenses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add New License (Admin Only)
app.post('/api/admin/licenses', requireAdminAuth, (req, res) => {
  try {
    const { email, name, notes } = req.body;
    const newLic = licenseService.addLicense(email, name, notes);
    res.json({ success: true, license: newLic });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Toggle License Status (Admin Only)
app.put('/api/admin/licenses/:id/toggle', requireAdminAuth, (req, res) => {
  try {
    const lic = licenseService.toggleLicense(req.params.id);
    res.json({ success: true, license: lic });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Force Logout Active Session (Admin Only)
app.post('/api/admin/licenses/:id/logout', requireAdminAuth, (req, res) => {
  try {
    licenseService.forceLogout(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete License (Admin Only)
app.delete('/api/admin/licenses/:id', requireAdminAuth, (req, res) => {
  try {
    licenseService.deleteLicense(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Change Admin PIN (Admin Only)
app.post('/api/admin/change-pin', requireAdminAuth, (req, res) => {
  try {
    const { oldPin, newPin } = req.body;
    const result = licenseService.changeAdminPin(oldPin, newPin);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ success: true, message: 'PIN Admin berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Proxy & System Settings (Admin Only)
app.get('/api/admin/settings', requireAdminAuth, (req, res) => {
  try {
    const settings = licenseService.getSettings();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Proxy Settings (Admin Only)
app.post('/api/admin/settings', requireAdminAuth, (req, res) => {
  try {
    const { proxyUrl } = req.body;
    const updated = licenseService.updateSettings({ proxyUrl });
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test Proxy Connection directly to Kemensos (Admin Only)
app.post('/api/admin/test-proxy', requireAdminAuth, async (req, res) => {
  try {
    const { proxyUrl } = req.body;
    const targetUrl = 'https://cekbansos.kemensos.go.id/';
    const startTime = Date.now();

    const fetchOptions = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    };

    if (proxyUrl && proxyUrl.trim()) {
      const { ProxyAgent } = require('undici');
      fetchOptions.dispatcher = new ProxyAgent(proxyUrl.trim());
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    fetchOptions.signal = controller.signal;

    const response = await fetch(targetUrl, fetchOptions);
    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;

    res.json({
      success: true,
      statusCode: response.status,
      statusText: response.statusText,
      latencyMs,
      message: `Berhasil terhubung ke server Kemensos! (Status: ${response.status}, Latensi: ${latencyMs}ms)`
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: `Gagal terhubung ke Kemensos via proxy: ${err.message}`
    });
  }
});

// ==========================================
// 🚀 PROTECTED APPLICATION ROUTES
// ==========================================

// SSE Endpoint for Live Progress Updates (Protected)
app.get('/api/events', requireLicenseAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  queueManager.addClient(res);

  req.on('close', () => {
    queueManager.removeClient(res);
  });
});

// Upload Excel File (Protected + Rate-limited)
app.post('/api/upload', requireLicenseAuth, uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Tidak ada file yang diunggah.' });
    }

    // Validate file mimetype
    const validMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/octet-stream'
    ];
    if (!validMimes.includes(req.file.mimetype) && !req.file.originalname.match(/\.(xlsx|xls|csv)$/i)) {
      return res.status(400).json({ error: 'Format file tidak didukung. Harap unggah file .xlsx, .xls, atau .csv.' });
    }

    const items = await parseUploadedExcel(req.file.buffer);
    if (items.length === 0) {
      return res.status(400).json({ error: 'File Excel tidak memiliki data NIK yang valid.' });
    }

    queueManager.setItems(items);

    res.json({
      success: true,
      count: items.length,
      sample: items.slice(0, 5)
    });
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start / Resume Batch Processing (Protected)
app.post('/api/process/start', requireLicenseAuth, (req, res) => {
  queueManager.start();
  res.json({ success: true, state: queueManager.getState() });
});

// Pause Batch Processing (Protected)
app.post('/api/process/pause', requireLicenseAuth, (req, res) => {
  queueManager.pause();
  res.json({ success: true, state: queueManager.getState() });
});

// Stop Batch Processing (Protected)
app.post('/api/process/stop', requireLicenseAuth, (req, res) => {
  queueManager.stop();
  res.json({ success: true, state: queueManager.getState() });
});

// Reset / Clear Batch Data (Protected)
app.post('/api/process/reset', requireLicenseAuth, (req, res) => {
  queueManager.clear();
  res.json({ success: true, state: queueManager.getState() });
});

// Retry Failed Items Only (Protected)
app.post('/api/process/retry-failed', requireLicenseAuth, (req, res) => {
  queueManager.retryFailed();
  res.json({ success: true, state: queueManager.getState() });
});

// Update Delay Config (Protected)
app.post('/api/config', requireLicenseAuth, (req, res) => {
  const { delayMs } = req.body;
  if (delayMs) queueManager.setDelay(delayMs);
  res.json({ success: true, delayMs: queueManager.delayMs });
});

// Check Single NIK (Instant Test) (Protected + Rate-limited)
app.post('/api/check-single', requireLicenseAuth, singleCheckLimiter, async (req, res) => {
  const { nik } = req.body;
  try {
    if (!nik) {
      return res.status(400).json({ error: 'NIK wajib diisi.' });
    }
    
    // Strict Sanitization: Extract digits only
    const cleanNik = String(nik).trim().replace(/\D/g, '');
    if (cleanNik.length !== 16) {
      return res.status(400).json({ error: 'Format NIK tidak valid. NIK harus terdiri dari tepat 16 digit angka.' });
    }

    console.log(`🔍 [Cek Satuan] Memproses NIK: ${cleanNik} ...`);
    const result = await checkNik(cleanNik);
    console.log(`✅ [Cek Satuan] Selesai NIK: ${cleanNik} -> Status: ${result.status}, Desil: ${result.desil}`);
    res.json(result);
  } catch (err) {
    console.error(`❌ [Cek Satuan] Error NIK: ${nik} ->`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Download Template Excel (Protected)
app.get('/api/template', requireLicenseAuth, async (req, res) => {
  try {
    const buffer = await generateTemplateExcel();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Template_Cek_Desil_Massal.xlsx"');
    res.end(Buffer.from(buffer));
  } catch (err) {
    console.error('Template Error:', err);
    res.status(500).send('Gagal membuat template');
  }
});

// Export Results to Excel (Protected)
app.get('/api/export', requireLicenseAuth, async (req, res) => {
  try {
    const items = queueManager.getItems();
    if (items.length === 0) {
      return res.status(400).json({ error: 'Belum ada data untuk diekspor.' });
    }
    const buffer = await generateResultExcel(items);
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Hasil_Cek_Desil_Kemensos_${dateStr}.xlsx"`);
    res.end(Buffer.from(buffer));
  } catch (err) {
    console.error('Export Error:', err);
    res.status(500).send('Gagal mengekspor data');
  }
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  🚀 Aplikasi Cek Desil Massal Kemensos Aktif!`);
  console.log(`  🏢 Developed by BuatDigital.id`);
  console.log(`  🌐 Port: ${PORT}`);
  console.log(`====================================================`);
  
  // Warm up OCR worker immediately so first check is super fast
  getWorker().catch(e => console.error('OCR Warmup Notice:', e.message));
});
