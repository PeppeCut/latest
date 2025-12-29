// Application state
let chart;
let cycleDetector;
let cycleMomentum;
let cycleBot;
let currentSymbol = 'SUIUSDT';
let currentTimeframe = '1m';
let isLoading = false;
let currentManualCycle = null; // {startIndex, endIndex}

// Trade table filter/sort state
let tradeFilterType = 'all';
let tradeFilterExit = 'all';
let tradeFilterResult = 'all';
let tradeSortColumn = 'time';
let tradeSortDirection = 'desc';



// Timeframe mapping for Binance API
const timeframeMap = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '4h': '4h',
    '1d': '1d'
};

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('chart-canvas');
    chart = new CandlestickChart(canvas);
    cycleDetector = new CycleDetector();
    cycleMomentum = new CycleSwingMomentum();
    cycleBot = new CycleTradingBot();

    setupEventListeners();
    setupBotWidget();
    setupTradeTableFilters();
    loadChartData();

    // Auto-refresh every 5 seconds
    setInterval(() => {
        loadChartData(true);
    }, 5000);

    // Candle countdown timer - update every second
    setInterval(updateCandleCountdown, 1000);
    updateCandleCountdown();
});

// Calculate and update candle countdown
function updateCandleCountdown() {
    const countdownEl = document.getElementById('candle-countdown');
    if (!countdownEl) return;

    // Get timeframe in milliseconds
    const timeframeMs = {
        '1m': 60 * 1000,
        '5m': 5 * 60 * 1000,
        '15m': 15 * 60 * 1000,
        '30m': 30 * 60 * 1000,
        '1h': 60 * 60 * 1000,
        '4h': 4 * 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000
    };

    const intervalMs = timeframeMs[currentTimeframe] || 60000;
    const now = Date.now();
    const candleStart = Math.floor(now / intervalMs) * intervalMs;
    const candleEnd = candleStart + intervalMs;
    const remaining = candleEnd - now;

    // Format as MM:SS or HH:MM:SS
    const totalSeconds = Math.floor(remaining / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let display;
    if (hours > 0) {
        display = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } else {
        display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    countdownEl.textContent = display;
}

function setupEventListeners() {
    // Cryptocurrency selector
    const cryptoSelect = document.getElementById('crypto-select');
    cryptoSelect.addEventListener('change', (e) => {
        currentSymbol = e.target.value;
        loadChartData();
    });

    // Mobile Menu Toggle
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const controlsPanel = document.querySelector('.controls-panel');
    const menuOverlay = document.getElementById('menu-overlay');

    function toggleMenu() {
        controlsPanel.classList.toggle('active');
        menuOverlay.classList.toggle('active');
        document.body.style.overflow = controlsPanel.classList.contains('active') ? 'hidden' : ''; // Prevent body scroll
    }

    if (hamburgerBtn) hamburgerBtn.addEventListener('click', toggleMenu);
    if (menuOverlay) menuOverlay.addEventListener('click', toggleMenu);

    // Timeframe buttons
    const tfButtons = document.querySelectorAll('.tf-btn');
    tfButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            tfButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentTimeframe = e.target.dataset.timeframe;

            // Apply specific defaults for 15-minute timeframe
            if (currentTimeframe === '15m') {
                document.getElementById('use-momentum-rule').checked = false; // Momentum filter OFF
                document.getElementById('priority-24-bars').checked = true;   // Force 24 bar ON
                document.getElementById('custom-min').value = 5;               // Range from 5
                document.getElementById('custom-max').value = 23;              // Range to 23
                document.getElementById('bot-opp-close').checked = true;       // Opp Close ON
                document.getElementById('bot-ma-trend').checked = true;        // MA Trend ON
                document.getElementById('bot-fees').checked = true;            // Fees ON
            }

            loadChartData();
        });
    });

    // Reset button
    document.getElementById('reset-btn').addEventListener('click', () => {
        chart.reset();
    });

    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
        loadChartData();
    });

    // Vertical Scale Slider
    const vScaleSlider = document.getElementById('v-scale');
    const vScaleValue = document.getElementById('v-scale-value');
    vScaleSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        vScaleValue.textContent = value + '%';
        chart.verticalZoom = value / 100;
        chart.render();
    });

    // Cycle Indicator Controls
    const updateConfig = () => {
        chart.updateConfig({
            showLabels: document.getElementById('show-labels').checked,
            showParabola: document.getElementById('show-parabola').checked,
            showMin: document.getElementById('show-min').checked,
            showProjections: document.getElementById('show-projections').checked,
            minDuration: parseInt(document.getElementById('custom-min').value) || 24,
            maxDuration: parseInt(document.getElementById('custom-max').value) || 44
        });
    };

    // Initialize Config
    updateConfig();

    document.getElementById('show-labels').addEventListener('change', updateConfig);
    document.getElementById('show-parabola').addEventListener('change', updateConfig);
    document.getElementById('show-min').addEventListener('change', updateConfig);

    // Momentum Rule Toggle
    document.getElementById('use-momentum-rule').addEventListener('change', () => {
        loadChartData(); // Re-run detection
    });



    // Stats Window removed - no longer using makeDraggable

    // Projections Toggle
    // Projections Toggle
    document.getElementById('show-projections').addEventListener('change', updateConfig);

    // Inverse Cycles Toggle

    document.getElementById('show-index-cycles').addEventListener('change', () => {
        loadChartData();
    });
    document.getElementById('show-inverse-cycles').addEventListener('change', () => {
        loadChartData();
    });

    // Priority 24 Bars Toggle
    document.getElementById('priority-24-bars').addEventListener('change', () => {
        loadChartData();
    });

    // Custom Cycle Range - ensure visual config updates too
    document.getElementById('custom-min').addEventListener('change', () => {
        updateConfig();
        loadChartData();
    });
    document.getElementById('custom-max').addEventListener('change', () => {
        updateConfig();
        loadChartData();
    });

    // Momentum Parameters
    const momInputs = ['mom-cycs', 'mom-lbl', 'mom-lbr', 'mom-min', 'mom-max'];
    momInputs.forEach(id => {
        document.getElementById(id).addEventListener('change', () => loadChartData());
    });

    // Manual Cycle Controls
    const manualBtn = document.getElementById('manual-mode-btn');
    const clearManualBtn = document.getElementById('clear-manual-btn');

    manualBtn.addEventListener('click', () => {
        chart.manualMode = true;
        chart.manualPoints = [];
        chart.canvas.style.cursor = 'crosshair';
        // Visual feedback?
        manualBtn.textContent = 'Click Start & End...';
        setTimeout(() => manualBtn.textContent = 'Set Manual', 2000);
    });

    clearManualBtn.addEventListener('click', () => {
        currentManualCycle = null;
        chart.manualPoints = [];
        loadChartData();
    });

    // Chart Callback
    chart.onManualCycleComplete = (startPoint, endPoint) => {
        currentManualCycle = {
            startIndex: startPoint.index,
            endIndex: endPoint.index
        };
        console.log('Manual Cycle Set:', currentManualCycle);
        loadChartData();
    };
}

function makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = document.getElementById(element.id + "header") || element.querySelector('.window-header');

    if (header) {
        // if present, the header is where you move the DIV from:
        header.onmousedown = dragMouseDown;
    } else {
        // otherwise, move the DIV from anywhere inside the DIV:
        element.onmousedown = dragMouseDown;
    }

    function dragMouseDown(e) {
        e = e || window.event;
        // Skip drag if clicking on input, label, select, or checkbox
        const tag = e.target.tagName.toUpperCase();
        if (tag === 'INPUT' || tag === 'LABEL' || tag === 'SELECT' || tag === 'SPAN') {
            return; // Let input handle the event normally
        }
        e.preventDefault();
        // get the mouse cursor position at startup:
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        // call a function whenever the cursor moves:
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        // calculate the new cursor position:
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        // set the element's new position:
        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        // stop moving when mouse button is released:
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

let ws = null;

async function loadChartData(isBackground = false) {
    if (isLoading) return;

    isLoading = true;
    if (!isBackground) showLoading();

    try {
        const interval = timeframeMap[currentTimeframe];
        const limitPerRequest = 1500; // Binance max
        const targetCandles = 632;
        let allData = [];

        const baseUrl = 'https://fapi.binance.com/fapi/v1/klines';

        let endTime = ''; // Fetch latest first

        while (allData.length < targetCandles) {
            let url = `${baseUrl}?symbol=${currentSymbol}&interval=${interval}&limit=${limitPerRequest}`;
            if (endTime) {
                url += `&endTime=${endTime}`;
            }

            const response = await fetch(url);
            if (!response.ok) {
                if (allData.length > 0) break; // Use what we have if error
                throw new Error(`Failed to fetch data: ${response.statusText}`);
            }
            const data = await response.json();

            if (!data || data.length === 0) break; // No more data

            // Prepend data (older data comes first in array from API, but we act as if we are going backwards)
            // Actually Binance returns Oldest -> Newest.
            // So if we ask for latest (no endTime), we get [T-1499... T].
            // Next request we need endTime = (T-1499).openTime - 1.
            // And that request returns [T-2999 ... T-1500].
            // So we need to put the NEW batch at the BEGINNING of allData.

            allData = [...data, ...allData];

            // Update endTime for next batch (oldest candle's open time - 1ms)
            endTime = data[0][0] - 1;

            // Optional: prevent too many requests/rate limit if needed, but for 7 calls it should be fine.
        }

        // Clip to exactly targetCandles if we over-fetched? Not strictly necessary but clean.
        if (allData.length > targetCandles) {
            allData = allData.slice(allData.length - targetCandles);
        }

        // Transform Binance data to our format
        // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
        const candlesticks = allData.map(candle => ({
            time: candle[0], // Open time
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5])
        }));

        chart.setData(candlesticks);

        // Initial Calculation
        recalculateIndicatorsAndCycles(candlesticks);

        hideLoading();

        // Start WebSocket for live updates (only if not background, or check if WS exists)
        if (!isBackground) {
            startWebSocket(currentSymbol, interval);
        }

    } catch (error) {
        console.error('Error loading chart data:', error);
        if (!isBackground) {
            hideLoading();
            showError(`Failed to load chart data: ${error.message}`);
        }
    } finally {
        isLoading = false;
    }
}

