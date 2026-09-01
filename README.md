# Aplikasi Cek Desil Massal Kemensos (DTSEN)

Aplikasi otomasi pengecekan desil dan status bansos (Sembako, PKH, PBI-JK) secara massal dari file Excel dengan multi-pass auto-captcha solver OCR, sistem lisensi 1 perangkat aktif, dan panel kontrol admin. Dikembangkan oleh BuatDigital.id.

---

## 🚀 Fitur Utama

- **Pengecekan Massal Cepat**: Import ribuan NIK dari format Excel / CSV.
- **Auto-Captcha Solver OCR**: Multi-pass adaptive contrast OCR otomatis bypass captcha Kemensos.
- **Deteksi Desil & Bansos Lengkap**: Mengambil informasi Desil 1–10, status Sembako/BPNT, PKH, dan PBI-JK.
- **Export Hasil Excel Terformat**: Format Excel rapi dengan styling dan pewarnaan badge desil otomatis.
- **Sistem Lisensi 1 Perangkat Aktif**: Single active session lock dengan auto-logout perangkat sebelumnya.
- **Dashboard Admin**: Manajemen lisensi pengguna, aktivasi email pembeli, dan ganti PIN.

---

## 🛠️ Deployment VPS aaPanel (Port 3000)

1. Clone di folder `/www/wwwroot/cekdesil.buatdigital.id`
2. Install dependencies: `npm install --production`
3. Tambahkan Node project di aaPanel pada Port `3000` dengan domain `cekdesil.buatdigital.id`.

---

© 2026 BuatDigital.id
