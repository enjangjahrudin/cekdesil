const cheerio = require('cheerio');
const { solveCaptcha } = require('./captchaSolver');

const BASE_URL = 'https://cekbansos.kemensos.go.id';

/**
 * Cookie Manager Helper
 */
class CookieJar {
  constructor() {
    this.cookies = {};
  }

  updateFromResponse(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    raw.forEach(c => {
      if (!c) return;
      const [nameVal] = c.split(';');
      const [name, val] = nameVal.split('=');
      if (name && val) {
        this.cookies[name.trim()] = val.trim();
      }
    });
  }

  getHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

/**
 * Parse HTML response from Kemensos to extract Desil & Bansos table data
 */
function parseResultHtml(html, nik) {
  const $ = cheerio.load(html);

  // Check if response contains table
  const table = $('table');
  const dtsenBadge = $('span:contains("DTSEN"), .badge:contains("DTSEN"), h5:contains("DTSEN"), div:contains("DTSEN")').text().trim();
  const periodMatch = html.match(/DTSEN\s+TRIWULAN\s+\d+\s+\d{4}/i);
  const dtsenPeriod = periodMatch ? periodMatch[0] : (dtsenBadge || 'DTSEN');

  // Check if table exists
  if (table.length > 0) {
    const rows = $('tbody tr');
    let matchedRow = rows.first();

    // If multiple rows, look for the data row
    if (rows.length > 1) {
      rows.each((i, el) => {
        const tds = $(el).find('td');
        if (tds.length >= 6) {
          matchedRow = $(el);
          return false;
        }
      });
    }

    const cells = matchedRow.find('td').map((i, el) => $(el).text().trim().replace(/\s+/g, ' ')).get();

    if (cells.length >= 6) {
      return {
        status: 'Ditemukan',
        dtsenPeriod,
        namaMasked: cells[0] || '-',
        desil: cells[1] || '-',
        sembakoStatus: (cells[2] || '-').toUpperCase(),
        sembakoPeriode: cells[3] || '-',
        pkhStatus: (cells[4] || '-').toUpperCase(),
        pkhPeriode: cells[5] || '-',
        pbiStatus: (cells[6] || '-').toUpperCase(),
        pbiPeriode: cells[7] || '-',
        pbiKeterangan: cells[8] || '-',
        kpdStatus: (cells[9] || '-').toUpperCase(),
        rawText: cells.join(' | ')
      };
    }
  }

  // Check for "Tidak Ditemukan" or empty message
  const bodyText = $('body').text();
  if (
    bodyText.includes('Tidak Ditemukan') || 
    bodyText.includes('tidak ditemukan') ||
    bodyText.includes('Data Tidak Terdaftar') ||
    bodyText.includes('NIK Tidak Ditemukan') ||
    bodyText.includes('tidak terdaftar')
  ) {
    return {
      status: 'Tidak Ditemukan',
      dtsenPeriod,
      namaMasked: '-',
      desil: 'Tidak Terdaftar',
      sembakoStatus: 'TIDAK',
      sembakoPeriode: '-',
      pkhStatus: 'TIDAK',
      pkhPeriode: '-',
      pbiStatus: 'TIDAK',
      pbiPeriode: '-',
      pbiKeterangan: '-',
      kpdStatus: 'TIDAK',
      rawText: 'Data NIK tidak ditemukan dalam DTSEN / Kemensos'
    };
  }

  // Fallback
  return {
    status: 'Tidak Ditemukan',
    dtsenPeriod,
    namaMasked: '-',
    desil: 'Tidak Terdaftar',
    sembakoStatus: 'TIDAK',
    sembakoPeriode: '-',
    pkhStatus: 'TIDAK',
    pkhPeriode: '-',
    pbiStatus: 'TIDAK',
    pbiPeriode: '-',
    pbiKeterangan: '-',
    kpdStatus: 'TIDAK',
    rawText: 'Tidak ada data tabel yang sesuai'
  };
}

/**
 * Check single NIK on Kemensos website with automatic captcha retry
 * @param {string} nik 
 * @param {number} maxRetries 
 * @returns {Promise<Object>}
 */
async function checkNik(nik, maxRetries = 35) {
  let attempt = 0;
  const cleanNik = String(nik).trim().replace(/[^0-9]/g, '');

  if (cleanNik.length !== 16) {
    return {
      success: false,
      nik: cleanNik,
      status: 'Format NIK Salah',
      error: 'NIK harus 16 digit angka',
      desil: '-',
      sembakoStatus: '-',
      sembakoPeriode: '-',
      pkhStatus: '-',
      pkhPeriode: '-',
      pbiStatus: '-',
      pbiPeriode: '-',
      pbiKeterangan: '-',
      kpdStatus: '-'
    };
  }

  while (attempt < maxRetries) {
    attempt++;
    try {
      const jar = new CookieJar();

      // 1. Get initial session and CSRF token
      const res1 = await fetch(`${BASE_URL}/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
      });
      jar.updateFromResponse(res1);

      const html1 = await res1.text();
      const tokenMatch = html1.match(/name="_token"\s+value="([^"]+)"/);
      const csrfToken = tokenMatch ? tokenMatch[1] : '';

      if (!csrfToken) {
        throw new Error('Gagal mendapatkan token CSRF dari Kemensos');
      }

      // 2. Fetch captcha image with current cookies and update session
      const captchaUrl = `${BASE_URL}/captcha/flat?${Math.random()}`;
      const res2 = await fetch(captchaUrl, {
        headers: {
          'Cookie': jar.getHeader(),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `${BASE_URL}/`
        }
      });
      jar.updateFromResponse(res2);

      const captchaBuffer = Buffer.from(await res2.arrayBuffer());
      
      // 3. Solve captcha via OCR
      const captchaText = await solveCaptcha(captchaBuffer);
      if (!captchaText || captchaText.length < 3) {
        await new Promise(r => setTimeout(r, 300));
        continue;
      }

      // 4. Submit form (Note: input name is nik_input)
      const bodyParams = new URLSearchParams();
      bodyParams.append('_token', csrfToken);
      bodyParams.append('nik_input', cleanNik);
      bodyParams.append('captcha', captchaText);
      bodyParams.append('ippub_client', '');

      const postRes = await fetch(`${BASE_URL}/cekbansos_nik`, {
        method: 'POST',
        headers: {
          'Cookie': jar.getHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `${BASE_URL}/`,
          'Origin': BASE_URL
        },
        body: bodyParams.toString()
      });
      jar.updateFromResponse(postRes);

      const responseHtml = await postRes.text();

      // Check if captcha was wrong
      if (
        responseHtml.includes('Kode Captcha salah') ||
        responseHtml.includes('Huruf kode tidak sesuai') || 
        responseHtml.includes('Huruf kode salah') ||
        responseHtml.includes('captcha tidak valid')
      ) {
        // Captcha was wrong, retry with fresh session
        await new Promise(r => setTimeout(r, 400));
        continue;
      }

      // Captcha accepted, parse result
      const parsed = parseResultHtml(responseHtml, cleanNik);
      return {
        success: true,
        nik: cleanNik,
        attempt,
        ...parsed
      };

    } catch (err) {
      console.error(`Attempt ${attempt} error for NIK ${cleanNik}:`, err.message);
      await new Promise(r => setTimeout(r, 600));
      if (attempt >= maxRetries) {
        return {
          success: false,
          nik: cleanNik,
          status: 'Error Server/Koneksi',
          error: err.message,
          desil: 'Error',
          sembakoStatus: '-',
          sembakoPeriode: '-',
          pkhStatus: '-',
          pkhPeriode: '-',
          pbiStatus: '-',
          pbiPeriode: '-',
          pbiKeterangan: '-',
          kpdStatus: '-'
        };
      }
    }
  }

  return {
    success: false,
    nik: cleanNik,
    status: 'Gagal Membaca Captcha',
    error: `Gagal menyelesaikan captcha setelah ${maxRetries} kali percobaan`,
    desil: 'Gagal Captcha',
    sembakoStatus: '-',
    sembakoPeriode: '-',
    pkhStatus: '-',
    pkhPeriode: '-',
    pbiStatus: '-',
    pbiPeriode: '-',
    pbiKeterangan: '-',
    kpdStatus: '-'
  };
}

module.exports = {
  checkNik,
  parseResultHtml
};