function recalculateIndicatorsAndCycles(candlesticks) {
    // Calculate Momentum
    const closes = candlesticks.map(c => c.close);
    const highs = candlesticks.map(c => c.high);
    const lows = candlesticks.map(c => c.low);

    // Update Momentum Parameters
    cycleMomentum.cycs = parseInt(document.getElementById('mom-cycs').value) || 50;
    cycleMomentum.lbL = parseInt(document.getElementById('mom-lbl').value) || 5;
    cycleMomentum.lbR = parseInt(document.getElementById('mom-lbr').value) || 5;
    cycleMomentum.rangeLower = parseInt(document.getElementById('mom-min').value) || 5;
    cycleMomentum.rangeUpper = parseInt(document.getElementById('mom-max').value) || 60;

    const momentumValues = cycleMomentum.calculate(closes);
    chart.setMomentum(momentumValues);

    // Detect Divergences
    const divergences = cycleMomentum.detectDivergences(momentumValues, highs, lows);
    chart.setDivergences(divergences);

    // Detect Cycles
    const useMomentum = document.getElementById('use-momentum-rule').checked;

    const showIndexCycles = document.getElementById('show-index-cycles').checked;
    const showInverseCycles = document.getElementById('show-inverse-cycles').checked;

    // Always use custom min/max values from visible inputs
    const minDuration = parseInt(document.getElementById('custom-min').value) || 24;
    const maxDuration = parseInt(document.getElementById('custom-max').value) || 44;

    const priorityMinDuration = document.getElementById('priority-24-bars').checked;

    let cycles = [];

    // Always detect inverted cycles for Target Line calculation (background)
    // If showInverseCycles is true, we might use a version with manualCycle applied, but for target line stats we usually want the auto-detected ones or consistent ones?
    // Let's calculate the pure auto one for target line if needed, or consistent with display.
    // The target line logic uses `invertedCyclesForTarget`. 
    // We calculate it here.
    const invertedCyclesForTarget = cycleDetector.detectCycles(candlesticks, useMomentum, momentumValues, true /* invert */, minDuration, maxDuration, priorityMinDuration);

    // 1. Index Cycles (User Def: Low-High-Low => Code: Inverted)
    if (showIndexCycles) {
        // Optimization: reuse the one calculated for target line if possible, or detect fresh
        // Index is now Inverted logic (Low-High-Low)
        const cyclesToIndex = cycleDetector.detectCycles(candlesticks, useMomentum, momentumValues, true /* invert */, minDuration, maxDuration, priorityMinDuration, currentManualCycle);
        cycles = cycles.concat(cyclesToIndex);
    }

    // 2. Inverse Cycles (User Def: High-Low-High => Code: Normal)
    if (showInverseCycles) {
        // Inverse is now Normal logic (High-Low-High)
        // Note: manual cycle usually applied to Index logic, but if user sets manual, we apply it to whatever is active. 
        // We passed currentManualCycle to Index above. Should we pass to Inverse too?
        // Let's pass it to both if active, or rely on internal logic. 
        // For distinct visualization, usually manual is one or the other.
        // Assuming user uses manual primarily for the main cycle (Index).
        // But if they are viewing Inverse... let's stick to Index having priority or both.
        // I will pass it to Inverse too just in case they are focusing on that.
        const cyclesToInverse = cycleDetector.detectCycles(candlesticks, useMomentum, momentumValues, false /* invert */, minDuration, maxDuration, priorityMinDuration, currentManualCycle);
        cycles = cycles.concat(cyclesToInverse);
    }

    // Sort to keep drawing order consistent (by start index)
    cycles.sort((a, b) => a.startIndex - b.startIndex);

    chart.setCycles(cycles);

    // Set Range End Line for the last active cycle
    // The line shows where the max duration ends for the most recent cycle
    if (cycles.length > 0) {
        const lastCycle = cycles[cycles.length - 1];
        const currentBarIndex = candlesticks.length - 1;
        const cycleEndAtMax = lastCycle.startIndex + maxDuration;

        // Show line if cycle is still within range (not yet at max)
        // Line disappears when current bar reaches max duration
        if (currentBarIndex < cycleEndAtMax) {
            const isIndex = lastCycle.type === 'inverted'; // Inverted (Low-High-Low)
            const rangeColor = isIndex ? '#3b82f6' : '#ef4444'; // Blue for Index, Red for Normal (Inverse)

            // Assuming chart.setRangeEndLine supports 3rd argument for color
            chart.setRangeEndLine(lastCycle.startIndex, maxDuration, rangeColor);
        } else {
            chart.setRangeEndLine(null, null);
        }
    } else {
        chart.setRangeEndLine(null, null);
    }

    updateStatistics(cycles, invertedCyclesForTarget);

    // Update Closure Markers ('S' Persistent)
    // Use firstPotentialEnd from cycles
    const closureMarkers = cycles.map(c => {
        // use firstPotentialEnd if available, else fallback to endIndex
        const potentialEnd = (c.firstPotentialEnd !== undefined && c.firstPotentialEnd !== null) ? c.firstPotentialEnd : c.endIndex;
        // Ensure time is a consistent string key
        const time = candlesticks[potentialEnd]?.time;
        if (!time) return { time: null };
        return {
            time: String(time),
            type: c.type
        };
    }).filter(m => m.time);

    console.log('Sending closure markers:', closureMarkers.length, closureMarkers[0]);
    chart.clearClosureMarkers();
    chart.addClosureMarkers(closureMarkers);

    // Process Bot Trading
    // Index cycles (inverted in code) -> LONG at closure
    // Inverse cycles (normal in code) -> SHORT at closure
    const indexCyclesForBot = cycleDetector.detectCycles(candlesticks, useMomentum, momentumValues, true, minDuration, maxDuration, priorityMinDuration);
    const inverseCyclesForBot = cycleDetector.detectCycles(candlesticks, useMomentum, momentumValues, false, minDuration, maxDuration, priorityMinDuration);

    // HONEST MODE: Use simulateLiveTrading
    // We pass the detector instance and parameters so it can re-run detection iteratively
    cycleBot.simulateLiveTrading(
        candlesticks,
        cycleDetector,
        momentumValues,
        useMomentum,
        minDuration,
        maxDuration,
        priorityMinDuration
    );

    // Announce new trades if enabled
    if (typeof voiceAnnouncer !== 'undefined') {
        voiceAnnouncer.process(cycleBot.trades, candlesticks.length - 1);
    }
    updateBotWidget();
    updateFFT(candlesticks);
}

