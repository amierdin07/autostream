const si = require('systeminformation');
const fs = require('fs');
const path = require('path');

const USAGE_FILE = path.join(__dirname, '../db/network_usage.json');

let previousNetworkData = null;
let previousTimestamp = null;

// Helper to determine the current cycle key (Format: YYYY-MM-DD)
// The cycle resets on the configured reset_day (default 15) at 00:00:00.
function getCurrentCycleKey(date = new Date(), resetDay = 15) {
  const daySetting = Math.max(1, Math.min(31, parseInt(resetDay) || 15));
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed (0 = Jan)
  const day = date.getDate();

  if (day >= daySetting) {
    // Current cycle started on daySetting of this month
    const m = String(month + 1).padStart(2, '0');
    const d = String(daySetting).padStart(2, '0');
    return `${year}-${m}-${d}`;
  } else {
    // Current cycle started on daySetting of previous month
    const prev = new Date(year, month - 1, 1);
    const lastDayOfPrevMonth = new Date(year, month, 0).getDate();
    const actualDay = Math.min(daySetting, lastDayOfPrevMonth);
    const prevYear = prev.getFullYear();
    const prevM = String(prev.getMonth() + 1).padStart(2, '0');
    const d = String(actualDay).padStart(2, '0');
    return `${prevYear}-${prevM}-${d}`;
  }
}

function getNextResetDate(cycleKey, resetDay = 15) {
  if (!cycleKey) return '';
  const daySetting = Math.max(1, Math.min(31, parseInt(resetDay) || 15));
  const [y, m, d] = cycleKey.split('-').map(Number);
  const lastDayOfNextMonth = new Date(y, m + 1, 0).getDate();
  const actualDay = Math.min(daySetting, lastDayOfNextMonth);
  const nextDate = new Date(y, m, actualDay);
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
}

// In-memory persistent usage state
let usageState = null;
let lastSaveTime = 0;
let isDirty = false;

function loadUsageState() {
  try {
    if (fs.existsSync(USAGE_FILE)) {
      const content = fs.readFileSync(USAGE_FILE, 'utf8');
      usageState = JSON.parse(content);
    }
  } catch (err) {
    console.error('[NetworkUsage] Error reading usage file:', err.message);
  }

  const resetDay = usageState && usageState.reset_day ? usageState.reset_day : 15;
  const currentCycle = getCurrentCycleKey(new Date(), resetDay);
  if (!usageState || !usageState.cycle_key) {
    usageState = {
      cycle_key: currentCycle,
      reset_day: resetDay,
      rx_bytes: 0,
      tx_bytes: 0,
      last_raw_rx: 0,
      last_raw_tx: 0,
      initialized: false,
      last_updated: Date.now()
    };
    saveUsageState(true);
  } else {
    if (!usageState.reset_day) {
      usageState.reset_day = 15;
    }
    if (usageState.cycle_key !== currentCycle) {
      console.log(`[NetworkUsage] Monthly rollover on day ${resetDay}: ${usageState.cycle_key} -> ${currentCycle}. Resetting usage.`);
      usageState.cycle_key = currentCycle;
      usageState.rx_bytes = 0;
      usageState.tx_bytes = 0;
      saveUsageState(true);
    }
  }
}

function saveUsageState(force = false) {
  if (!usageState) return;
  const now = Date.now();
  if (force || (isDirty && now - lastSaveTime >= 15000)) {
    try {
      usageState.last_updated = now;
      const tmpFile = USAGE_FILE + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(usageState, null, 2), 'utf8');
      fs.renameSync(tmpFile, USAGE_FILE);
      lastSaveTime = now;
      isDirty = false;
    } catch (err) {
      console.error('[NetworkUsage] Error saving usage file:', err.message);
    }
  }
}

// Save state on graceful process exit
process.on('SIGINT', () => { saveUsageState(true); });
process.on('SIGTERM', () => { saveUsageState(true); });
process.on('exit', () => { saveUsageState(true); });

