/**
 * Parameter Optimizer for Cycle Trading Bot
 * Tests different parameter combinations to find profitable settings
 */

const https = require('https');

// Fetch candles from Binance
async function fetchCandles(symbol, interval, limit = 1500) {
    return new Promise((resolve, reject) => {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const candles = parsed.map(k => ({
                        time: k[0],
                        open: parseFloat(k[1]),
                        high: parseFloat(k[2]),
                        low: parseFloat(k[3]),
                        close: parseFloat(k[4]),
                        volume: parseFloat(k[5])
                    }));
                    resolve(candles);
                } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

// Simple cycle detector (mimics the main logic)
function detectCycles(candles, invert, minDur, maxDur) {
    const cycles = [];
    let i = 0;

    const checkLocalMax = (idx) => {
        if (idx <= 0 || idx >= candles.length - 1) return false;
        return candles[idx].high > candles[idx - 1].high && candles[idx].high > candles[idx + 1].high;
    };

    const checkLocalMin = (idx) => {
        if (idx <= 0 || idx >= candles.length - 1) return false;
        return candles[idx].low < candles[idx - 1].low && candles[idx].low < candles[idx + 1].low;
    };

    const isStart = (idx) => invert ? checkLocalMin(candles, idx) : checkLocalMax(candles, idx);

    while (i < candles.length - minDur) {
        const startCheck = invert ? checkLocalMin(i) : checkLocalMax(i);
        if (startCheck) {
            // Look for end
            for (let j = i + minDur; j <= Math.min(i + maxDur, candles.length - 1); j++) {
                const endCheck = invert ? checkLocalMin(j) : checkLocalMax(j);
                if (endCheck) {
                    cycles.push({ startIndex: i, endIndex: j, duration: j - i });
                    i = j;
                    break;
                }
            }
        }
        i++;
    }
    return cycles;
}

// Simulate trading with given parameters
function simulateTrading(candles, params) {
    const { minDur, maxDur, tp1Pct, leverage, capitalPct, feesEnabled } = params;

    let balance = 1000;
    const startBal = balance;
    let trades = 0;
    let wins = 0;

    // Detect cycles
    const idxCycles = detectCycles(candles, true, minDur, maxDur);  // LONG signals
    const invCycles = detectCycles(candles, false, minDur, maxDur); // SHORT signals

    // Process each cycle
    let lastLongEnd = -1;
    let lastShortEnd = -1;

    // LONG trades from index cycles
    for (const cycle of idxCycles) {
        if (cycle.startIndex <= lastLongEnd) continue;

        const entryIdx = cycle.endIndex + 1;
        if (entryIdx >= candles.length - 5) continue;

        const entryPrice = candles[entryIdx].close;
        const slPrice = candles[cycle.startIndex].low;
        const capitalUsed = balance * (capitalPct / 100);
        const posSize = (capitalUsed * leverage) / entryPrice;

        // Simulate exit
        let exitPrice = entryPrice;
        let reason = 'cycle_end';

        for (let k = entryIdx + 1; k < Math.min(entryIdx + maxDur, candles.length); k++) {
            const c = candles[k];
            // SL check
            if (c.close < slPrice) {
                exitPrice = c.close;
                reason = 'sl';
                break;
            }
            // TP check (simplified)
            const gain = ((c.close - entryPrice) / entryPrice) * 100;
            if (gain >= tp1Pct * 0.5) {
                exitPrice = c.close;
                reason = 'tp';
                break;
            }
        }

        const pnl = ((exitPrice - entryPrice) / entryPrice) * capitalUsed * leverage;
        const fees = feesEnabled ? capitalUsed * leverage * 0.0004 * 2 : 0;
        balance += pnl - fees;
        trades++;
        if (pnl > 0) wins++;
        lastLongEnd = cycle.endIndex;
    }

    // SHORT trades from inverse cycles
    for (const cycle of invCycles) {
        if (cycle.startIndex <= lastShortEnd) continue;

        const entryIdx = cycle.endIndex + 1;
        if (entryIdx >= candles.length - 5) continue;

        const entryPrice = candles[entryIdx].close;
        const slPrice = candles[cycle.startIndex].high;
        const capitalUsed = balance * (capitalPct / 100);
        const posSize = (capitalUsed * leverage) / entryPrice;

        // Simulate exit
        let exitPrice = entryPrice;

        for (let k = entryIdx + 1; k < Math.min(entryIdx + maxDur, candles.length); k++) {
            const c = candles[k];
            // SL check
            if (c.close > slPrice) {
                exitPrice = c.close;
                break;
            }
            // TP check
            const gain = ((entryPrice - c.close) / entryPrice) * 100;
            if (gain >= tp1Pct * 0.5) {
                exitPrice = c.close;
                break;
            }
        }

        const pnl = ((entryPrice - exitPrice) / entryPrice) * capitalUsed * leverage;
        const fees = feesEnabled ? capitalUsed * leverage * 0.0004 * 2 : 0;
        balance += pnl - fees;
        trades++;
        if (pnl > 0) wins++;
        lastShortEnd = cycle.endIndex;
    }

    return {
        pnl: balance - startBal,
        pnlPct: ((balance - startBal) / startBal) * 100,
        trades,
        winRate: trades > 0 ? (wins / trades) * 100 : 0,
        balance
    };
}

async function optimize() {
    console.log('🔍 Fetching 1H candles for SUIUSDT (WITH FEES)...');
    const candles = await fetchCandles('SUIUSDT', '1h', 1000);
    console.log(`📊 Got ${candles.length} candles\n`);

    const results = [];

    // Parameter ranges - for 1H
    const minDurs = [12, 18, 24, 30];
    const maxDurs = [36, 44, 52, 60];
    const tp1Pcts = [0.3, 0.5, 0.8, 1.0, 1.5];
    const leverages = [5, 10, 20];
    const capitalPcts = [10, 20, 30];

    console.log('🔄 Testing parameter combinations...\n');

    for (const minDur of minDurs) {
        for (const maxDur of maxDurs) {
            if (maxDur <= minDur) continue;
            for (const tp1Pct of tp1Pcts) {
                for (const leverage of leverages) {
                    for (const capitalPct of capitalPcts) {
                        const params = { minDur, maxDur, tp1Pct, leverage, capitalPct, feesEnabled: true };
                        const result = simulateTrading(candles, params);
                        results.push({ ...params, ...result });
                    }
                }
            }
        }
    }

    // Sort by PnL
    results.sort((a, b) => b.pnl - a.pnl);

    console.log('🏆 TOP 10 PROFITABLE SETTINGS:\n');
    console.log('MinDur | MaxDur | TP1% | Lev | Cap% | PnL$ | PnL% | Trades | WinRate');
    console.log('-------+--------+------+-----+------+------+------+--------+--------');

    for (let i = 0; i < Math.min(10, results.length); i++) {
        const r = results[i];
        if (r.pnl <= 0) break;
        console.log(
            `${String(r.minDur).padStart(6)} | ${String(r.maxDur).padStart(6)} | ${r.tp1Pct.toFixed(1).padStart(4)} | ${String(r.leverage).padStart(3)} | ${String(r.capitalPct).padStart(4)} | ${r.pnl.toFixed(0).padStart(4)} | ${r.pnlPct.toFixed(1).padStart(4)}% | ${String(r.trades).padStart(6)} | ${r.winRate.toFixed(0)}%`
        );
    }

    if (results[0].pnl > 0) {
        console.log('\n✅ BEST SETTINGS:');
        console.log(`   Min Duration: ${results[0].minDur}`);
        console.log(`   Max Duration: ${results[0].maxDur}`);
        console.log(`   TP1 %: ${results[0].tp1Pct}`);
        console.log(`   Leverage: ${results[0].leverage}x`);
        console.log(`   Capital %: ${results[0].capitalPct}%`);
        console.log(`   Expected PnL: $${results[0].pnl.toFixed(2)} (${results[0].pnlPct.toFixed(1)}%)`);
    } else {
        console.log('\n❌ No profitable settings found with current strategy');
    }
}

optimize().catch(console.error);