function startWebSocket(symbol, interval) {
    if (ws) {
        ws.close();
    }

    const wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`;
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.e === 'kline') {
            const k = message.k;
            const candle = {
                time: k.t,
                open: parseFloat(k.o),
                high: parseFloat(k.h),
                low: parseFloat(k.l),
                close: parseFloat(k.c),
                volume: parseFloat(k.v)
            };

            updateChartData(candle, k.x);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function updateChartData(newCandle, isClosed) {
    const currentData = chart.data;
    if (currentData.length === 0) return;

    const lastCandle = currentData[currentData.length - 1];

    if (newCandle.time === lastCandle.time) {
        // Update existing candle
        currentData[currentData.length - 1] = newCandle;
    } else {
        // New candle started
        currentData.push(newCandle);
        // Keep limit to avoid memory issues (optional, but good practice)
        if (currentData.length > 1000) {
            currentData.shift();
        }
    }

    // Update Chart Data (this triggers a redraw of candles)
    chart.setData(currentData);

    // Recalculate everything
    recalculateIndicatorsAndCycles(currentData);

    // Update open trade display in real-time
    if (typeof updateOpenTradeDisplay === 'function') {
        updateOpenTradeDisplay();
    }
}

function updateStatistics(cycles, invertedCyclesForTarget = null) {
    // Separate cycles by type
    const indexCycles = cycles.filter(c => c.type === 'inverted'); // Inverted in code = Index (L-H-L)
    const inverseCycles = cycles.filter(c => c.type !== 'inverted'); // Normal in code = Inverse (H-L-H)
    const candles = chart.data;

    // Helper to calculate comprehensive stats for a cycle set
    const calcCycleStats = (cycleSet, prefix) => {
        const countEl = document.getElementById(`${prefix}-count`);
        const avgDurEl = document.getElementById(`${prefix}-avg-dur`);
        const maxPriceEl = document.getElementById(`${prefix}-max-price`);
        const stdEl = document.getElementById(`${prefix}-std`);
        const volPreEl = document.getElementById(`${prefix}-vol-pre`);
        const volPostEl = document.getElementById(`${prefix}-vol-post`);
        const trendCanvas = document.getElementById(`${prefix}-trend-chart`);
        const distCanvas = document.getElementById(`${prefix}-dist-chart`);
        const volCanvas = document.getElementById(`${prefix}-vol-chart`);

        if (!cycleSet || cycleSet.length === 0) {
            countEl.textContent = '0';
            avgDurEl.textContent = '-';
            maxPriceEl.textContent = '-';
            stdEl.textContent = '-';
            volPreEl.textContent = '-';
            volPostEl.textContent = '-';
            clearCanvas(trendCanvas);
            clearCanvas(distCanvas);
            clearCanvas(volCanvas);
            return null;
        }

        // Basic stats
        const durations = cycleSet.map(c => c.duration);
        const avgDuration = durations.reduce((a, b) => a + b, 0) / cycleSet.length;
        const variance = durations.reduce((a, b) => a + Math.pow(b - avgDuration, 2), 0) / cycleSet.length;
        const stdDev = Math.sqrt(variance);

        // Max price variation within cycle
        const priceVariations = cycleSet.map(c => {
            if (c.type === 'inverted') {
                // Index (L-H-L): max variation from low to high
                return ((c.maxPrice - c.startPrice) / c.startPrice) * 100;
            } else {
                // Inverse (H-L-H): max variation from high to low
                return ((c.startPrice - c.minPrice) / c.startPrice) * 100;
            }
        });
        const maxPriceVar = Math.max(...priceVariations);
        const avgPriceVar = priceVariations.reduce((a, b) => a + b, 0) / priceVariations.length;

        // Volume Delta (3 bars vs 10 bars before/after cycle close)
        // Collect per-cycle data for the chart
        const volPreData = [];
        const volPostData = [];
        let totalVolPre = 0, totalVolPost = 0, volCount = 0;

        cycleSet.forEach(cycle => {
            const closeIndex = cycle.endIndex;
            if (closeIndex < 13 || closeIndex > candles.length - 4) return;

            // 3 bars before close vs 10 bars before those
            let vol3Pre = 0, vol10Pre = 0;
            for (let i = 1; i <= 3; i++) vol3Pre += candles[closeIndex - i]?.volume || 0;
            vol3Pre /= 3;
            for (let i = 4; i <= 13; i++) vol10Pre += candles[closeIndex - i]?.volume || 0;
            vol10Pre /= 10;

            let deltaPre = 0, deltaPost = 0;
            if (vol10Pre > 0) {
                deltaPre = ((vol3Pre - vol10Pre) / vol10Pre) * 100;
                totalVolPre += deltaPre;
            }

            // 3 bars after close vs baseline
            let vol3Post = 0;
            for (let i = 1; i <= 3; i++) vol3Post += candles[closeIndex + i]?.volume || 0;
            vol3Post /= 3;
            if (vol10Pre > 0) {
                deltaPost = ((vol3Post - vol10Pre) / vol10Pre) * 100;
                totalVolPost += deltaPost;
            }

            volPreData.push(deltaPre);
            volPostData.push(deltaPost);
            volCount++;
        });

        const avgVolPre = volCount > 0 ? totalVolPre / volCount : 0;
        const avgVolPost = volCount > 0 ? totalVolPost / volCount : 0;

        // Calculate First→End (bars from first valid close position to actual close)
        // minDuration is available from the outer scope
        const firstEndDeltas = cycleSet.map(c => {
            const firstEnd = c.firstPotentialEnd || c.endIndex;
            return c.endIndex - firstEnd;
        }).filter(d => d >= 0);
        const avgFirstEnd = firstEndDeltas.length > 0
            ? firstEndDeltas.reduce((a, b) => a + b, 0) / firstEndDeltas.length
            : 0;

        // Update DOM
        const firstEndEl = document.getElementById(`${prefix}-first-end`);
        const avgPumpDropEl = document.getElementById(`${prefix}-avg-pump`) || document.getElementById(`${prefix}-avg-drop`);

        countEl.textContent = cycleSet.length;
        avgDurEl.textContent = avgDuration.toFixed(1) + ' bars';

        // Update avg pump/drop
        if (avgPumpDropEl) {
            avgPumpDropEl.textContent = avgPriceVar.toFixed(2) + '%';
        }

        maxPriceEl.textContent = maxPriceVar.toFixed(2) + '%';
        stdEl.textContent = stdDev.toFixed(1);
        firstEndEl.textContent = avgFirstEnd.toFixed(1) + ' bars';
        volPreEl.textContent = (avgVolPre >= 0 ? '+' : '') + avgVolPre.toFixed(1) + '%';
        volPreEl.style.color = avgVolPre >= 0 ? '#10b981' : '#ef4444';
        volPostEl.textContent = (avgVolPost >= 0 ? '+' : '') + avgVolPost.toFixed(1) + '%';
        volPostEl.style.color = avgVolPost >= 0 ? '#10b981' : '#ef4444';

        // Draw charts
        drawTrendChart(trendCanvas, durations);
        drawDistributionChart(distCanvas, durations);
        drawVolumeChart(volCanvas, volPreData, volPostData);

        return { avgDuration, stdDev };
    };

    // Calculate stats for both cycle types
    calcCycleStats(indexCycles, 'idx');
    calcCycleStats(inverseCycles, 'inv');

    // Calculate avgDrop for target line calculation
    let avgDrop = 0;
    if (cycles.length > 0) {
        const drops = cycles.map(c => {
            if (c.type === 'inverted') {
                return ((c.maxPrice - c.endPrice) / c.maxPrice) * 100;
            } else {
                return ((c.startPrice - c.minPrice) / c.startPrice) * 100;
            }
        });
        avgDrop = drops.reduce((a, b) => a + b, 0) / cycles.length;
    }

    // Target line logic
    if (invertedCyclesForTarget && invertedCyclesForTarget.length > 0) {
        const lastInvertedCycle = invertedCyclesForTarget[invertedCyclesForTarget.length - 1];
        const candlesticks = chart.data;
        const isCycleClosed = lastInvertedCycle.endIndex < candlesticks.length - 1;

        if (isCycleClosed) {
            const targetPrice = lastInvertedCycle.endPrice - (lastInvertedCycle.endPrice * avgDrop / 100);
            chart.setTargetLine(targetPrice, avgDrop);
        } else {
            chart.setTargetLine(null);
        }
    } else {
        chart.setTargetLine(null);
    }
}

function clearCanvas(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawTrendChart(canvas, durations) {
    if (!canvas || durations.length < 5) {
        clearCanvas(canvas);
        return;
    }

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Calculate rolling 5 average
    const rollingData = [];
    for (let i = 4; i < durations.length; i++) {
        const window = durations.slice(i - 4, i + 1);
        const avg = window.reduce((a, b) => a + b, 0) / 5;
        rollingData.push(avg);
    }

    if (rollingData.length < 2) {
        clearCanvas(canvas);
        return;
    }

    const min = Math.min(...rollingData) * 0.9;
    const max = Math.max(...rollingData) * 1.1;
    const range = max - min || 1;

    // Padding: left for scale, others for margin
    const leftPadding = 35;
    const padding = 8;
    const plotWidth = width - leftPadding - padding;
    const plotHeight = height - padding * 2;
    const xStep = plotWidth / (rollingData.length - 1);

    // Draw vertical scale
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const scaleSteps = 4;
    for (let i = 0; i <= scaleSteps; i++) {
        const val = min + (range * i / scaleSteps);
        const y = padding + plotHeight - (i / scaleSteps) * plotHeight;
        ctx.fillText(Math.round(val).toString(), leftPadding - 5, y);

        // Draw horizontal grid line
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(leftPadding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
    }

    // Draw rolling average line
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.beginPath();

    rollingData.forEach((d, i) => {
        const x = leftPadding + i * xStep;
        const y = padding + plotHeight - ((d - min) / range) * plotHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // Add "Rolling 5" label
    ctx.fillStyle = '#6366f1';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Rolling 5', leftPadding + 2, padding + 8);
}

function drawVolumeChart(canvas, preData, postData) {
    if (!canvas || preData.length < 2) {
        clearCanvas(canvas);
        return;
    }

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Combine data to find range
    const allData = [...preData, ...postData];
    const min = Math.min(...allData, 0) * 1.1;
    const max = Math.max(...allData, 0) * 1.1;
    const range = (max - min) || 1;

    const leftPadding = 30;
    const padding = 8;
    const plotWidth = width - leftPadding - padding;
    const plotHeight = height - padding * 2;
    const xStep = plotWidth / (preData.length - 1 || 1);

    // Draw zero line
    const zeroY = padding + plotHeight - ((0 - min) / range) * plotHeight;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(leftPadding, zeroY);
    ctx.lineTo(width - padding, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw scale
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(max) + '%', leftPadding - 3, padding);
    ctx.fillText('0%', leftPadding - 3, zeroY);
    ctx.fillText(Math.round(min) + '%', leftPadding - 3, height - padding);

    // Draw Pre line (green)
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    preData.forEach((d, i) => {
        const x = leftPadding + i * xStep;
        const y = padding + plotHeight - ((d - min) / range) * plotHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw Post line (red/orange)
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    postData.forEach((d, i) => {
        const x = leftPadding + i * xStep;
        const y = padding + plotHeight - ((d - min) / range) * plotHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Legend
    ctx.font = '8px Inter, sans-serif';
    ctx.fillStyle = '#10b981';
    ctx.textAlign = 'left';
    ctx.fillText('Pre', leftPadding + 2, padding + 6);
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('Post', leftPadding + 25, padding + 6);
}

function drawDistributionChart(canvas, durations) {
    if (!canvas || durations.length < 3) {
        clearCanvas(canvas);
        return;
    }

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Create histogram bins
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    const range = max - min || 1;
    const binCount = Math.min(10, durations.length);
    const binWidth = range / binCount;

    const bins = new Array(binCount).fill(0);
    durations.forEach(d => {
        const binIndex = Math.min(binCount - 1, Math.floor((d - min) / binWidth));
        bins[binIndex]++;
    });

    const maxBin = Math.max(...bins);
    const padding = 5;
    const plotWidth = width - padding * 2;
    const plotHeight = height - padding * 2;
    const barWidth = plotWidth / binCount;

    // Draw bars
    ctx.fillStyle = 'rgba(139, 92, 246, 0.6)';
    bins.forEach((count, i) => {
        const barHeight = (count / maxBin) * plotHeight;
        const x = padding + i * barWidth;
        const y = padding + plotHeight - barHeight;
        ctx.fillRect(x, y, barWidth - 1, barHeight);
    });

    // Draw gaussian curve overlay
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    const variance = durations.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / durations.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev > 0) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (let x = 0; x < plotWidth; x++) {
            const val = min + (x / plotWidth) * range;
            const gaussian = Math.exp(-Math.pow(val - mean, 2) / (2 * stdDev * stdDev));
            const y = padding + plotHeight - gaussian * plotHeight;
            if (x === 0) ctx.moveTo(padding + x, y);
            else ctx.lineTo(padding + x, y);
        }

        ctx.stroke();
    }
}

function calculateRollingMedian(cycles, windowSize) {
    if (cycles.length < windowSize) return [];

    const medians = [];
    const durations = cycles.map(c => c.duration);

    for (let i = windowSize - 1; i < durations.length; i++) {
        const window = durations.slice(i - windowSize + 1, i + 1);
        // Sort to find median
        window.sort((a, b) => a - b);
        const mid = Math.floor(window.length / 2);
        const median = window.length % 2 !== 0 ? window[mid] : (window[mid - 1] + window[mid]) / 2;
        medians.push(median);
    }
    return medians;
}

function drawStatsChart(data) {
    const canvas = document.getElementById('stats-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (data.length === 0) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = '12px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('Not enough data (need 10+ cycles)', width / 2, height / 2);
        return;
    }

    // Scale
    const minVal = Math.min(...data) * 0.9;
    const maxVal = Math.max(...data) * 1.1;
    const range = maxVal - minVal || 1;

    const padding = 10;
    const plotWidth = width - padding * 2;
    const plotHeight = height - padding * 2;

    const xStep = plotWidth / (data.length - 1 || 1);

    // Draw Line
    ctx.beginPath();
    ctx.strokeStyle = '#6366f1'; // Accent color
    ctx.lineWidth = 2;

    data.forEach((val, i) => {
        const x = padding + i * xStep;
        const y = height - padding - ((val - minVal) / range) * plotHeight;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // Draw Points
    ctx.fillStyle = '#8b5cf6';
    data.forEach((val, i) => {
        const x = padding + i * xStep;
        const y = height - padding - ((val - minVal) / range) * plotHeight;

        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
    });
}

function showLoading() {
    const loading = document.getElementById('loading');
    loading.classList.remove('hidden');
}

function hideLoading() {
    const loading = document.getElementById('loading');
    loading.classList.add('hidden');
}

function showError(message) {
    // Create error notification
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #ef4444, #dc2626);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
        z-index: 1000;
        animation: slideInRight 0.3s ease-out;
        font-family: Inter, sans-serif;
        max-width: 400px;
    `;
    errorDiv.textContent = message;

    document.body.appendChild(errorDiv);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        errorDiv.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => errorDiv.remove(), 300);
    }, 5000);
}