// Initialize state immediately
loadUsageState();

function getResetDay() {
  if (!usageState) loadUsageState();
  return usageState && usageState.reset_day ? usageState.reset_day : 15;
}

function setResetDay(newDay) {
  if (!usageState) loadUsageState();
  const day = Math.max(1, Math.min(31, parseInt(newDay) || 15));
  usageState.reset_day = day;
  const currentCycle = getCurrentCycleKey(new Date(), day);
  if (usageState.cycle_key !== currentCycle) {
    console.log(`[NetworkUsage] Reset day changed to ${day}. Updating cycle key: ${usageState.cycle_key} -> ${currentCycle}`);
    usageState.cycle_key = currentCycle;
  }
  isDirty = true;
  saveUsageState(true);
  return {
    success: true,
    resetDay: day,
    cycleStart: usageState.cycle_key,
    nextReset: getNextResetDate(usageState.cycle_key, day)
  };
}

function resetUsageNow() {
  if (!usageState) loadUsageState();
  usageState.rx_bytes = 0;
  usageState.tx_bytes = 0;
  isDirty = true;
  saveUsageState(true);
  return {
    success: true,
    message: 'Data pemakaian jaringan berhasil di-reset ke 0 B'
  };
}

function updateNetworkUsage(rawRx, rawTx) {
  if (!usageState) {
    loadUsageState();
  }

  if (rawRx === 0 && rawTx === 0) {
    return;
  }

  const resetDay = usageState.reset_day || 15;
  const currentCycle = getCurrentCycleKey(new Date(), resetDay);
  if (usageState.cycle_key !== currentCycle) {
    console.log(`[NetworkUsage] Monthly reset reached on day ${resetDay}: ${usageState.cycle_key} -> ${currentCycle}`);
    usageState.cycle_key = currentCycle;
    usageState.rx_bytes = 0;
    usageState.tx_bytes = 0;
    usageState.last_raw_rx = rawRx;
    usageState.last_raw_tx = rawTx;
    saveUsageState(true);
    return;
  }

  if (!usageState.initialized) {
    // Initial run: adopt current raw counters from OS as starting baseline for this cycle
    usageState.rx_bytes = rawRx;
    usageState.tx_bytes = rawTx;
    usageState.last_raw_rx = rawRx;
    usageState.last_raw_tx = rawTx;
    usageState.initialized = true;
    saveUsageState(true);
    return;
  }

  let deltaRx = 0;
  let deltaTx = 0;

  if (rawRx >= usageState.last_raw_rx) {
    deltaRx = rawRx - usageState.last_raw_rx;
  } else {
    // Server rebooted! raw counter was reset in /proc/net/dev
    deltaRx = rawRx;
  }

  if (rawTx >= usageState.last_raw_tx) {
    deltaTx = rawTx - usageState.last_raw_tx;
  } else {
    // Server rebooted! raw counter was reset in /proc/net/dev
    deltaTx = rawTx;
  }

  if (deltaRx > 0 || deltaTx > 0) {
    usageState.rx_bytes += deltaRx;
    usageState.tx_bytes += deltaTx;
    usageState.last_raw_rx = rawRx;
    usageState.last_raw_tx = rawTx;
    isDirty = true;
    saveUsageState(false);
  } else {
    usageState.last_raw_rx = rawRx;
    usageState.last_raw_tx = rawTx;
  }
}

// Background network stats collector so usage is tracked 24/7 even when dashboard is closed
let backgroundPollTimer = setInterval(async () => {
  try {
    const networkData = await si.networkStats();
    calculateNetworkSpeed(networkData);
    if (isDirty) {
      saveUsageState(false);
    }
  } catch (err) {
    // Ignore background poll errors
  }
}, 10000);

if (backgroundPollTimer && backgroundPollTimer.unref) {
  backgroundPollTimer.unref();
}

