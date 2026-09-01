const EventEmitter = require('events');
const { checkNik } = require('./kemensosScraper');

class QueueManager extends EventEmitter {
  constructor() {
    super();
    this.items = [];
    this.currentIndex = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.delayMs = 2500; // default 2.5s delay to be friendly to Kemensos servers
    this.clients = [];
  }

  setItems(newItems) {
    this.items = newItems;
    this.currentIndex = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.broadcastState();
  }

  clear() {
    this.items = [];
    this.currentIndex = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.broadcastState();
  }

  retryFailed() {
    if (this.isRunning) return;

    let failedCount = 0;
    this.items.forEach(item => {
      // If item is NOT successfully processed (neither Ditemukan nor Tidak Ditemukan)
      if (item.status !== 'Ditemukan' && item.status !== 'Tidak Ditemukan') {
        item.status = 'Antrean';
        item.rawText = '-';
        failedCount++;
      }
    });

    if (failedCount > 0) {
      this.currentIndex = 0;
      this.isRunning = true;
      this.isPaused = false;
      this.broadcastState();
      this.processQueue();
    }
  }

  getItems() {
    return this.items;
  }

  setDelay(ms) {
    this.delayMs = Math.max(1000, Number(ms) || 2500);
  }

  addClient(res) {
    this.clients.push(res);
    // Send initial state immediately
    res.write(`data: ${JSON.stringify({ type: 'INIT', data: this.getState() })}\n\n`);
  }

  removeClient(res) {
    this.clients = this.clients.filter(c => c !== res);
  }

  broadcast(type, data) {
    const payload = `data: ${JSON.stringify({ type, data })}\n\n`;
    this.clients.forEach(client => {
      try {
        client.write(payload);
      } catch (err) {
        // connection closed
      }
    });
  }

  broadcastState() {
    this.broadcast('STATE_CHANGE', this.getState());
  }

  getState() {
    const total = this.items.length;
    let completed = 0;
    let successDitemukan = 0;
    let tidakDitemukan = 0;
    let errorCount = 0;

    let desil1_4 = 0;
    let desil5 = 0;
    let desil6_10 = 0;

    this.items.forEach(item => {
      if (item.status && item.status !== 'Antrean' && item.status !== 'Sedang Memproses') {
        completed++;
        if (item.status === 'Ditemukan') {
          successDitemukan++;
          const d = String(item.desil || '').trim();
          if (['1', '2', '3', '4'].includes(d)) desil1_4++;
          else if (d === '5') desil5++;
          else if (d.includes('6') || d.includes('10')) desil6_10++;
        } else if (item.status === 'Tidak Ditemukan') {
          tidakDitemukan++;
        } else {
          errorCount++;
        }
      }
    });

    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      delayMs: this.delayMs,
      currentIndex: this.currentIndex,
      total,
      completed,
      successDitemukan,
      tidakDitemukan,
      errorCount,
      desilSummary: {
        desil1_4,
        desil5,
        desil6_10
      },
      items: this.items
    };
  }

  async start() {
    if (this.isRunning && !this.isPaused) return;

    if (this.isPaused) {
      this.isPaused = false;
      this.isRunning = true;
      this.broadcastState();
      this.processQueue();
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.broadcastState();
    this.processQueue();
  }

  pause() {
    if (!this.isRunning) return;
    this.isPaused = true;
    this.broadcastState();
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.broadcastState();
  }

  async processQueue() {
    while (this.isRunning && !this.isPaused && this.currentIndex < this.items.length) {
      const index = this.currentIndex;
      const currentItem = this.items[index];

      // Skip already successfully completed items (Ditemukan or Tidak Ditemukan)
      if (currentItem.status === 'Ditemukan' || currentItem.status === 'Tidak Ditemukan') {
        this.currentIndex++;
        continue;
      }

      // Mark processing
      currentItem.status = 'Sedang Memproses';
      this.broadcast('ITEM_PROCESSING', { index, item: currentItem });

      try {
        const result = await checkNik(currentItem.nik);

        currentItem.status = result.status;
        currentItem.namaMasked = result.namaMasked || '-';
        currentItem.desil = result.desil || '-';
        currentItem.dtsenPeriod = result.dtsenPeriod || '-';
        currentItem.sembakoStatus = result.sembakoStatus || '-';
        currentItem.sembakoPeriode = result.sembakoPeriode || '-';
        currentItem.pkhStatus = result.pkhStatus || '-';
        currentItem.pkhPeriode = result.pkhPeriode || '-';
        currentItem.pbiStatus = result.pbiStatus || '-';
        currentItem.pbiPeriode = result.pbiPeriode || '-';
        currentItem.pbiKeterangan = result.pbiKeterangan || '-';
        currentItem.kpdStatus = result.kpdStatus || '-';
        currentItem.rawText = result.rawText || result.error || '-';
        currentItem.timestamp = new Date().toISOString();

        this.broadcast('ITEM_COMPLETED', { index, item: currentItem, summary: this.getState() });

      } catch (err) {
        currentItem.status = 'Error';
        currentItem.rawText = err.message;
        currentItem.timestamp = new Date().toISOString();
        this.broadcast('ITEM_COMPLETED', { index, item: currentItem, summary: this.getState() });
      }

      this.currentIndex++;

      // Check if paused or stopped before waiting delay
      if (!this.isRunning || this.isPaused) break;

      // Wait delay between requests to be gentle on Kemensos server
      if (this.currentIndex < this.items.length) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
      }
    }

    if (this.currentIndex >= this.items.length) {
      this.isRunning = false;
      this.isPaused = false;
      this.broadcast('ALL_COMPLETED', this.getState());
    }
  }
}

module.exports = new QueueManager();
