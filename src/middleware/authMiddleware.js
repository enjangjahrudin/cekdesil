const licenseService = require('../services/licenseService');

/**
 * Middleware to protect user application endpoints
 * Ensures the license is active and the session token matches the single active device
 */
function requireLicenseAuth(req, res, next) {
  // Support headers, query params (for SSE/Export links), or auth header
  const email = req.headers['x-license-email'] || req.query.licenseEmail;
  const sessionToken = req.headers['x-session-token'] || req.query.sessionToken;

  if (!email || !sessionToken) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Akses ditolak. Silakan login dengan lisensi email Anda.'
    });
  }

  const isValid = licenseService.verifySession(email, sessionToken);

  if (!isValid) {
    return res.status(401).json({
      error: 'SESSION_OVERRIDDEN',
      message: 'Sesi Anda telah berakhir karena lisensi ini telah login di perangkat lain atau dinonaktifkan.'
    });
  }

  req.licenseUser = { email };
  next();
}

/**
 * Middleware to protect admin dashboard endpoints
 */
function requireAdminAuth(req, res, next) {
  const adminToken = req.headers['x-admin-token'] || req.query.adminToken;

  if (!adminToken || !licenseService.verifyAdminSession(adminToken)) {
    return res.status(403).json({
      error: 'ADMIN_FORBIDDEN',
      message: 'Akses panel admin ditolak. Silakan login sebagai admin terlebih dahulu.'
    });
  }

  next();
}

module.exports = {
  requireLicenseAuth,
  requireAdminAuth
};
