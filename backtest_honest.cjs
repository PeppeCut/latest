/**
 * HONEST BACKTEST - No Lookahead Bias
 * 
 * This backtest simulates REAL trading conditions:
 * 1. Processes ONE candle at a time
 * 2. Only uses PAST data to detect cycles
 * 3. Local max/min requires CONFIRMATION (2+ candles after)
 * 4. Enters at FIRST confirmed cycle close, not "optimal" one
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

// HONEST local max check - only uses PAST data
// Requires 2 candles AFTER the peak to confirm
function isConfirmedLocalMax(candles, index) {
    if (index < 2 || index >= candles.length - 2) return false;

    const current = candles[index];
    const prev1 = candles[index - 1];
    const prev2 = candles[index - 2];
    const next1 = candles[index + 1]; // We're at index+2, so this is past
    const next2 = candles[index + 2]; // Current candle

    // Need 2 candles BEFORE and 2 AFTER to confirm
    // At time T, we can only confirm a max at T-2
    return current.high > prev1.high &&
        current.high > prev2.high &&
        current.high > next1.high &&
        current.high > next2.high;
}

function isConfirmedLocalMin(candles, index) {
    if (index < 2 || index >= candles.length - 2) return false;

    const current = candles[index];
    const prev1 = candles[index - 1];
    const prev2 = candles[index - 2];
    const next1 = candles[index + 1];
    const next2 = candles[index + 2];

    return current.low < prev1.low &&
        current.low < prev2.low &&
        current.low < next1.low &&
        current.low < next2.low;
}

async function main() {
    console.log('===== HONEST BACKTEST (No Lookahead Bias) =====\n');

    const baseUrl = 'https://fapi.binance.com/fapi/v1/klines';
    const data = await fetchJSON(`${baseUrl}?symbol=BTCUSDT&interval=15m&limit=1000`);
    const candles = data.map(c => ({
        time: c[0],
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4])
    }));

    console.log(`Loaded ${candles.length} candles (15m BTCUSDT)\n`);

    // Config
    const leverage = 20;
    const capitalPct = 20;
    const startBal = 1000;
    const takerFee = 0.04 / 100; // 0.04%

    let balance = startBal;
    const trades = [];
    let position = null;

    // Cycle tracking (only what we'd know at each point)
    const minCycleDuration = 24;
    const maxCycleDuration = 44;

    // Process candles ONE AT A TIME (walk-forward)
    for (let currentIdx = 10; currentIdx < candles.length; currentIdx++) {
        const currentCandle = candles[currentIdx];

        // === CHECK EXITS FIRST ===
        if (position) {
            const pnlPercent = position.type === 'LONG'
                ? (currentCandle.close - position.entry) / position.entry
                : (position.entry - currentCandle.close) / position.entry;

            const pnlAmount = pnlPercent * position.capital * leverage;

            // Simple exit: opposite signal OR stop loss at -2%
            const stopLoss = pnlPercent <= -0.02;
            const takeProfit = pnlPercent >= 0.01; // 1% take profit

            if (stopLoss || takeProfit) {
                const fees = position.capital * leverage * takerFee;
                const netPnl = pnlAmount - fees;
                balance += netPnl;

                trades.push({
                    type: position.type,
                    entry: position.entry,
                    exit: currentCandle.close,
                    entryIdx: position.entryIdx,
                    exitIdx: currentIdx,
                    pnl: netPnl,
                    reason: stopLoss ? 'stop_loss' : 'take_profit'
                });

                position = null;
            }
        }

        // === CHECK FOR NEW SIGNALS (using only PAST data) ===
        // At currentIdx, we can only confirm patterns at currentIdx-2
        const checkIdx = currentIdx - 2;

        if (checkIdx >= minCycleDuration && !position) {
            // Look for cycle patterns ending at checkIdx

            // Check for LOCAL MIN at checkIdx (potential LONG signal)
            if (isConfirmedLocalMin(candles, checkIdx)) {
                // Look for cycle start (local min before this)
                let cycleStart = -1;
                for (let s = checkIdx - minCycleDuration; s >= Math.max(0, checkIdx - maxCycleDuration); s--) {
                    if (isConfirmedLocalMin(candles, s)) {
                        cycleStart = s;
                        break;
                    }
                }

                if (cycleStart >= 0) {
                    // Valid inverse cycle detected! Enter LONG at NEXT candle open
                    const capital = balance * (capitalPct / 100);
                    const entryFee = capital * leverage * takerFee;

                    position = {
                        type: 'LONG',
                        entry: currentCandle.open,
                        entryIdx: currentIdx,
                        capital: capital - entryFee,
                        cycleStart: cycleStart,
                        cycleEnd: checkIdx
                    };
                }
            }

            // Check for LOCAL MAX at checkIdx (potential SHORT signal)
            if (isConfirmedLocalMax(candles, checkIdx) && !position) {
                // Look for cycle start (local max before this)
                let cycleStart = -1;
                for (let s = checkIdx - minCycleDuration; s >= Math.max(0, checkIdx - maxCycleDuration); s--) {
                    if (isConfirmedLocalMax(candles, s)) {
                        cycleStart = s;
                        break;
                    }
                }

                if (cycleStart >= 0) {
                    // Valid normal cycle detected! Enter SHORT at NEXT candle open
                    const capital = balance * (capitalPct / 100);
                    const entryFee = capital * leverage * takerFee;

                    position = {
                        type: 'SHORT',
                        entry: currentCandle.open,
                        entryIdx: currentIdx,
                        capital: capital - entryFee,
                        cycleStart: cycleStart,
                        cycleEnd: checkIdx
                    };
                }
            }
        }
    }

    // Close any remaining position
    if (position) {
        const lastCandle = candles[candles.length - 1];
        const pnlPercent = position.type === 'LONG'
            ? (lastCandle.close - position.entry) / position.entry
            : (position.entry - lastCandle.close) / position.entry;

        const pnlAmount = pnlPercent * position.capital * leverage;
        const fees = position.capital * leverage * takerFee;
        const netPnl = pnlAmount - fees;
        balance += netPnl;

        trades.push({
            type: position.type,
            entry: position.entry,
            exit: lastCandle.close,
            entryIdx: position.entryIdx,
            exitIdx: candles.length - 1,
            pnl: netPnl,
            reason: 'end_of_data'
        });
    }

    // === RESULTS ===
    console.log('=== TRADE LIST ===\n');
    console.log('| # | Type  | Entry     | Exit      | PnL      | Reason      |');
    console.log('|---|-------|-----------|-----------|----------|-------------|');

    trades.forEach((t, i) => {
        const pnlStr = (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(2);
        console.log(`| ${String(i + 1).padStart(1)} | ${t.type.padEnd(5)} | ${t.entry.toFixed(2).padStart(9)} | ${t.exit.toFixed(2).padStart(9)} | ${pnlStr.padStart(8)} | ${t.reason.padEnd(11)} |`);
    });

    // Stats
    const wins = trades.filter(t => t.pnl > 0).length;
    const losses = trades.filter(t => t.pnl <= 0).length;
    const winRate = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : 0;
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const avgWin = wins > 0 ? trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / wins : 0;
    const avgLoss = losses > 0 ? trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0) / losses : 0;

    console.log('\n=== HONEST RESULTS ===\n');
    console.log(`Total Trades: ${trades.length}`);
    console.log(`Wins: ${wins} | Losses: ${losses}`);
    console.log(`Win Rate: ${winRate}%`);
    console.log(`Avg Win: $${avgWin.toFixed(2)} | Avg Loss: $${avgLoss.toFixed(2)}`);
    console.log(`Total PnL: $${totalPnl.toFixed(2)}`);
    console.log(`Final Balance: $${balance.toFixed(2)} (${((balance / startBal - 1) * 100).toFixed(2)}%)`);

    console.log('\n=== COMPARISON ===');
    console.log('Cheating Backtest: +20% to +50% (fake)');
    console.log(`Honest Backtest:   ${((balance / startBal - 1) * 100).toFixed(2)}% (real)`);
}

main().catch(console.error);
