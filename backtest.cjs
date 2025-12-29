/**
 * Backtest - Trade Analysis with detailed exit reasons
 */

const https = require('https');

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

function checkLocalMax(candles, index) {
    if (index < 1 || index >= candles.length - 1) return false;
    return candles[index].high > candles[index - 1].high && candles[index].high > candles[index + 1].high;
}

function checkLocalMin(candles, index) {
    if (index < 1 || index >= candles.length - 1) return false;
    return candles[index].low < candles[index - 1].low && candles[index].low < candles[index + 1].low;
}

function detectCycles(candles, invert, minDuration = 24, maxDuration = 44) {
    const cycles = [];
    let i = 0;
    while (i < candles.length - minDuration) {
        const isStart = invert ? checkLocalMin(candles, i) : checkLocalMax(candles, i);
        if (!isStart) { i++; continue; }
        for (let j = i + minDuration; j <= Math.min(i + maxDuration, candles.length - 2); j++) {
            const isEnd = invert ? checkLocalMin(candles, j) : checkLocalMax(candles, j);
            if (isEnd) { cycles.push({ startIndex: i, endIndex: j }); i = j; break; }
        }
        i++;
    }
    return cycles;
}

async function main() {
    console.log('Fetching data...\n');

    const baseUrl = 'https://fapi.binance.com/fapi/v1/klines';
    const data = await fetchJSON(`${baseUrl}?symbol=BTCUSDT&interval=15m&limit=1000`);
    const candles = data.map(c => ({
        open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4])
    }));

    console.log(`Loaded ${candles.length} candles (15m BTCUSDT)\n`);

    // Detect cycles
    const indexCycles = detectCycles(candles, true);  // Inverted -> LONG
    const inverseCycles = detectCycles(candles, false); // Normal -> SHORT

    console.log(`Index cycles (LONG signals): ${indexCycles.length}`);
    console.log(`Inverse cycles (SHORT signals): ${inverseCycles.length}\n`);

    // Calculate averages (last 10)
    const last10Index = indexCycles.slice(-10);
    const last10Inverse = inverseCycles.slice(-10);

    let avgIndexPump = 0;
    last10Index.forEach(c => {
        avgIndexPump += ((candles[c.endIndex].high - candles[c.startIndex].low) / candles[c.startIndex].low) * 100;
    });
    avgIndexPump = last10Index.length > 0 ? avgIndexPump / last10Index.length : 0;

    let avgInverseDrop = 0;
    last10Inverse.forEach(c => {
        avgInverseDrop += ((candles[c.startIndex].high - candles[c.endIndex].low) / candles[c.startIndex].high) * 100;
    });
    avgInverseDrop = last10Inverse.length > 0 ? avgInverseDrop / last10Inverse.length : 0;

    console.log(`Avg Index Pump (last 10): ${avgIndexPump.toFixed(2)}%`);
    console.log(`Avg Inverse Drop (last 10): ${avgInverseDrop.toFixed(2)}%`);
    console.log(`TP1 target LONG: ${(avgIndexPump * 0.5).toFixed(2)}%`);
    console.log(`TP1 target SHORT: ${(avgInverseDrop * 0.5).toFixed(2)}%\n`);

    // Simulate trades
    const leverage = 20;
    const capitalPct = 20;
    const startBal = 1000;
    let balance = startBal;

    const trades = [];

    // Build signals
    const signals = new Map();
    indexCycles.forEach(c => {
        const idx = c.endIndex + 1;
        if (idx < candles.length) {
            if (!signals.has(idx)) signals.set(idx, []);
            signals.get(idx).push({ type: 'LONG', slPrice: candles[c.startIndex].low });
        }
    });
    inverseCycles.forEach(c => {
        const idx = c.endIndex + 1;
        if (idx < candles.length) {
            if (!signals.has(idx)) signals.set(idx, []);
            signals.get(idx).push({ type: 'SHORT', slPrice: candles[c.startIndex].high });
        }
    });

    let pos = null;

    for (let i = 0; i < candles.length; i++) {
        const cdl = candles[i];

        // Check exits
        if (pos) {
            // LONG exits
            if (pos.type === 'LONG') {
                // SL: close below cycle min
                if (cdl.close < pos.slPrice && !pos.beActive) {
                    const pnl = ((cdl.close - pos.entry) / pos.entry) * pos.cap * leverage;
                    trades.push({ ...pos, exit: cdl.close, exitIdx: i, reason: 'sl_cycle_min', pnl });
                    balance += pnl;
                    pos = null;
                }
                // BE SL
                else if (pos.beActive && cdl.close <= pos.entry) {
                    const pnl = 0;
                    trades.push({ ...pos, exit: pos.entry, exitIdx: i, reason: 'break_even', pnl });
                    pos = null;
                }
                // TP1
                else if (!pos.tp1Done) {
                    const pump = ((cdl.close - pos.entry) / pos.entry) * 100;
                    const tp1 = avgIndexPump * 0.5;
                    if (pump >= tp1 && tp1 > 0) {
                        const closedCap = pos.cap * 0.6;
                        const pnl = (pump / 100) * closedCap * leverage;
                        trades.push({ ...pos, exit: cdl.close, exitIdx: i, reason: 'tp1_partial', pnl, partial: '60%' });
                        balance += pnl;
                        pos.cap -= closedCap;
                        pos.tp1Done = true;
                        pos.beActive = true;
                    }
                }
                // TP2
                else if (pos.tp1Done) {
                    const pnlAmt = ((cdl.close - pos.entry) / pos.entry) * pos.cap * leverage;
                    const tp2 = startBal * 0.01;
                    if (pnlAmt >= tp2) {
                        trades.push({ ...pos, exit: cdl.close, exitIdx: i, reason: 'tp2_account', pnl: pnlAmt });
                        balance += pnlAmt;
                        pos = null;
                    }
                }
            }

            // SHORT exits
            if (pos && pos.type === 'SHORT') {
                // SL: close above cycle max
                if (cdl.close > pos.slPrice && !pos.beActive) {
                    const pnl = ((pos.entry - cdl.close) / pos.entry) * pos.cap * leverage;
                    trades.push({ ...pos, exit: cdl.close, exitIdx: i, reason: 'sl_cycle_max', pnl });
                    balance += pnl;
                    pos = null;
                }
                // BE SL
                else if (pos.beActive && cdl.close >= pos.entry) {
                    const pnl = 0;
                    trades.push({ ...pos, exit: pos.entry, exitIdx: i, reason: 'break_even', pnl });
                    pos = null;
                }
                // TP1
                else if (!pos.tp1Done) {
                    const drop = ((pos.entry - cdl.close) / pos.entry) * 100;
                    const tp1 = avgInverseDrop * 0.5;
                    if (drop >= tp1 && tp1 > 0) {
                        const closedCap = pos.cap * 0.6;
                        const pnl = (drop / 100) * closedCap * leverage;
                        trades.push({ ...pos, exit: cdl.close, exitIdx: i, reason: 'tp1_partial', pnl, partial: '60%' });
                        balance += pnl;
                        pos.cap -= closedCap;
                        pos.tp1Done = true;
                        pos.beActive = true;
                    }
                }
                // TP2
                else if (pos.tp1Done) {
                    const pnlAmt = ((pos.entry - cdl.close) / pos.entry) * pos.cap * leverage;
                    const tp2 = startBal * 0.01;
                    if (pnlAmt >= tp2) {
                        trades.push({ ...pos, exit: cdl.close, exitIdx: i, reason: 'tp2_account', pnl: pnlAmt });
                        balance += pnlAmt;
                        pos = null;
                    }
                }
            }
        }

        // New entries
        if (signals.has(i)) {
            const sigs = signals.get(i);
            for (const sig of sigs) {
                if (pos && pos.type !== sig.type) {
                    // Close opposite
                    const pnl = pos.type === 'LONG'
                        ? ((cdl.open - pos.entry) / pos.entry) * pos.cap * leverage
                        : ((pos.entry - cdl.open) / pos.entry) * pos.cap * leverage;
                    trades.push({ ...pos, exit: cdl.open, exitIdx: i, reason: 'opposite_signal', pnl });
                    balance += pnl;
                    pos = null;
                }
                if (!pos) {
                    pos = {
                        type: sig.type,
                        entry: cdl.open,
                        entryIdx: i,
                        cap: balance * (capitalPct / 100),
                        slPrice: sig.slPrice,
                        tp1Done: false,
                        beActive: false
                    };
                }
                break;
            }
        }
    }

    // Close remaining
    if (pos) {
        const cdl = candles[candles.length - 1];
        const pnl = pos.type === 'LONG'
            ? ((cdl.close - pos.entry) / pos.entry) * pos.cap * leverage
            : ((pos.entry - cdl.close) / pos.entry) * pos.cap * leverage;
        trades.push({ ...pos, exit: cdl.close, exitIdx: candles.length - 1, reason: 'end_of_data', pnl });
        balance += pnl;
    }

    // Output table
    console.log('\n=== TRADE LIST ===\n');
    console.log('| # | Type  | Entry Price | Exit Price  | Entry Idx | Exit Idx | Reason          | PnL      |');
    console.log('|---|-------|-------------|-------------|-----------|----------|-----------------|----------|');

    trades.forEach((t, i) => {
        const pnlStr = (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(2);
        const partial = t.partial ? ` (${t.partial})` : '';
        console.log(`| ${String(i + 1).padStart(1)} | ${t.type.padEnd(5)} | ${t.entry.toFixed(2).padStart(11)} | ${t.exit.toFixed(2).padStart(11)} | ${String(t.entryIdx).padStart(9)} | ${String(t.exitIdx).padStart(8)} | ${(t.reason + partial).padEnd(15)} | ${pnlStr.padStart(8)} |`);
    });

    // Stats by reason
    console.log('\n=== EXIT REASONS SUMMARY ===\n');
    const reasonCounts = {};
    trades.forEach(t => {
        if (!reasonCounts[t.reason]) reasonCounts[t.reason] = { count: 0, pnl: 0 };
        reasonCounts[t.reason].count++;
        reasonCounts[t.reason].pnl += t.pnl;
    });

    console.log('| Reason          | Count | Total PnL |');
    console.log('|-----------------|-------|-----------|');
    Object.keys(reasonCounts).forEach(r => {
        const pnlStr = (reasonCounts[r].pnl >= 0 ? '+' : '') + reasonCounts[r].pnl.toFixed(2);
        console.log(`| ${r.padEnd(15)} | ${String(reasonCounts[r].count).padStart(5)} | ${pnlStr.padStart(9)} |`);
    });

    console.log(`\nTotal Trades: ${trades.length}`);
    console.log(`Final Balance: $${balance.toFixed(2)} (${((balance / startBal - 1) * 100).toFixed(2)}%)`);
}

main().catch(console.error);