async function getSystemStats() {
  try {
    const [cpuData, memData, networkData, diskData] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.networkStats(),
      getDiskUsage()
    ]);
    
    const cpuUsage = cpuData.currentLoad || cpuData.avg || 0;
    
    const networkSpeed = calculateNetworkSpeed(networkData);
    
    const formatMemory = (bytes) => {
      if (bytes >= 1073741824) {
        return (bytes / 1073741824).toFixed(2) + " GB";
      } else {
        return (bytes / 1048576).toFixed(2) + " MB";
      }
    };
    
    return {
      cpu: {
        usage: Math.round(cpuUsage),
        cores: cpuData.cpus ? cpuData.cpus.length : 0
      },
      memory: {
        total: formatMemory(memData.total),
        used: formatMemory(memData.active),
        free: formatMemory(memData.available),
        usagePercent: Math.round((memData.active / memData.total) * 100)
      },
      network: networkSpeed,
      disk: diskData,
      platform: process.platform,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('Error getting system stats:', error);
    const resetDay = usageState ? (usageState.reset_day || 15) : 15;
    const cycleStart = usageState ? usageState.cycle_key : getCurrentCycleKey(new Date(), resetDay);
    return {
      cpu: { usage: 0, cores: 0 },
      memory: { total: "0 GB", used: "0 GB", free: "0 GB", usagePercent: 0 },
      network: { 
        download: 0, 
        upload: 0, 
        downloadFormatted: '0 Mbps', 
        uploadFormatted: '0 Mbps',
        totalDownload: usageState ? usageState.rx_bytes : 0, 
        totalUpload: usageState ? usageState.tx_bytes : 0,
        totalDownloadFormatted: usageState ? formatBytes(usageState.rx_bytes) : '0 B',
        totalUploadFormatted: usageState ? formatBytes(usageState.tx_bytes) : '0 B',
        cycleStart: cycleStart,
        nextReset: getNextResetDate(cycleStart, resetDay),
        resetDay: resetDay
      },
      disk: { total: "0 GB", used: "0 GB", free: "0 GB", usagePercent: 0, drive: "N/A" },
      platform: process.platform,
      timestamp: Date.now()
    };
  }
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

function calculateNetworkSpeed(networkData) {
  const currentTimestamp = Date.now();
  const networkList = Array.isArray(networkData) ? networkData : [];

  const currentTotal = networkList
    .filter(iface => iface && iface.iface && !iface.iface.includes('lo') && !iface.iface.includes('Loopback'))
    .reduce((acc, iface) => ({
      rx_bytes: acc.rx_bytes + (iface.rx_bytes || 0),
      tx_bytes: acc.tx_bytes + (iface.tx_bytes || 0)
    }), { rx_bytes: 0, tx_bytes: 0 });

  updateNetworkUsage(currentTotal.rx_bytes, currentTotal.tx_bytes);

  const displayRx = usageState ? usageState.rx_bytes : currentTotal.rx_bytes;
  const displayTx = usageState ? usageState.tx_bytes : currentTotal.tx_bytes;
  const totalDownloadFormatted = formatBytes(displayRx);
  const totalUploadFormatted = formatBytes(displayTx);
  const resetDay = usageState ? (usageState.reset_day || 15) : 15;
  const cycleStart = usageState ? usageState.cycle_key : getCurrentCycleKey(new Date(), resetDay);
  const nextReset = getNextResetDate(cycleStart, resetDay);

  if (!previousNetworkData || !previousTimestamp) {
    previousNetworkData = networkData;
    previousTimestamp = currentTimestamp;
    return {
      download: 0,
      upload: 0,
      downloadFormatted: '0 Mbps',
      uploadFormatted: '0 Mbps',
      totalDownload: displayRx,
      totalUpload: displayTx,
      totalDownloadFormatted: totalDownloadFormatted,
      totalUploadFormatted: totalUploadFormatted,
      cycleStart: cycleStart,
      nextReset: nextReset,
      resetDay: resetDay
    };
  }
  
  const timeDiff = (currentTimestamp - previousTimestamp) / 1000;
  const prevList = Array.isArray(previousNetworkData) ? previousNetworkData : [];
  
  const previousTotal = prevList
    .filter(iface => iface && iface.iface && !iface.iface.includes('lo') && !iface.iface.includes('Loopback'))
    .reduce((acc, iface) => ({
      rx_bytes: acc.rx_bytes + (iface.rx_bytes || 0),
      tx_bytes: acc.tx_bytes + (iface.tx_bytes || 0)
    }), { rx_bytes: 0, tx_bytes: 0 });
  
  const safeTimeDiff = timeDiff > 0 ? timeDiff : 1;
  const downloadBps = Math.max(0, (currentTotal.rx_bytes - previousTotal.rx_bytes) / safeTimeDiff);
  const uploadBps = Math.max(0, (currentTotal.tx_bytes - previousTotal.tx_bytes) / safeTimeDiff);
  
  const downloadMbps = (downloadBps * 8) / (1024 * 1024);
  const uploadMbps = (uploadBps * 8) / (1024 * 1024);
  
  previousNetworkData = networkData;
  previousTimestamp = currentTimestamp;
  
  return {
    download: downloadMbps,
    upload: uploadMbps,
    downloadFormatted: formatSpeed(downloadMbps),
    uploadFormatted: formatSpeed(uploadMbps),
    totalDownload: displayRx,
    totalUpload: displayTx,
    totalDownloadFormatted: totalDownloadFormatted,
    totalUploadFormatted: totalUploadFormatted,
    cycleStart: cycleStart,
    nextReset: nextReset,
    resetDay: resetDay
  };
}