// Add animation keyframes
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// ===== BOT WIDGET FUNCTIONS =====

function setupBotWidget() {
    // Bot is now a fixed section, no longer draggable

    // Listen for settings changes
    const balanceInput = document.getElementById('bot-balance');
    const leverageInput = document.getElementById('bot-leverage');
    const capitalInput = document.getElementById('bot-capital');
    const feesToggle = document.getElementById('bot-fees');
    const tp1PctInput = document.getElementById('bot-tp1-pct');
    const tp1CloseInput = document.getElementById('bot-tp1-close');
    const tp2PctInput = document.getElementById('bot-tp2-pct');
    const threeBarToggle = document.getElementById('bot-3bar');

    const updateBotConfig = () => {
        cycleBot.updateConfig({
            startingBalance: balanceInput.value,
            leverage: leverageInput.value,
            capitalPercentage: capitalInput.value,
            feesEnabled: feesToggle.checked,
            tp1AvgPercent: tp1PctInput ? tp1PctInput.value : 50,
            tp1CloseFraction: tp1CloseInput ? tp1CloseInput.value : 60,
            tp2AvgPercent: tp2PctInput ? tp2PctInput.value : 150,
            threeBarConfirmation: threeBarToggle ? threeBarToggle.checked : true,
            maxLossPercent: document.getElementById('bot-max-loss-pct').value,
            closeOnOpposite: document.getElementById('bot-opp-close').checked,
            maTrendFilter: document.getElementById('bot-ma-trend').checked,
            maxLossEnabled: document.getElementById('bot-max-loss').checked
        });
        // Recalculate with new settings
        if (chart.data && chart.data.length > 0) {
            recalculateIndicatorsAndCycles(chart.data);
        }
    };

    // Add both 'change' and 'input' events for immediate updates
    ['change', 'input'].forEach(evt => {
        balanceInput.addEventListener(evt, updateBotConfig);
        leverageInput.addEventListener(evt, updateBotConfig);
        capitalInput.addEventListener(evt, updateBotConfig);
        if (tp1PctInput) tp1PctInput.addEventListener(evt, updateBotConfig);
        if (tp1CloseInput) tp1CloseInput.addEventListener(evt, updateBotConfig);
        if (tp2PctInput) tp2PctInput.addEventListener(evt, updateBotConfig);
        document.getElementById('bot-max-loss-pct').addEventListener(evt, updateBotConfig);
    });
    feesToggle.addEventListener('change', updateBotConfig);
    if (threeBarToggle) threeBarToggle.addEventListener('change', updateBotConfig);
    document.getElementById('bot-opp-close').addEventListener('change', updateBotConfig);
    document.getElementById('bot-ma-trend').addEventListener('change', updateBotConfig);
    document.getElementById('bot-max-loss').addEventListener('change', updateBotConfig);

    // Bot toggle
    const botToggle = document.getElementById('bot-enabled');
    const botStatus = document.getElementById('bot-status');

    botToggle.addEventListener('change', () => {
        const isEnabled = botToggle.checked;
        botStatus.textContent = isEnabled ? 'ON' : 'OFF';
        botStatus.classList.toggle('active', isEnabled);

        if (isEnabled) {
            // Recalculate to get trades
            if (chart.data && chart.data.length > 0) {
                recalculateIndicatorsAndCycles(chart.data);
            }
        } else {
            // Clear trade markers when disabled
            chart.clearTradeMarkers();
            // Reset widget stats
            document.getElementById('bot-pnl').textContent = '$0.00';
            document.getElementById('bot-winrate').textContent = '0%';
            document.getElementById('bot-trades').textContent = '0';
            document.getElementById('bot-current-balance').textContent = '$' + cycleBot.startingBalance.toFixed(2);
        }
    });

    // Initial status
    botStatus.textContent = botToggle.checked ? 'ON' : 'OFF';
    botStatus.classList.toggle('active', botToggle.checked);
}

function isBotEnabled() {
    const toggle = document.getElementById('bot-enabled');
    return toggle && toggle.checked;
}

function updateBotWidget() {
    if (!isBotEnabled()) {
        chart.clearTradeMarkers();
        return;
    }

    const stats = cycleBot.getStats();

    // Update PnL
    const pnlEl = document.getElementById('bot-pnl');
    const pnlValue = stats.totalPnL;
    pnlEl.textContent = (pnlValue >= 0 ? '+' : '') + '$' + pnlValue.toFixed(2);
    pnlEl.className = 'stat-value ' + (pnlValue >= 0 ? 'positive' : 'negative');

    // Update PnL %
    const pnlPercentEl = document.getElementById('bot-pnl-percent');
    const pnlPercentValue = stats.pnlPercent;
    pnlPercentEl.textContent = (pnlPercentValue >= 0 ? '+' : '') + pnlPercentValue.toFixed(2) + '%';
    pnlPercentEl.className = 'stat-value ' + (pnlPercentValue >= 0 ? 'positive' : 'negative');

    // Update Win Rate
    const winrateEl = document.getElementById('bot-winrate');
    winrateEl.textContent = stats.winRate.toFixed(1) + '%';

    // Update Trades count
    document.getElementById('bot-trades').textContent = stats.totalTrades;

    // Update Current Balance
    const balanceEl = document.getElementById('bot-current-balance');
    balanceEl.textContent = '$' + stats.currentBalance.toFixed(2);
    balanceEl.className = 'stat-value ' + (stats.currentBalance >= cycleBot.startingBalance ? 'positive' : 'negative');

    // Set trade markers on chart
    const trades = cycleBot.getTrades();
    console.log('Bot trades:', trades.length, 'trades', trades.slice(0, 3));
    chart.setTradeMarkers(trades);
    chart.setExitMarkers(trades);
    chart.setTradeLines(trades);

    // Update detailed trade stats table
    updateTradeStatsTable(trades);

    // Update trades history table
    updateTradesHistoryTable(trades);

    // Update open trade display
    updateOpenTradeDisplay();

    // Draw Equity Chart
    drawEquityChart();
}

