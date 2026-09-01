const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../../data');
const LICENSES_FILE = path.join(DATA_DIR, 'licenses.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Hash password or PIN with SHA-256
 */
function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

/**
 * Initialize Admin Configuration
 */
function initAdmin() {
  if (!fs.existsSync(ADMIN_FILE)) {
    const defaultAdmin = {
      pinHash: hashPin('admin123'), // Default initial PIN: admin123
      sessionToken: null,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(defaultAdmin, null, 2));
  }
}

/**
 * Initialize Licenses Store
 */
function initLicenses() {
  if (!fs.existsSync(LICENSES_FILE)) {
    const initialLicenses = [
      {
        id: crypto.randomUUID(),
        email: 'demo@buatdigital.id',
        name: 'Demo Account BuatDigital',
        isActive: true,
        createdAt: new Date().toISOString(),
        notes: 'Lisensi demo bawaan sistem',
        activeSessionToken: null,
        lastLoginAt: null,
        lastDeviceInfo: null,
        lastIp: null,
        loginCount: 0
      }
    ];
    fs.writeFileSync(LICENSES_FILE, JSON.stringify(initialLicenses, null, 2));
  }
}

initAdmin();
initLicenses();

class LicenseService {
  getLicensesData() {
    try {
      if (!fs.existsSync(LICENSES_FILE)) initLicenses();
      const content = fs.readFileSync(LICENSES_FILE, 'utf8');
      return JSON.parse(content || '[]');
    } catch (err) {
      console.error('Error reading licenses:', err);
      return [];
    }
  }

  saveLicensesData(licenses) {
    fs.writeFileSync(LICENSES_FILE, JSON.stringify(licenses, null, 2));
  }

  getAdminData() {
    try {
      if (!fs.existsSync(ADMIN_FILE)) initAdmin();
      const content = fs.readFileSync(ADMIN_FILE, 'utf8');
      return JSON.parse(content || '{}');
    } catch (err) {
      console.error('Error reading admin config:', err);
      return {};
    }
  }

  saveAdminData(admin) {
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(admin, null, 2));
  }

  // Admin Auth
  verifyAdminPin(pin) {
    const admin = this.getAdminData();
    if (admin.pinHash === hashPin(pin)) {
      const adminToken = crypto.randomBytes(32).toString('hex');
      admin.sessionToken = adminToken;
      this.saveAdminData(admin);
      return { success: true, token: adminToken };
    }
    return { success: false, error: 'PIN Admin salah.' };
  }

  verifyAdminSession(token) {
    if (!token) return false;
    const admin = this.getAdminData();
    return admin.sessionToken === token;
  }

  changeAdminPin(oldPin, newPin) {
    const admin = this.getAdminData();
    if (admin.pinHash !== hashPin(oldPin)) {
      return { success: false, error: 'PIN lama tidak sesuai.' };
    }
    if (!newPin || newPin.length < 4) {
      return { success: false, error: 'PIN baru minimal 4 karakter.' };
    }
    admin.pinHash = hashPin(newPin);
    admin.updatedAt = new Date().toISOString();
    this.saveAdminData(admin);
    return { success: true };
  }

  // License CRUD
  getAllLicenses() {
    return this.getLicensesData().map(lic => ({
      id: lic.id,
      email: lic.email,
      name: lic.name,
      isActive: lic.isActive,
      createdAt: lic.createdAt,
      notes: lic.notes || '-',
      isOnline: !!lic.activeSessionToken,
      lastLoginAt: lic.lastLoginAt,
      lastDeviceInfo: lic.lastDeviceInfo,
      lastIp: lic.lastIp,
      loginCount: lic.loginCount || 0
    }));
  }

  addLicense(email, name, notes) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(name || '').trim();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Format email tidak valid.');
    }

    const licenses = this.getLicensesData();
    if (licenses.some(l => l.email.toLowerCase() === cleanEmail)) {
      throw new Error('Email lisensi ini sudah terdaftar sebelumnya.');
    }

    const newLic = {
      id: crypto.randomUUID(),
      email: cleanEmail,
      name: cleanName || cleanEmail.split('@')[0],
      isActive: true,
      createdAt: new Date().toISOString(),
      notes: notes || 'Pembelian Lisensi BuatDigital.id',
      activeSessionToken: null,
      lastLoginAt: null,
      lastDeviceInfo: null,
      lastIp: null,
      loginCount: 0
    };

    licenses.push(newLic);
    this.saveLicensesData(licenses);
    return newLic;
  }

  toggleLicense(id) {
    const licenses = this.getLicensesData();
    const lic = licenses.find(l => l.id === id);
    if (!lic) throw new Error('Lisensi tidak ditemukan.');

    lic.isActive = !lic.isActive;
    if (!lic.isActive) {
      // If disabled, force logout
      lic.activeSessionToken = null;
    }
    this.saveLicensesData(licenses);
    return lic;
  }

  forceLogout(id) {
    const licenses = this.getLicensesData();
    const lic = licenses.find(l => l.id === id);
    if (!lic) throw new Error('Lisensi tidak ditemukan.');

    lic.activeSessionToken = null;
    this.saveLicensesData(licenses);
    return true;
  }

  deleteLicense(id) {
    let licenses = this.getLicensesData();
    const initialLen = licenses.length;
    licenses = licenses.filter(l => l.id !== id);
    if (licenses.length === initialLen) {
      throw new Error('Lisensi tidak ditemukan.');
    }
    this.saveLicensesData(licenses);
    return true;
  }

  // User Login & Session Management (1 Active Device Guarantee)
  loginLicense(email, deviceInfo = {}, ip = '') {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const licenses = this.getLicensesData();
    const lic = licenses.find(l => l.email.toLowerCase() === cleanEmail);

    if (!lic) {
      return {
        success: false,
        error: 'Email tidak terdaftar sebagai lisensi resmi. Silakan hubungi admin BuatDigital.id untuk mendapatkan lisensi.'
      };
    }

    if (!lic.isActive) {
      return {
        success: false,
        error: 'Lisensi email Anda saat ini dinonaktifkan. Silakan hubungi admin BuatDigital.id.'
      };
    }

    // Generate NEW unique session token.
    // This immediately invalidates any previously active session on other devices!
    const newSessionToken = crypto.randomBytes(32).toString('hex');

    lic.activeSessionToken = newSessionToken;
    lic.lastLoginAt = new Date().toISOString();
    lic.lastDeviceInfo = deviceInfo.userAgent || 'Web Browser';
    lic.lastIp = ip || deviceInfo.ip || '127.0.0.1';
    lic.loginCount = (lic.loginCount || 0) + 1;

    this.saveLicensesData(licenses);

    return {
      success: true,
      license: {
        id: lic.id,
        email: lic.email,
        name: lic.name
      },
      sessionToken: newSessionToken
    };
  }

  logoutLicense(email, sessionToken) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const licenses = this.getLicensesData();
    const lic = licenses.find(l => l.email.toLowerCase() === cleanEmail);

    if (lic && lic.activeSessionToken === sessionToken) {
      lic.activeSessionToken = null;
      this.saveLicensesData(licenses);
    }
    return true;
  }

  verifySession(email, sessionToken) {
    if (!email || !sessionToken) return false;
    const cleanEmail = String(email || '').trim().toLowerCase();
    const licenses = this.getLicensesData();
    const lic = licenses.find(l => l.email.toLowerCase() === cleanEmail);

    if (!lic || !lic.isActive) return false;

    // Must match the exact activeSessionToken
    return lic.activeSessionToken === sessionToken;
  }

  getSettings() {
    initAdmin();
    try {
      const raw = fs.readFileSync(ADMIN_FILE, 'utf8');
      const data = JSON.parse(raw);
      return {
        proxyUrl: data.proxyUrl || '',
        updatedAt: data.updatedAt || new Date().toISOString()
      };
    } catch (e) {
      return { proxyUrl: '' };
    }
  }

  updateSettings({ proxyUrl }) {
    initAdmin();
    const raw = fs.readFileSync(ADMIN_FILE, 'utf8');
    const data = JSON.parse(raw);
    data.proxyUrl = String(proxyUrl || '').trim();
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(data, null, 2));
    return this.getSettings();
  }

  getProxyUrl() {
    return this.getSettings().proxyUrl || process.env.PROXY_URL || process.env.WARP_PROXY || '';
  }
}

module.exports = new LicenseService();