function formatSpeed(speedMbps) {
  if (speedMbps >= 1000) {
    return (speedMbps / 1000).toFixed(2) + ' Gbps';
  } else if (speedMbps >= 1) {
    return speedMbps.toFixed(2) + ' Mbps';
  } else {
    return (speedMbps * 1000).toFixed(0) + ' Kbps';
  }
}

async function getDiskUsage() {
  try {
    const fsSize = await si.fsSize();
    const platform = process.platform;
    
    let targetDisk;
    
    if (platform === 'win32') {
      const currentDrive = process.cwd().charAt(0).toUpperCase();
      targetDisk = fsSize.find(disk => disk.mount.charAt(0).toUpperCase() === currentDrive);
      
      if (!targetDisk) {
        targetDisk = fsSize.find(disk => disk.mount.charAt(0).toUpperCase() === 'C');
      }
    } else {
      targetDisk = fsSize.find(disk => disk.mount === '/');
    }
    
    if (!targetDisk) {
      targetDisk = fsSize[0];
    }
    
    if (!targetDisk) {
      return {
        total: "0 GB",
        used: "0 GB", 
        free: "0 GB", 
        usagePercent: 0,
        drive: "N/A"
      };
    }
    
    const formatDisk = (bytes) => {
      if (bytes >= 1099511627776) {
        return (bytes / 1099511627776).toFixed(2) + " TB";
      } else if (bytes >= 1073741824) {
        return (bytes / 1073741824).toFixed(2) + " GB";
      } else {
        return (bytes / 1048576).toFixed(2) + " MB";
      }
    };
    
    const usagePercent = targetDisk.size > 0 ? 
      Math.round(((targetDisk.size - targetDisk.available) / targetDisk.size) * 100) : 0;
    
    return {
      total: formatDisk(targetDisk.size),
      used: formatDisk(targetDisk.size - targetDisk.available),
      free: formatDisk(targetDisk.available),
      usagePercent: usagePercent,
      drive: targetDisk.mount || targetDisk.fs || "Unknown"
    };
  } catch (error) {
    console.error('Error getting disk usage:', error);
    return {
      total: "0 GB",
      used: "0 GB", 
      free: "0 GB", 
      usagePercent: 0,
      drive: "N/A"
    };
  }
}

module.exports = { 
  getSystemStats,
  getResetDay,
  setResetDay,
  resetUsageNow
};