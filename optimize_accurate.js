/**
 * ACCURATE Parameter Optimizer
 * Uses the EXACT same logic as the app by importing cycle_bot.js and cycle_detector.js
 */

const https = require('https');
const fs = require('fs');
const vm = require('vm');

// Load the actual app code
const cycleDetectorCode = fs.readFileSync('./cycle_detector.js', 'utf8');
const cycleBotCode = fs.readFileSync('./cycle_bot.js', 'utf8');

// Create module-like environment
const moduleExports = {};
const context = {
    module: { exports: moduleExports },
    exports: moduleExports,
    console: console,
    Math: Math,
    parseFloat: parseFloat,
    parseInt: parseInt,
    Set: Set,
    Map: Map,
    Array: Array,
    Object: Object,
    Number: Number,
    String: String
};

// Execute the code
vm.createContext(context);
vm.runInContext(cycleDetectorCode, context);
const CycleDetector = context.module.exports.CycleDetector || context.CycleDetector;

// Reset for bot
context.module = { exports: {} };
context.exports = context.module.exports;
vm.runInContext(cycleBotCode, context);
const CycleTradingBot = context.module.exports.CycleTradingBot || context.CycleTradingBot;

// Fetch candles from Binance
async function fetchCandles(symbol, interval, limit = 1000) {
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

async function optimizeTimeframe(symbol, interval, intervalName) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 Optimizing ${intervalName} for ${symbol}...`);
    console.log(`${'='.repeat(60)}`);

    const candles = await fetchCandles(symbol, interval, 1000);
    console.log(`📊 Got ${candles.length} candles\n`);

    const results = [];

    // Parameter ranges
    const minDurs = [10, 12, 18, 24, 30];
    const maxDurs = [30, 36, 44, 52, 60];
    const tp1Pcts = [20, 30, 40, 50, 60];
    const leverages = [10, 20];
    const capitalPcts = [20, 30];

    let tested = 0;
    const total = minDurs.length * maxDurs.length * tp1Pcts.length * leverages.length * capitalPcts.length;

    for (const minDur of minDurs) {
        for (const maxDur of maxDurs) {
            if (maxDur <= minDur) continue;
            for (const tp1Pct of tp1Pcts) {
                for (const leverage of leverages) {
                    for (const capitalPct of capitalPcts) {
                        tested++;

                        // Create fresh instances
                        const detector = new CycleDetector();
                        const bot = new CycleTradingBot();

                        // Configure bot
                        bot.updateConfig({
                            startingBalance: 1000,
                            leverage: leverage,
                            capitalPercentage: capitalPct,
                            feesEnabled: true,  // FEES ON!
                            tp1AvgPercent: tp1Pct,
                            tp1CloseFraction: 60,
                            tp2AccountPercent: 1,
                            threeBarConfirmation: true,
                            closeOnOpposite: false
                        });

                        // Run simulation using REAL app logic
                        try {
                            bot.simulateLiveTrading(
                                candles,
                                detector,
                                [],     // momentumValues
                                false,  // useMomentum
                                minDur,
                                maxDur,
                                true    // priorityMinDuration
                            );

                            const stats = bot.getStats();
                            const pnl = bot.currentBalance - 1000;
                            const pnlPct = (pnl / 1000) * 100;

                            results.push({
                                minDur, maxDur, tp1Pct, leverage, capitalPct,
                                pnl, pnlPct,
                                trades: stats.totalTrades,
                                winRate: stats.winRate
                            });
                        } catch (e) {
                            // Skip failed configs
                        }
                    }
                }
            }
        }
    }

    // Sort by PnL
    results.sort((a, b) => b.pnl - a.pnl);

    console.log(`Tested ${tested} combinations\n`);
    console.log('🏆 TOP 5 PROFITABLE SETTINGS:\n');
    console.log('MinDur | MaxDur | TP1% | Lev | Cap% | PnL$ | PnL% | Trades | WinRate');
    console.log('-------+--------+------+-----+------+------+------+--------+--------');

    let profitableCount = 0;
    for (let i = 0; i < Math.min(5, results.length); i++) {
        const r = results[i];
        if (r.pnl <= 0) break;
        profitableCount++;
        console.log(
            `${String(r.minDur).padStart(6)} | ${String(r.maxDur).padStart(6)} | ${String(r.tp1Pct).padStart(4)} | ${String(r.leverage).padStart(3)} | ${String(r.capitalPct).padStart(4)} | ${r.pnl.toFixed(0).padStart(5)} | ${r.pnlPct.toFixed(1).padStart(5)}% | ${String(r.trades).padStart(6)} | ${r.winRate.toFixed(0)}%`
        );
    }

    if (profitableCount > 0) {
        return {
            interval: intervalName,
            best: results[0]
        };
    } else {
        console.log('❌ No profitable settings found for this timeframe');
        return null;
    }
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  ACCURATE OPTIMIZER - Using Real App Logic (WITH FEES)  ║');
    console.log('╚══════════════════════════════════════════════════════════╝');

    const symbol = 'SUIUSDT';
    const timeframes = [
        ['1m', '1 Minute'],
        ['5m', '5 Minutes'],
        ['15m', '15 Minutes'],
        ['1h', '1 Hour'],
        ['4h', '4 Hours']
    ];

    const bestResults = [];

    for (const [interval, name] of timeframes) {
        const result = await optimizeTimeframe(symbol, interval, name);
        if (result) bestResults.push(result);
    }

    console.log('\n\n' + '═'.repeat(60));
    console.log('📊 SUMMARY - BEST SETTINGS PER TIMEFRAME');
    console.log('═'.repeat(60));

    for (const r of bestResults) {
        console.log(`\n✅ ${r.interval}:`);
        console.log(`   Range: ${r.best.minDur}-${r.best.maxDur} bars`);
        console.log(`   TP1%: ${r.best.tp1Pct}, Lev: ${r.best.leverage}x, Cap: ${r.best.capitalPct}%`);
        console.log(`   Expected: $${r.best.pnl.toFixed(2)} (${r.best.pnlPct.toFixed(1)}%) | WR: ${r.best.winRate.toFixed(0)}%`);
    }

    if (bestResults.length === 0) {
        console.log('\n❌ No profitable settings found for any timeframe with current strategy');
    }
}

main().catch(console.error);