function updateOpenTradeDisplay() {
    const typeEl = document.getElementById('open-trade-type');
    const entryEl = document.getElementById('open-trade-entry');
    const pnlEl = document.getElementById('open-trade-pnl');
    const tp1El = document.getElementById('open-trade-tp1');
    const tp2El = document.getElementById('open-trade-tp2');
    const slEl = document.getElementById('open-trade-sl');

    if (!typeEl) {
        console.log('Open trade elements not found');
        return;
    }

    const pos = cycleBot ? cycleBot.openPosition : null;

    // If no openPosition, check for last trade that might still be "open" (exit at last candle)
    let currentPos = pos;
    if (!currentPos && cycleBot) {
        const trades = cycleBot.getTrades();
        const lastTrade = trades[trades.length - 1];
        const dataLen = chart.data ? chart.data.length : 0;
        // If last trade exits at last candle or close to it, it's effectively "current"
        if (lastTrade && lastTrade.exitIndex >= dataLen - 2) {
            // This trade is still "active" in the current view - show it
            currentPos = {
                type: lastTrade.type,
                entryPrice: lastTrade.entryPrice,
                capitalUsed: lastTrade.pnl > 0 ? lastTrade.pnl / 10 : 200, // Estimate
                slPrice: null
            };
        }
    }

    console.log('Display pos:', currentPos);

    if (!currentPos) {
        typeEl.textContent = '-';
        typeEl.className = 'open-type';
        entryEl.textContent = '-';
        pnlEl.textContent = '-';
        pnlEl.className = 'open-val';
        tp1El.textContent = '-';
        tp2El.textContent = '-';
        slEl.textContent = '-';
        chart.clearTPLines();
        chart.clearOpenPosition();
        return;
    }

    // Type
    typeEl.textContent = currentPos.type;
    typeEl.className = 'open-type ' + currentPos.type.toLowerCase();

    // Entry
    entryEl.textContent = currentPos.entryPrice.toFixed(3);

    // Calculate unrealized PnL
    const lastCandle = chart.data[chart.data.length - 1];
    const currentPrice = lastCandle ? lastCandle.close : currentPos.entryPrice;
    let unrealizedPnL;
    if (currentPos.type === 'LONG') {
        unrealizedPnL = ((currentPrice - currentPos.entryPrice) / currentPos.entryPrice) * (currentPos.capitalUsed || 200) * cycleBot.leverage;
    } else {
        unrealizedPnL = ((currentPos.entryPrice - currentPrice) / currentPos.entryPrice) * (currentPos.capitalUsed || 200) * cycleBot.leverage;
    }
    pnlEl.textContent = (unrealizedPnL >= 0 ? '+' : '') + '$' + unrealizedPnL.toFixed(2);
    pnlEl.className = 'open-val ' + (unrealizedPnL >= 0 ? 'positive' : 'negative');

    // Calculate TP1 level (based on 50% of avg cycle move from last 10 cycles)
    // Calculate TP2 level (based on tp2AvgPercent of avg cycle move)
    let tp1Price, tp2Price;
    const tp1Percent = cycleBot.tp1AvgPercent / 100;
    const tp2Percent = cycleBot.tp2AvgPercent / 100;

    if (currentPos.type === 'LONG') {
        const avgPump = cycleBot.avgIndexPump || 1;
        tp1Price = currentPos.entryPrice * (1 + (avgPump * tp1Percent) / 100);
        tp2Price = currentPos.entryPrice * (1 + (avgPump * tp2Percent) / 100);
    } else {
        const avgDrop = cycleBot.avgInverseDrop || 1;
        tp1Price = currentPos.entryPrice * (1 - (avgDrop * tp1Percent) / 100);
        tp2Price = currentPos.entryPrice * (1 - (avgDrop * tp2Percent) / 100);
    }

    tp1El.textContent = tp1Price.toFixed(3);
    tp2El.textContent = tp2Price.toFixed(3);
    slEl.textContent = currentPos.slPrice ? currentPos.slPrice.toFixed(3) : '-';

    // Draw TP lines on chart
    chart.setTPLines(tp1Price, tp2Price, currentPos.type);

    // Draw open position entry and SL lines on chart
    chart.setOpenPosition(currentPos.entryPrice, currentPos.type, currentPos.slPrice);
}

function updateTradeStatsTable(trades) {
    const longTrades = trades.filter(t => t.type === 'LONG');
    const shortTrades = trades.filter(t => t.type === 'SHORT');

    // Count by exit reason - use 'reason' field
    const countByReason = (arr, reason) => arr.filter(t => t.reason && t.reason.includes(reason)).length;
    const sumByReason = (arr, reason) => arr.filter(t => t.reason && t.reason.includes(reason)).reduce((s, t) => s + (t.pnl || 0), 0);

    // Qty
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setEl('stat-long-qty', longTrades.length);
    setEl('stat-short-qty', shortTrades.length);
    setEl('stat-total-qty', trades.length);

    // Failed (SL)
    const longFailed = countByReason(longTrades, 'stop_loss') + countByReason(longTrades, 'sl');
    const shortFailed = countByReason(shortTrades, 'stop_loss') + countByReason(shortTrades, 'sl');
    setEl('stat-long-failed', longFailed);
    setEl('stat-short-failed', shortFailed);
    setEl('stat-total-failed', longFailed + shortFailed);

    // TP1
    const longTP1 = countByReason(longTrades, 'tp1');
    const shortTP1 = countByReason(shortTrades, 'tp1');
    setEl('stat-long-tp1', longTP1);
    setEl('stat-short-tp1', shortTP1);
    setEl('stat-total-tp1', longTP1 + shortTP1);

    // TP2
    const longTP2 = countByReason(longTrades, 'tp2');
    const shortTP2 = countByReason(shortTrades, 'tp2');
    setEl('stat-long-tp2', longTP2);
    setEl('stat-short-tp2', shortTP2);
    setEl('stat-total-tp2', longTP2 + shortTP2);

    // Cycle End
    const longCycle = countByReason(longTrades, 'cycle');
    const shortCycle = countByReason(shortTrades, 'cycle');
    setEl('stat-long-cycle', longCycle);
    setEl('stat-short-cycle', shortCycle);
    setEl('stat-total-cycle', longCycle + shortCycle);

    // Gain TP1
    const longGainTP1 = sumByReason(longTrades, 'tp1');
    const shortGainTP1 = sumByReason(shortTrades, 'tp1');
    setEl('stat-long-gain-tp1', '$' + longGainTP1.toFixed(0));
    setEl('stat-short-gain-tp1', '$' + shortGainTP1.toFixed(0));
    setEl('stat-total-gain-tp1', '$' + (longGainTP1 + shortGainTP1).toFixed(0));

    // Gain TP2
    const longGainTP2 = sumByReason(longTrades, 'tp2');
    const shortGainTP2 = sumByReason(shortTrades, 'tp2');
    setEl('stat-long-gain-tp2', '$' + longGainTP2.toFixed(0));
    setEl('stat-short-gain-tp2', '$' + shortGainTP2.toFixed(0));
    setEl('stat-total-gain-tp2', '$' + (longGainTP2 + shortGainTP2).toFixed(0));

    // Total Loss
    const longLoss = longTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
    const shortLoss = shortTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
    setEl('stat-long-loss', '$' + longLoss.toFixed(0));
    setEl('stat-short-loss', '$' + shortLoss.toFixed(0));
    setEl('stat-total-loss', '$' + (longLoss + shortLoss).toFixed(0));
}

