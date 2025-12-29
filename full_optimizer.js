/**
 * FULL OPTIMIZER - Embeds all necessary code
 * Tests all timeframes with FEES enabled
 */

const https = require('https');
const fs = require('fs');

// Read and eval the class files
const detectorCode = fs.readFileSync('./cycle_detector.js', 'utf8');
const botCode = fs.readFileSync('./cycle_bot.js', 'utf8');

// Execute in global scope
eval(detectorCode);
eval(botCode);

// Fetch candles
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

async function optimizeTimeframe(symbol, interval, name) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🔍 ${name} (${symbol})`);
    console.log(`${'='.repeat(50)}`);

    const candles = await fetchCandles(symbol, interval, 1000);
    console.log(`📊 ${candles.length} candles loaded`);

    const results = [];

    // Parameters to test
    const minDurs = [10, 12, 18, 24, 30];
    const maxDurs = [30, 36, 44, 52, 60];
    const tp1Pcts = [20, 30, 40, 50];
    const leverages = [10, 20];
    const capitalPcts = [20, 30];

    for (const minDur of minDurs) {
        for (const maxDur of maxDurs) {
            if (maxDur <= minDur) continue;
            for (const tp1Pct of tp1Pcts) {
                for (const leverage of leverages) {
                    for (const capitalPct of capitalPcts) {

                        const detector = new CycleDetector();
                        const bot = new CycleTradingBot();

                        bot.updateConfig({
                            startingBalance: 1000,
                            leverage: leverage,
                            capitalPercentage: capitalPct,
                            feesEnabled: true,
                            tp1AvgPercent: tp1Pct,
                            tp1CloseFraction: 60,
                            tp2AccountPercent: 1,
                            threeBarConfirmation: true,
                            closeOnOpposite: false
                        });

                        try {
                            bot.simulateLiveTrading(candles, detector, [], false, minDur, maxDur, true);

                            const pnl = bot.currentBalance - 1000;
                            const stats = bot.getStats();

                            if (stats.totalTrades > 0) {
                                results.push({
                                    minDur, maxDur, tp1Pct, leverage, capitalPct,
                                    pnl,
                                    pnlPct: (pnl / 1000) * 100,
                                    trades: stats.totalTrades,
                                    winRate: stats.winRate
                                });
                            }
                        } catch (e) {
                            // Skip
                        }
                    }
                }
            }
        }
    }

    results.sort((a, b) => b.pnl - a.pnl);

    console.log('\n🏆 TOP 3:');
    console.log('Min | Max | TP1% | Lev | Cap% |   PnL$ |  PnL% | Trades | WR%');

    let count = 0;
    for (const r of results) {
        if (r.pnl <= 0) break;
        if (count >= 3) break;
        console.log(
            `${r.minDur.toString().padStart(3)} | ${r.maxDur.toString().padStart(3)} | ${r.tp1Pct.toString().padStart(4)} | ${r.leverage.toString().padStart(3)} | ${r.capitalPct.toString().padStart(4)} | ${r.pnl.toFixed(0).padStart(6)} | ${r.pnlPct.toFixed(1).padStart(5)}% | ${r.trades.toString().padStart(6)} | ${r.winRate.toFixed(0)}%`
        );
        count++;
    }

    if (count === 0) {
        console.log('❌ No profitable settings');
        return null;
    }

    return { name, best: results[0] };
}

async function main() {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║  FULL OPTIMIZER - Real App Logic - FEES ENABLED  ║');
    console.log('╚═══════════════════════════════════════════════════╝');

    const symbol = 'SUIUSDT';
    const timeframes = [
        ['1m', '1 Minute'],
        ['5m', '5 Minutes'],
        ['15m', '15 Minutes'],
        ['1h', '1 Hour']
    ];

    const profitable = [];

    for (const [interval, name] of timeframes) {
        const result = await optimizeTimeframe(symbol, interval, name);
        if (result) profitable.push(result);
    }

    console.log('\n\n' + '═'.repeat(50));
    console.log('📊 FINAL SUMMARY');
    console.log('═'.repeat(50));

    for (const r of profitable) {
        console.log(`\n✅ ${r.name}: Range ${r.best.minDur}-${r.best.maxDur}, TP1=${r.best.tp1Pct}%, Lev=${r.best.leverage}x, Cap=${r.best.capitalPct}%`);
        console.log(`   PnL: $${r.best.pnl.toFixed(0)} (${r.best.pnlPct.toFixed(1)}%) | ${r.best.trades} trades | WR ${r.best.winRate.toFixed(0)}%`);
    }

    if (profitable.length === 0) {
        console.log('\n❌ No profitable configuration found for any timeframe');
    }
}

main().catch(console.error);