function updateTradesHistoryTable(trades) {
    const tbody = document.getElementById('trades-history-body');
    const timeframeEl = document.getElementById('trades-timeframe');

    if (!tbody) return;

    // Update timeframe display
    if (timeframeEl) {
        const activeBtn = document.querySelector('.tf-btn.active');
        timeframeEl.textContent = activeBtn ? activeBtn.dataset.timeframe : '1m';
    }

    if (!trades || trades.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="no-trades">No trades yet</td></tr>';
        return;
    }

    // First pass: assign trade IDs to each operation
    const tradeIdToDisplayId = {};
    let displayIdCounter = 1;

    const sortedForIds = trades.slice().sort((a, b) => a.entryIndex - b.entryIndex);
    sortedForIds.forEach(t => {
        const key = t.tradeId !== undefined && t.tradeId !== null
            ? `id_${t.tradeId}`
            : `entry_${t.entryIndex}_${t.type}`;
        if (!tradeIdToDisplayId[key]) {
            tradeIdToDisplayId[key] = displayIdCounter++;
        }
    });

    // Apply filters
    let filteredTrades = trades.slice();

    // Filter by type
    if (tradeFilterType !== 'all') {
        filteredTrades = filteredTrades.filter(t => t.type === tradeFilterType);
    }

    // Filter by exit reason
    if (tradeFilterExit !== 'all') {
        filteredTrades = filteredTrades.filter(t => {
            const reason = (t.reason || '').toLowerCase();
            if (tradeFilterExit === 'tp1') return reason.includes('tp1');
            if (tradeFilterExit === 'tp2') return reason.includes('tp2');
            if (tradeFilterExit === 'sl') return reason.includes('sl') || reason.includes('stop');
            if (tradeFilterExit === 'be') return reason.includes('break_even');
            if (tradeFilterExit === 'cycle') return reason.includes('cycle');
            return true;
        });
    }

    // Filter by result (win/loss)
    if (tradeFilterResult !== 'all') {
        filteredTrades = filteredTrades.filter(t => {
            if (tradeFilterResult === 'win') return (t.pnl || 0) > 0;
            if (tradeFilterResult === 'loss') return (t.pnl || 0) < 0;
            return true;
        });
    }

    // Apply sorting
    filteredTrades.sort((a, b) => {
        let valA, valB;
        switch (tradeSortColumn) {
            case 'id':
                const keyA = a.tradeId !== undefined ? `id_${a.tradeId}` : `entry_${a.entryIndex}_${a.type}`;
                const keyB = b.tradeId !== undefined ? `id_${b.tradeId}` : `entry_${b.entryIndex}_${b.type}`;
                valA = tradeIdToDisplayId[keyA] || 0;
                valB = tradeIdToDisplayId[keyB] || 0;
                break;
            case 'time':
                valA = a.entryIndex || 0;
                valB = b.entryIndex || 0;
                break;
            case 'cycle':
                valA = a.cycleAmplitude || 0;
                valB = b.cycleAmplitude || 0;
                break;
            case 'lagopen':
                // Lag Open = realCycleEndIndex - entryIndex (bars from entry to real cycle end)
                valA = (a.realCycleEndIndex || a.entryIndex || 0) - (a.entryIndex || 0);
                valB = (b.realCycleEndIndex || b.entryIndex || 0) - (b.entryIndex || 0);
                break;
            case 'lag':
                valA = (a.exitIndex || 0) - (a.entryIndex || 0);
                valB = (b.exitIndex || 0) - (b.entryIndex || 0);
                break;
            case 'fees':
                valA = a.fees || 0;
                valB = b.fees || 0;
                break;
            case 'pnl':
                valA = a.pnl || 0;
                valB = b.pnl || 0;
                break;
            default:
                valA = a.entryIndex || 0;
                valB = b.entryIndex || 0;
        }
        if (tradeSortDirection === 'asc') {
            return valA - valB;
        } else {
            return valB - valA;
        }
    });

    // Build table rows
    const rows = filteredTrades.map(t => {
        const key = t.tradeId !== undefined && t.tradeId !== null
            ? `id_${t.tradeId}`
            : `entry_${t.entryIndex}_${t.type}`;
        const displayId = tradeIdToDisplayId[key] || '-';

        const entryCandle = chart.data[t.entryIndex];
        const entryTime = entryCandle ? formatTradeTime(entryCandle.time) : '-';

        const cyclePct = (t.cycleAmplitude !== undefined && t.cycleAmplitude !== null && !isNaN(t.cycleAmplitude))
            ? t.cycleAmplitude.toFixed(2) + '%'
            : '-';

        // Lag Open: bars from trade entry to when cycle really ended
        // Uses realCycleEndIndex if tracked, otherwise exitIndex as fallback
        let lagOpen = '-';
        const realEndIdx = t.realCycleEndIndex !== undefined ? t.realCycleEndIndex : t.exitIndex;
        if (realEndIdx !== undefined && t.entryIndex !== undefined) {
            lagOpen = (realEndIdx - t.entryIndex).toString();
        }

        // Lag: trade duration (exitIndex - entryIndex)
        let lag = '-';
        if (t.exitIndex !== undefined && t.exitIndex !== null && t.entryIndex !== undefined) {
            lag = (t.exitIndex - t.entryIndex).toString();
        }

        const exitText = formatReason(t.reason) || '-';
        const exitClass = getReasonClass(t.reason || '');

        const fees = t.fees || 0;
        const feesText = fees > 0 ? '-$' + fees.toFixed(2) : '$0.00';

        const pnl = t.pnl || 0;
        const pnlClass = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
        const pnlText = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);

        const typeClass = 'type-' + t.type.toLowerCase();

        return `<tr>
            <td>${displayId}</td>
            <td>${entryTime}</td>
            <td class="${typeClass}">${t.type}</td>
            <td>${t.entryPrice.toFixed(4)}</td>
            <td>${cyclePct}</td>
            <td>${lagOpen}</td>
            <td>${lag}</td>
            <td class="${exitClass}">${exitText}</td>
            <td>${feesText}</td>
            <td class="${pnlClass}">${pnlText}</td>
        </tr>`;
    });

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="no-trades">No trades match filters</td></tr>';
    } else {
        tbody.innerHTML = rows.join('');
    }
}

// Setup trade table filter/sort event listeners
function setupTradeTableFilters() {
    // Filter dropdowns
    const filterType = document.getElementById('filter-type');
    const filterExit = document.getElementById('filter-exit');
    const filterResult = document.getElementById('filter-result');

    if (filterType) {
        filterType.addEventListener('change', (e) => {
            tradeFilterType = e.target.value;
            if (cycleBot) updateTradesHistoryTable(cycleBot.getTrades());
        });
    }

    if (filterExit) {
        filterExit.addEventListener('change', (e) => {
            tradeFilterExit = e.target.value;
            if (cycleBot) updateTradesHistoryTable(cycleBot.getTrades());
        });
    }

    if (filterResult) {
        filterResult.addEventListener('change', (e) => {
            tradeFilterResult = e.target.value;
            if (cycleBot) updateTradesHistoryTable(cycleBot.getTrades());
        });
    }

    // Sortable column headers
    const sortableHeaders = document.querySelectorAll('.trades-history-table th.sortable');
    sortableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            if (tradeSortColumn === column) {
                // Toggle direction
                tradeSortDirection = tradeSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                tradeSortColumn = column;
                tradeSortDirection = 'desc';
            }

            // Update visual indicators
            sortableHeaders.forEach(h => h.classList.remove('asc', 'desc'));
            th.classList.add(tradeSortDirection);

            if (cycleBot) updateTradesHistoryTable(cycleBot.getTrades());
        });
    });
}

function formatTradeTime(timestamp) {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${day}/${month} ${hours}:${minutes}`;
}

function getReasonClass(reason) {
    if (!reason) return '';
    if (reason.includes('tp1')) return 'reason-tp1';
    if (reason.includes('tp2')) return 'reason-tp2';
    if (reason.includes('sl') || reason.includes('stop')) return 'reason-sl';
    if (reason.includes('cycle')) return 'reason-cycle';
    return '';
}

function formatReason(reason) {
    if (!reason) return '-';
    if (reason.includes('tp1')) return 'TP1';
    if (reason.includes('tp2')) return 'TP2';
    if (reason.includes('sl_cycle_min')) return 'SL (Min)';
    if (reason.includes('sl_cycle_max')) return 'SL (Max)';
    if (reason.includes('break_even')) return 'BE';
    if (reason.includes('cycle_end')) return 'Cycle';
    if (reason.includes('opposite')) return 'Flip';
    return reason;
}

function drawEquityChart() {
    const canvas = document.getElementById('bot-equity-chart');
    if (!canvas) return;

    // High DPI Setup
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    // Set actual size in memory (scaled to account for extra pixel density)
    // Only resize if needed to prevent flickering
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
    }

    const ctx = canvas.getContext('2d');

    // Normalize coordinate system to use css pixels
    ctx.resetTransform(); // Reset any previous transform
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    const equityCurve = cycleBot.getEquityCurve();

    // Config
    const padding = 10;
    const plotWidth = width - padding * 2;
    const plotHeight = height - padding * 2;

    if (equityCurve.length < 2) {
        // Draw starting balance line (dashed)
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#9ca3af';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No trades yet', width / 2, height / 2);
        return;
    }

    // Get balance data including starting
    const balances = [cycleBot.startingBalance, ...equityCurve.map(e => e.balance)];
    const minBal = Math.min(...balances);
    const maxBal = Math.max(...balances);

    // Add 5% padding to range
    const rangePadding = (maxBal - minBal) * 0.1 || 10; // Min range 10
    const yMin = minBal - rangePadding;
    const yMax = maxBal + rangePadding;
    const yRange = yMax - yMin;

    const xStep = plotWidth / (balances.length - 1);

    // Helper to get Y coord
    const getY = (val) => padding + plotHeight - ((val - yMin) / yRange) * plotHeight;

    // Draw reference line at starting balance
    const startY = getY(cycleBot.startingBalance);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding, startY);
    ctx.lineTo(width - padding, startY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Create Path
    ctx.beginPath();
    balances.forEach((bal, i) => {
        const x = padding + i * xStep;
        const y = getY(bal);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    // Draw gradient fill
    ctx.save();
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(16, 185, 129, 0.25)'); // Emerald transparent
    gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');

    // Close path for fill
    ctx.lineTo(padding + (balances.length - 1) * xStep, height - padding);
    ctx.lineTo(padding, height - padding);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    // Draw main line
    ctx.beginPath();
    balances.forEach((bal, i) => {
        const x = padding + i * xStep;
        const y = getY(bal);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;

    // Color based on overall PnL
    const isProfitable = balances[balances.length - 1] >= cycleBot.startingBalance;
    ctx.strokeStyle = isProfitable ? '#10b981' : '#ef4444';

    // Add glow effect
    ctx.shadowColor = isProfitable ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0; // Reset shadow

    // Draw current balance dot
    const lastBal = balances[balances.length - 1];
    const lastX = padding + (balances.length - 1) * xStep;
    const lastY = getY(lastBal);

    ctx.fillStyle = isProfitable ? '#10b981' : '#ef4444';
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Add white center to dot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(lastX, lastY, 1.5, 0, Math.PI * 2);
    ctx.fill();
}

// ========== FFT ANALYSIS ==========
function updateFFT(candles) {
    const canvas = document.getElementById('fft-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Use last N candles (power of 2 preferably, or just max reasonable length)
    // For visual speed, let's take last 256 or 512
    const N = Math.min(candles.length, 512); // Limit to 512 for performance
    if (N < 32) return;

    // Extract closes and detrend (simple linear detrend)
    const data = [];
    const startIndex = candles.length - N;

    // Linear regression to find trend
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < N; i++) {
        const x = i;
        const y = candles[startIndex + i].close;
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    }
    const slope = (N * sumXY - sumX * sumY) / (N * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / N;

    // Detrend
    for (let i = 0; i < N; i++) {
        const y = candles[startIndex + i].close;
        const trend = slope * i + intercept;
        data.push(y - trend);
    }

    // Simple DFT (Discrete Fourier Transform)
    // We only care about periods from ~4 to ~100 (cycles of interest)
    const spectrum = [];
    const MAX_PERIOD = N / 2;
    const MIN_PERIOD = 4;

    for (let period = MIN_PERIOD; period <= Math.min(MAX_PERIOD, 150); period++) {
        // Frequency k = N / Period
        // To be precise with DFT frequency bins, k must be integer. 
        // But for "Cycle Scanner", we can test specific periods directly (Correlation / Goertzel-like)
        // Let's stick to standard k integers to be mathematically valid for DFT

        // k from 1 to N/2
        // Period = N / k
        // We want periods ~4 to ~100
        // k range: N/100 to N/4
    }

    // Actually, calculate standard spectrum k=1..N/2
    const amplitudes = [];
    let maxAmp = 0;

    for (let k = 1; k < N / 2; k++) {
        let re = 0;
        let im = 0;
        for (let n = 0; n < N; n++) {
            const angle = (2 * Math.PI * k * n) / N;
            re += data[n] * Math.cos(angle);
            im -= data[n] * Math.sin(angle);
        }
        const amp = Math.sqrt(re * re + im * im);
        const period = N / k;

        if (period >= 4 && period <= 200) {
            amplitudes.push({ period, amp });
            if (amp > maxAmp) maxAmp = amp;
        }
    }

    // Sort by period descending for display (Left = Long cycles, Right = Short cycles?? 
    // Usually FFT is High Freq (Short Period) to Low Freq. 
    // Let's Draw Period on X axis: 0 -> 100+

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background style
    // ctx.fillStyle = '#1e293b';
    // ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (amplitudes.length === 0) return;

    // Draw
    const padding = 30;
    const width = canvas.width - padding * 2;
    const height = canvas.height - padding * 2;

    ctx.beginPath();
    ctx.fillStyle = '#a855f7'; // Purple fill for bars

    // Find Peaks (Local Maxima)
    const peaks = [];
    for (let i = 1; i < amplitudes.length - 1; i++) {
        const prev = amplitudes[i - 1].amp;
        const curr = amplitudes[i].amp;
        const next = amplitudes[i + 1].amp;

        if (curr > prev && curr > next) {
            peaks.push(amplitudes[i]);
        }
    }

    // Filter peaks: keep only significant ones (e.g. > 30% of max amplitude)
    // and limit to top 8 to avoid clutter
    peaks.sort((a, b) => b.amp - a.amp); // Sort by amp desc
    const topPeaks = peaks.slice(0, 8); // Top 8

    // Sort back by period for display logic if we want them ordered by period on X axis, 
    // BUT user wants distinct bars. 
    // Let's create evenly spaced bars for these specific dominant cycles
    topPeaks.sort((a, b) => a.period - b.period);

    // Clear and Draw
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (topPeaks.length === 0) return;

    // Recalculate maxAmp among top peaks for scaling
    // actually global maxAmp is fine or max of topPeaks
    const displayMaxAmp = topPeaks.reduce((max, p) => Math.max(max, p.amp), 0);

    // const padding = 30; // Already defined
    // const width = canvas.width - padding * 2; // Already defined
    // const height = canvas.height - padding * 2; // Already defined

    // Draw bars evenly spaced
    const barSlotWidth = width / topPeaks.length;
    const barWidth = Math.min(40, barSlotWidth * 0.6); // Max 40px wide or 60% of slot

    ctx.textAlign = 'center';
    ctx.font = '12px Inter';
    ctx.fillStyle = '#94a3b8'; // Label color

    // Find the true dominant (max amp) from the topPeaks set to highlighting
    const maxPeakVal = Math.max(...topPeaks.map(p => p.amp));

    for (let i = 0; i < topPeaks.length; i++) {
        const item = topPeaks[i];
        const isDominant = item.amp === maxPeakVal;

        // Center of slot
        const x = padding + i * barSlotWidth + (barSlotWidth / 2);
        const barHeight = (item.amp / displayMaxAmp) * height;
        const y = padding + height - barHeight;

        // Draw Bar
        // Color based on strength - Purple theme
        // Dominant gets special bright purple and full opacity
        if (isDominant) {
            ctx.fillStyle = '#d8b4fe'; // Bright Purple
            ctx.shadowColor = '#a855f7';
            ctx.shadowBlur = 10;
        } else {
            const opacity = 0.4 + 0.4 * (item.amp / displayMaxAmp);
            ctx.fillStyle = `rgba(168, 85, 247, ${opacity})`; // Purple base
            ctx.shadowBlur = 0;
        }

        ctx.fillRect(x - barWidth / 2, y, barWidth, barHeight);
        ctx.shadowBlur = 0; // Reset

        // Label (Period)
        ctx.fillStyle = isDominant ? '#ffffff' : '#cbd5e1';
        ctx.font = isDominant ? 'bold 12px Inter' : '11px Inter';
        ctx.fillText(Math.round(item.period), x, y - 5);

        // Label "DOM" for dominant
        if (isDominant) {
            ctx.fillStyle = '#d8b4fe';
            ctx.font = '9px Inter';
            ctx.fillText('DOM', x, y - 18);
        }
    }

    // Axis Label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('Cycle Period (Bars)', canvas.width / 2, canvas.height - 5);
}

// ========== OPTIMIZER FUNCTIONALITY ==========
function setupOptimizer() {
    const optimizeBtn = document.getElementById('optimize-btn');
    if (!optimizeBtn) return;
    optimizeBtn.addEventListener('click', () => runOptimization());
}

async function runOptimization() {
    const optimizeBtn = document.getElementById('optimize-btn');
    const originalText = optimizeBtn.innerHTML;
    optimizeBtn.innerHTML = '⏳ Optimizing...';
    optimizeBtn.disabled = true;

    const candles = chart.data;
    if (!candles || candles.length < 100) {
        alert('Not enough data. Load more candles first.');
        optimizeBtn.innerHTML = originalText;
        optimizeBtn.disabled = false;
        return;
    }

    // Calculate momentum values once
    const momentumValues = cycleMomentum ? cycleMomentum.calculate(candles) : [];

    const results = [];

    // Parameter ranges - Reduced by 50% (User req: too slow)
    const minDurs = [6, 7, 8, 10, 12, 13, 14, 16, 18, 20, 22, 25, 28];
    const maxDurs = [20, 24, 26, 28, 32, 36, 38, 40, 44, 48, 52, 56, 60, 70, 80];
    const tp1Pcts = [15, 20];
    const leverages = [10, 20];
    const capitalPcts = [20, 30];
    const threeBarOptions = [true, false];
    const momentumOptions = [false];
    const priorityMinOptions = [true, false];

    await new Promise(r => setTimeout(r, 50));

    let tested = 0;
    const total = minDurs.length * maxDurs.length * tp1Pcts.length * leverages.length *
        capitalPcts.length * threeBarOptions.length * momentumOptions.length * priorityMinOptions.length;

    for (const minDur of minDurs) {
        for (const maxDur of maxDurs) {
            if (maxDur <= minDur) continue;
            for (const tp1Pct of tp1Pcts) {
                for (const leverage of leverages) {
                    for (const capitalPct of capitalPcts) {
                        for (const threeBar of threeBarOptions) {
                            for (const useMom of momentumOptions) {
                                for (const priorityMin of priorityMinOptions) {
                                    tested++;

                                    try {
                                        const detector = new CycleDetector();
                                        const bot = new CycleTradingBot();

                                        bot.updateConfig({
                                            startingBalance: 1000,
                                            leverage: leverage,
                                            capitalPercentage: capitalPct,
                                            feesEnabled: true, // Always test with fees
                                            tp1AvgPercent: tp1Pct,
                                            tp1CloseFraction: 60,
                                            tp2AccountPercent: 1,
                                            threeBarConfirmation: threeBar,
                                            closeOnOpposite: false
                                        });

                                        bot.simulateLiveTrading(candles, detector, momentumValues, useMom, minDur, maxDur, priorityMin);

                                        const pnl = bot.currentBalance - 1000;
                                        if (bot.trades.length > 5) { // Need minimum trades
                                            const stats = bot.getStats();
                                            results.push({
                                                minDur, maxDur, tp1Pct, leverage, capitalPct,
                                                threeBar, useMom, priorityMin,
                                                pnl,
                                                pnlPct: (pnl / 1000) * 100,
                                                trades: bot.trades.length,
                                                winRate: stats.winRate || 0
                                            });
                                        }
                                    } catch (e) {
                                        // Skip failed
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    results.sort((a, b) => b.pnl - a.pnl);

    optimizeBtn.innerHTML = originalText;
    optimizeBtn.disabled = false;

    showOptimizationResults(results, tested);
}

function showOptimizationResults(results, tested) {
    const existing = document.getElementById('optimize-modal');
    if (existing) existing.remove();

    const best = results[0];
    const hasProfitable = best && best.pnl > 0;

    // Voice notification using Text-to-Speech
    try {
        const msg = new SpeechSynthesisUtterance();
        msg.text = hasProfitable ? 'Optimization found! Profit detected.' : 'Optimization complete. No profit found.';
        msg.rate = 1.1;
        msg.pitch = hasProfitable ? 1.2 : 0.8;
        msg.volume = 1;
        speechSynthesis.speak(msg);
    } catch (e) { console.log('Speech error:', e); }


    const modal = document.createElement('div');
    modal.id = 'optimize-modal';
    modal.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #1e293b, #0f172a); border: 1px solid #334155;
        border-radius: 12px; padding: 24px; z-index: 10000; min-width: 420px; max-width: 500px;
        box-shadow: 0 25px 50px rgba(0,0,0,0.5); color: white; font-family: sans-serif;
    `;

    let html = `
        <h3 style="margin: 0 0 16px 0; display: flex; align-items: center; gap: 8px;">
            🔍 Optimization Results
            <span style="color: #9ca3af; font-size: 12px; font-weight: normal;">(${tested} combinations tested)</span>
            <button onclick="document.getElementById('optimize-modal').remove()" 
                    style="background: none; border: none; color: #9ca3af; font-size: 20px; cursor: pointer; margin-left: auto;">×</button>
        </h3>
    `;

    if (hasProfitable) {
        html += `
            <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                <div style="font-weight: bold; color: #10b981; margin-bottom: 12px;">✅ Best Settings Found (With Fees)</div>
                <table style="width: 100%; font-size: 13px; line-height: 1.6;">
                    <tr><td style="color: #9ca3af;">Range:</td><td style="text-align: right; font-weight: bold;">${best.minDur} - ${best.maxDur} bars</td></tr>
                    <tr><td style="color: #9ca3af;">TP1%:</td><td style="text-align: right; font-weight: bold;">${best.tp1Pct}%</td></tr>
                    <tr><td style="color: #9ca3af;">Leverage:</td><td style="text-align: right; font-weight: bold;">${best.leverage}x</td></tr>
                    <tr><td style="color: #9ca3af;">Capital%:</td><td style="text-align: right; font-weight: bold;">${best.capitalPct}%</td></tr>
                    <tr><td style="color: #9ca3af;">3-Bar Conf:</td><td style="text-align: right; font-weight: bold;">${best.threeBar ? '✓ ON' : '✗ OFF'}</td></tr>
                    <tr><td style="color: #9ca3af;">Mom Filter:</td><td style="text-align: right; font-weight: bold;">${best.useMom ? '✓ ON' : '✗ OFF'}</td></tr>
                    <tr><td style="color: #9ca3af;">Force Min:</td><td style="text-align: right; font-weight: bold;">${best.priorityMin ? '✓ ON' : '✗ OFF'}</td></tr>
                </table>
                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #10b981; font-size: 20px; font-weight: bold;">+$${best.pnl.toFixed(0)} (${best.pnlPct.toFixed(1)}%)</span>
                        <span style="color: #9ca3af; font-size: 12px;">${best.trades} trades | ${best.winRate.toFixed(0)}% WR</span>
                    </div>
                </div>
            </div>
            <button id="apply-optimize-btn" style="
                width: 100%; padding: 14px; background: linear-gradient(135deg, #10b981, #059669);
                border: none; border-radius: 8px; color: white; font-weight: bold; font-size: 15px;
                cursor: pointer;
            ">
                ✨ Apply Best Settings
            </button>
        `;
    } else {
        html += `
            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 8px; padding: 16px;">
                <div style="font-weight: bold; color: #ef4444;">❌ No Profitable Settings Found</div>
                <p style="color: #9ca3af; margin: 8px 0 0 0; font-size: 14px;">
                    Try a longer timeframe (15m, 1h) where cycle patterns are more reliable.
                </p>
            </div>
        `;
    }

    modal.innerHTML = html;
    document.body.appendChild(modal);

    if (hasProfitable) {
        document.getElementById('apply-optimize-btn').addEventListener('click', () => {
            applyOptimizedSettings(best);
            modal.remove();
        });
    }
}

function applyOptimizedSettings(settings) {
    try {
        // 1. Apply Range Settings
        const customMin = document.getElementById('custom-min');
        const customMax = document.getElementById('custom-max');
        if (customMin) customMin.value = settings.minDur;
        if (customMax) customMax.value = settings.maxDur;

        // 2. Apply Bot Settings
        const levInput = document.getElementById('bot-leverage');
        const capInput = document.getElementById('bot-capital');
        const tp1Input = document.getElementById('bot-tp1-pct');
        if (levInput) levInput.value = settings.leverage;
        if (capInput) capInput.value = settings.capitalPct;
        if (tp1Input) tp1Input.value = settings.tp1Pct;

        // 3. Apply Toggle Settings
        const threeBarEl = document.getElementById('bot-3bar');
        const momFilterEl = document.getElementById('use-momentum-rule');
        const priorityEl = document.getElementById('priority-24-bars');
        const feesEl = document.getElementById('bot-fees');

        if (threeBarEl) threeBarEl.checked = settings.threeBar;
        if (momFilterEl) momFilterEl.checked = settings.useMom;
        if (priorityEl) priorityEl.checked = settings.priorityMin;
        if (feesEl) feesEl.checked = true; // Optimized with fees

        // 4. Update bot config directly
        cycleBot.updateConfig({
            leverage: settings.leverage,
            capitalPercentage: settings.capitalPct,
            tp1AvgPercent: settings.tp1Pct,
            threeBarConfirmation: settings.threeBar,
            feesEnabled: true
        });

        // 5. Trigger recalculation
        if (chart.data && chart.data.length > 0) {
            recalculateIndicatorsAndCycles(chart.data);
        }

        // 6. Show success toast
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; background: #10b981; color: white;
            padding: 12px 20px; border-radius: 8px; font-weight: bold; z-index: 10001;
        `;
        toast.innerHTML = '✅ Settings applied!';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);

    } catch (e) {
        console.error('Error applying settings:', e);
        alert('Error applying settings. Check console for details.');
    }
}

// Initialize optimizer
document.addEventListener('DOMContentLoaded', () => setTimeout(setupOptimizer, 100));

const voiceAnnouncer = {
    enabled: false,
    lastTradesState: new Map(),

    init() {
        const toggle = document.getElementById('voice-enabled');
        if (toggle) {
            this.enabled = toggle.checked;
            toggle.addEventListener('change', () => {
                this.enabled = toggle.checked;
                if (this.enabled) this.speak('Voice notifications enabled');
            });
        }
    },

    speak(text) {
        if (!this.enabled) return;
        const msg = new SpeechSynthesisUtterance(text);
        msg.rate = 1.0;
        window.speechSynthesis.speak(msg);
    },

    process(trades, currentCandleIndex) {
        if (!this.enabled || !trades) return;

        trades.forEach(trade => {
            const id = trade.id;
            const prevState = this.lastTradesState.get(id);

            if (!prevState) {
                if (trade.entryIndex >= currentCandleIndex - 1) {
                    const type = trade.type === 'LONG' ? 'Long' : 'Short';
                    this.speak(`${type} Taken`);
                }
                this.lastTradesState.set(id, {
                    exitReason: trade.reason,
                    closed: trade.exitIndex !== undefined
                });
                return;
            }

            const currentReason = trade.reason || '';
            const previousReason = prevState.exitReason || '';

            if (currentReason !== previousReason) {
                if (currentReason.includes('break_even') && !previousReason.includes('break_even')) {
                    if (trade.exitIndex >= currentCandleIndex - 1) this.speak('Break Even Taken');
                }

                if (currentReason.includes('tp1') && !previousReason.includes('tp1')) {
                    if (trade.exitIndex >= currentCandleIndex - 1) this.speak('TP One Taken');
                }

                if (currentReason.includes('cycle') && !previousReason.includes('cycle')) {
                    if (trade.exitIndex >= currentCandleIndex - 1) this.speak('Cycle Closed');
                }

                prevState.exitReason = currentReason;
                prevState.closed = trade.exitIndex !== undefined;
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', () => voiceAnnouncer.init());
