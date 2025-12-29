/**
 * Cycle Trading Bot - CORRECTED EXIT STRATEGY
 * 
 * LONG RULES (from Index cycles):
 * 1. SL: Close if candle closes BELOW the local min of the index cycle
 * 2. TP1: At 50% of avg pump (last 10 index cycles) → close 60%, move SL to BE
 * 3. TP2: At 1% account profit → close remaining 40%
 * 
 * SHORT RULES (from Inverse cycles):
 * 1. SL: Close if candle closes ABOVE the local max of the inverse cycle
 * 2. TP1: At 50% of avg drop (last 10 inverse cycles) → close 60%, move SL to BE
 * 3. TP2: At 1% account profit → close remaining 40%
 */
class CycleTradingBot {
    constructor() {
        // Configuration
        this.startingBalance = 1000;
        this.leverage = 20;
        this.capitalPercentage = 30;
        this.feesEnabled = true;
        this.takerFeePercent = 0.02;

        // Exit Strategy Config
        this.tp1AvgPercent = 30;     // TP1 at 30% of avg cycle move (optimized)
        this.tp1CloseFraction = 0.6; // Close 60% at TP1
        this.tp2AvgPercent = 150;   // TP2 at 150% of avg cycle move

        // Entry Confirmation
        this.threeBarConfirmation = true; // Require 3 bars confirmation before entry
        this.closeOnOpposite = false; // Close on opposite cycle detection
        this.maTrendFilter = false; // Use MA trend filter for directional bias
        this.maPeriod = 50; // MA period for trend detection

        // Max Loss Stop
        this.maxLossEnabled = false; // Enable max loss stop rule
        this.maxLossPercent = 5; // Close trade if loss reaches 5% of account

        // State
        this.currentBalance = this.startingBalance;
        this.trades = [];
        this.openPosition = null;
        this.equityCurve = [];

        // Cycle averages (last 10)
        this.avgIndexPump = 0;
        this.avgInverseDrop = 0;

        // Stats
        this.totalPnL = 0;
        this.totalFees = 0;
        this.winCount = 0;
        this.lossCount = 0;
        this.tradeIdCounter = 1;
    }

    updateConfig(config) {
        if (config.startingBalance !== undefined) {
            this.startingBalance = parseFloat(config.startingBalance);
            if (this.trades.length === 0) {
                this.currentBalance = this.startingBalance;
            }
        }
        if (config.leverage !== undefined) {
            this.leverage = parseFloat(config.leverage);
        }
        if (config.capitalPercentage !== undefined) {
            this.capitalPercentage = parseFloat(config.capitalPercentage);
        }
        if (config.feesEnabled !== undefined) {
            this.feesEnabled = config.feesEnabled;
        }
        // Exit strategy config
        if (config.tp1AvgPercent !== undefined) {
            this.tp1AvgPercent = parseFloat(config.tp1AvgPercent);
        }
        if (config.tp1CloseFraction !== undefined) {
            this.tp1CloseFraction = parseFloat(config.tp1CloseFraction) / 100; // Convert % to fraction
        }
        if (config.tp2AvgPercent !== undefined) {
            this.tp2AvgPercent = parseFloat(config.tp2AvgPercent);
        }
        // Entry confirmation
        if (config.threeBarConfirmation !== undefined) {
            this.threeBarConfirmation = config.threeBarConfirmation;
        }
        if (config.closeOnOpposite !== undefined) {
            this.closeOnOpposite = config.closeOnOpposite;
        }
        if (config.maTrendFilter !== undefined) {
            this.maTrendFilter = config.maTrendFilter;
        }
        if (config.maxLossEnabled !== undefined) {
            this.maxLossEnabled = config.maxLossEnabled;
        }
        if (config.maxLossPercent !== undefined) {
            this.maxLossPercent = parseFloat(config.maxLossPercent);
        }
    }

    // Calculate Exponential Moving Average
    getEMA(candles, period, endIndex) {
        if (endIndex < period - 1) return null;

        const multiplier = 2 / (period + 1);

        // Calculate initial SMA for first EMA value
        let sum = 0;
        for (let i = endIndex - period + 1; i <= endIndex - period + period; i++) {
            if (i < 0) return null;
            sum += candles[i].close;
        }
        let ema = sum / period;

        // Calculate EMA from period start to endIndex
        const startIdx = endIndex - period + 1;
        for (let i = startIdx; i <= endIndex; i++) {
            ema = (candles[i].close - ema) * multiplier + ema;
        }

        return ema;
    }

    // Get trend direction based on dual EMA crossover (EMA 21 vs EMA 80)
    getTrend(candles, index) {
        const emaFast = this.getEMA(candles, 21, index);  // Fast EMA (21)
        const emaSlow = this.getEMA(candles, 80, index);  // Slow EMA (80)

        if (!emaFast || !emaSlow) return 'neutral';

        // Bullish when fast EMA > slow EMA, Bearish when fast < slow
        return emaFast > emaSlow ? 'bullish' : 'bearish';
    }

    reset() {
        this.currentBalance = this.startingBalance;
        this.trades = [];
        this.openPosition = null;
        this.equityCurve = [];
        this.avgIndexPump = 0;
        this.avgInverseDrop = 0;
        this.totalPnL = 0;
        this.totalFees = 0;
        this.winCount = 0;
        this.lossCount = 0;
        this.tradeIdCounter = 1;
    }

    /**
     * Calculate average pump of LAST 10 index cycles (for LONG TP1)
     */
    calculateAvgIndexPump(candles, indexCycles) {
        const last10 = indexCycles.slice(-10);
        if (last10.length === 0) return 0;

        let total = 0;
        last10.forEach(cycle => {
            const minPrice = candles[cycle.startIndex].low;  // Valley
            const maxPrice = candles[cycle.endIndex].high;   // Peak
            total += ((maxPrice - minPrice) / minPrice) * 100;
        });
        return total / last10.length;
    }

    /**
     * Calculate average drop of LAST 10 inverse cycles (for SHORT TP1)
     */
    calculateAvgInverseDrop(candles, inverseCycles) {
        const last10 = inverseCycles.slice(-10);
        if (last10.length === 0) return 0;

        let total = 0;
        last10.forEach(cycle => {
            const maxPrice = candles[cycle.startIndex].high; // Peak
            const minPrice = candles[cycle.endIndex].low;    // Valley
            total += ((maxPrice - minPrice) / maxPrice) * 100;
        });
        return total / last10.length;
    }

    /**
     * SIMULATE LIVE TRADING (Honest Mode)
     * Runs cycle detection on every candle update to mimic real-time behavior.
     * Removes lookahead bias.
     */
    simulateLiveTrading(candles, detector, momentumValues = [], useMomentum = false, minDur = 24, maxDur = 44, priorityMin = true) {
        this.reset();

        // We need to track which cycles we've already acted on to avoid double counting
        const processedCycles = new Set();

        // Track the END of the last cycle we traded - only allow trades from cycles that START AFTER this
        let lastTradedLongEnd = -1;
        let lastTradedShortEnd = -1;

        // Loop through history as if receiving new candles
        // Start from maxDur to give enough data for first detection
        // Optimization: We can't really optimize much if detector is stateless, 
        // but modern JS is fast enough for 2000 candles.

        let pendingSignal = null;
        let pendingConfirmBars = 0;

        for (let i = maxDur; i < candles.length; i++) {
            // 1. Current "Live" Data Slice
            const liveCandles = candles.slice(0, i + 1); // Candles up to index i
            const liveMomentum = momentumValues.slice(0, i + 1);

            // 2. Run Detector on this slice
            // Note: This matches main.js detection call but on growing dataset
            const idxCycles = detector.detectCycles(liveCandles, useMomentum, liveMomentum, true, minDur, maxDur, priorityMin);
            const invCycles = detector.detectCycles(liveCandles, useMomentum, liveMomentum, false, minDur, maxDur, priorityMin);

            const currentCandle = candles[i];

            // 3. Update Moving Averages for TP logic (using all detected cycles up to now)
            this.avgIndexPump = this.calculateAvgIndexPump(liveCandles, idxCycles);
            this.avgInverseDrop = this.calculateAvgInverseDrop(liveCandles, invCycles);

            // 4. Check for NEWLY COMPLETED Cycles
            // A cycle ends at 'endIndex'. 
            // If we are at 'i', and a cycle has endIndex == i (or i-1 depending on lag), we act.
            // Actually, in live detection, a cycle 'appears' in the list when it confirms.
            // We check the LAST cycle in the list.

            // Check Index Cycles (LONG Signals)
            if (idxCycles.length > 0) {
                const lastCycle = idxCycles[idxCycles.length - 1];
                const cycleId = `idx-${lastCycle.startIndex}`;

                // If this cycle is new (we haven't processed it) AND it ended recently
                // Only trigger if we are "just seeing it" for the first time? 
                // Or if it ended "recently" relative to 'i'?
                // We trust the detector: if it includes the cycle, it's valid NOW.
                // But we only want to enter ONCE.
                if (!processedCycles.has(cycleId)) {
                    // Check if it's actually an "end" event. 
                    // The detector might detect a cycle that ended 5 bars ago.
                    // If so, we are 5 bars late, but that's reality.

                    processedCycles.add(cycleId);

                    // Signal: LONG
                    // Only trade if this cycle STARTS AFTER the previous traded cycle ENDED
                    if (!this.openPosition && !pendingSignal && lastCycle.startIndex > lastTradedLongEnd) {
                        const trend = this.getTrend(liveCandles, i);
                        // Counter-trend = LONG in bearish market (when MA filter is enabled)
                        const isCounterTrend = this.maTrendFilter && trend === 'bearish';

                        const slPrice = liveCandles[lastCycle.startIndex].low;
                        lastTradedLongEnd = lastCycle.endIndex;

                        if (this.threeBarConfirmation) {
                            pendingSignal = { type: 'LONG', cycle: lastCycle, slPrice, detectionIndex: i, counterTrend: isCounterTrend };
                            pendingConfirmBars = 0;
                        } else {
                            this.openTrade('LONG', currentCandle.close, i, slPrice, isCounterTrend, lastCycle);
                            this.equityCurve.push({ index: i, balance: this.currentBalance });
                        }
                    }
                }
            }

            // Check Inverse Cycles (SHORT Signals)
            if (invCycles.length > 0) {
                const lastCycle = invCycles[invCycles.length - 1];
                const cycleId = `inv-${lastCycle.startIndex}`;

                if (!processedCycles.has(cycleId)) {
                    processedCycles.add(cycleId);

                    // Signal: SHORT
                    // Only trade if this cycle STARTS AFTER the previous traded cycle ENDED
                    if (!this.openPosition && !pendingSignal && lastCycle.startIndex > lastTradedShortEnd) {
                        const trend = this.getTrend(liveCandles, i);
                        // Counter-trend = SHORT in bullish market (when MA filter is enabled)
                        const isCounterTrend = this.maTrendFilter && trend === 'bullish';

                        const slPrice = liveCandles[lastCycle.startIndex].high;
                        lastTradedShortEnd = lastCycle.endIndex;

                        if (this.threeBarConfirmation) {
                            pendingSignal = { type: 'SHORT', cycle: lastCycle, slPrice, detectionIndex: i, counterTrend: isCounterTrend };
                            pendingConfirmBars = 0;
                        } else {
                            this.openTrade('SHORT', currentCandle.close, i, slPrice, isCounterTrend, lastCycle);
                            this.equityCurve.push({ index: i, balance: this.currentBalance });
                        }
                    }
                }
            }

            // 5. Manage Pending Confirmations
            if (pendingSignal && !this.openPosition) {
                // Check if price moves in favor
                let barConfirmed = false;
                if (pendingSignal.type === 'LONG') {
                    // Price should go UP relative to... ? 
                    // User said: "if next bars behave in correct direction"
                    // Confirm if close > previous close? Or > cycle low?
                    // Previous logic: close > cycle start low. 
                    // Let's stick to simple momentum: Green candle?
                    // Or reuse existing logic: close > cycle start low (which is low risk).
                    const cycleLow = candles[pendingSignal.cycle.startIndex].low;
                    barConfirmed = currentCandle.close > cycleLow;
                    // Tighter check: close > open (Green)
                    // barConfirmed = currentCandle.close > currentCandle.open; 
                } else {
                    const cycleHigh = candles[pendingSignal.cycle.startIndex].high;
                    barConfirmed = currentCandle.close < cycleHigh;
                }

                if (barConfirmed) {
                    pendingConfirmBars++;
                    // USER REQUEST: "lookahead of 2 bars" -> Wait 2 bars.
                    // If current setting is 3, valid. If we want 2, we change config.
                    // We'll use 'this.confirmationOneBar' or numeric config later.
                    // For now using existing boolean 'threeBarConfirmation' meant 3 in old code. 
                    // Let's hardcode 2 for optimization request? Or keep logic flexible.
                    // Old logic used 'pendingConfirmBars >= 3'. 
                    // I will change it to 2 as requested.
                    if (pendingConfirmBars >= 2) {
                        this.openTrade(pendingSignal.type, currentCandle.close, i, pendingSignal.slPrice, pendingSignal.counterTrend, pendingSignal.cycle);
                        this.equityCurve.push({ index: i, balance: this.currentBalance });
                        pendingSignal = null;
                        pendingConfirmBars = 0;
                    }
                } else {
                    // Fail? Or just wait? 
                    // Usually reset if moves against significantly?
                    // For now keep trying until max wait? Or reset immediately?
                    // Old logic: "else pendingSignal = null". A single bad bar kills the signal. Strictly smart.
                    pendingSignal = null;
                    pendingConfirmBars = 0;
                }
            }

            // 6. Manage Open Positions (Exits)
            if (this.openPosition) {
                // Check TP/SL
                const exitTriggered = this.checkAdvancedExit(currentCandle, i);

                // Check Cycle End Exits
                // If a cycle of SAME type is newly detected (completed), we exit.
                // Note: We tracked "processedCycles".
                // We need to see if the LATEST cycle matches our position type.
                // AND if it wasn't the one that opened it?
                // Actually, standard logic: Long exits on Index Cycle End. Short on Inverse.

                // If we are LONG, and we see an Index Cycle End (which is what we are riding),
                // wait, Long enters on *Index Cycle*, exits on *Index Cycle*?
                // Re-read cycle_bot.js lines 166:
                // "SHORT (from inverse cycles) exits when inverse cycle ends"
                // "LONG (from index cycles) exits when index cycle ends"
                // Yes.

                if (!exitTriggered && this.openPosition) {
                    // 1. OPTIONAL: Check "Close on Opposite Cycle"
                    if (this.closeOnOpposite) {
                        if (this.openPosition.type === 'LONG') {
                            // Long (Index Cycle) -> Close if Inverse Cycle detected
                            if (invCycles.length > 0) {
                                const last = invCycles[invCycles.length - 1];
                                if (last.endIndex > this.openPosition.entryIndex) {
                                    this.closePosition(currentCandle.close, i, 'opposite_cycle');
                                    this.equityCurve.push({ index: i, balance: this.currentBalance });
                                    continue; // Skip standard check
                                }
                            }
                        } else {
                            // Short (Inverse Cycle) -> Close if Index Cycle detected
                            if (idxCycles.length > 0) {
                                const last = idxCycles[idxCycles.length - 1];
                                if (last.endIndex > this.openPosition.entryIndex) {
                                    this.closePosition(currentCandle.close, i, 'opposite_cycle');
                                    this.equityCurve.push({ index: i, balance: this.currentBalance });
                                    continue;
                                }
                            }
                        }
                    }

                    // 2. STANDARD: Check if a NEW cycle of the active type just finished
                    if (this.openPosition.type === 'LONG') {
                        if (idxCycles.length > 0) {
                            const last = idxCycles[idxCycles.length - 1];
                            // If this cycle is NEW (just detected at i) and it comes AFTER our entry
                            if (last.endIndex > this.openPosition.entryIndex) {
                                // Close!
                                this.closePosition(currentCandle.close, i, 'cycle_end');
                            }
                        }
                    } else {
                        if (invCycles.length > 0) {
                            const last = invCycles[invCycles.length - 1];
                            if (last.endIndex > this.openPosition.entryIndex) {
                                this.closePosition(currentCandle.close, i, 'cycle_end');
                            }
                        }
                    }
                }

                // Record Equity
                // If still open or just closed
                this.equityCurve.push({ index: i, balance: this.currentBalance });
            }
        }
    }

    /**
     * Main processing (Old Lookahead Version - Kept for Reference or fallback)
     */
    processAllCandles(candles, indexCycles, inverseCycles, momentumValues = []) {
        this.reset();

        // Calculate averages from last 10 cycles
        this.avgIndexPump = this.calculateAvgIndexPump(candles, indexCycles);
        this.avgInverseDrop = this.calculateAvgInverseDrop(candles, inverseCycles);

        // Build entry signals - only at +1 (immediate) for now
        const signals = new Map();

        // Index Cycles (inverted type) → LONG
        indexCycles.forEach(cycle => {
            const firstClose = cycle.firstPotentialEnd !== undefined ? cycle.firstPotentialEnd : cycle.endIndex;
            const entryIdx = firstClose + 1;
            if (entryIdx < candles.length) {
                if (!signals.has(entryIdx)) signals.set(entryIdx, []);
                signals.get(entryIdx).push({
                    type: 'LONG',
                    cycle,
                    slPrice: candles[cycle.startIndex].low
                });
            }
        });

        // Inverse Cycles (normal type) → SHORT
        inverseCycles.forEach(cycle => {
            const firstClose = cycle.firstPotentialEnd !== undefined ? cycle.firstPotentialEnd : cycle.endIndex;
            const entryIdx = firstClose + 1;
            if (entryIdx < candles.length) {
                if (!signals.has(entryIdx)) signals.set(entryIdx, []);
                signals.get(entryIdx).push({
                    type: 'SHORT',
                    cycle,
                    slPrice: candles[cycle.startIndex].high
                });
            }
        });

        // Build exit signals - close when the SAME cycle type that generated the trade ends
        // SHORT (from inverse cycles) exits when inverse cycle ends
        // LONG (from index cycles) exits when index cycle ends
        const exitSignals = new Map();

        inverseCycles.forEach(cycle => {
            const exitIdx = cycle.endIndex + 1;
            if (exitIdx < candles.length) {
                if (!exitSignals.has(exitIdx)) exitSignals.set(exitIdx, []);
                exitSignals.get(exitIdx).push({ exitType: 'SHORT', cycle }); // SHORT exits on inverse cycle end
            }
        });

        indexCycles.forEach(cycle => {
            const exitIdx = cycle.endIndex + 1;
            if (exitIdx < candles.length) {
                if (!exitSignals.has(exitIdx)) exitSignals.set(exitIdx, []);
                exitSignals.get(exitIdx).push({ exitType: 'LONG', cycle }); // LONG exits on index cycle end
            }
        });

        // Build maps of when opposite cycles START (for Lag Open calculation)
        // For LONG trades: find when the next INVERSE cycle starts (confirms index cycle ended)
        // For SHORT trades: find when the next INDEX cycle starts (confirms inverse cycle ended)
        // Store as sorted arrays for easier next-cycle lookup
        const inverseCycleStarts = inverseCycles.map(c => c.startIndex).sort((a, b) => a - b);
        const indexCycleStarts = indexCycles.map(c => c.startIndex).sort((a, b) => a - b);

        // Helper to find the first cycle start AFTER a given index
        const findNextCycleStart = (starts, afterIndex) => {
            for (const start of starts) {
                if (start > afterIndex) return start;
            }
            return null;
        };

        // Pending signals waiting for 3-bar confirmation
        let pendingSignal = null;
        let pendingConfirmBars = 0;

        // Process candles
        for (let i = 0; i < candles.length; i++) {
            const candle = candles[i];

            // Check exits
            if (this.openPosition) {
                // Track when the opposite cycle starts (confirms entry cycle really ended)
                // For LONG: opposite cycle is INVERSE (normal)
                // For SHORT: opposite cycle is INDEX (inverted)
                if (this.openPosition.realCycleEndIndex === undefined) {
                    let nextOppositeCycleStart = null;
                    if (this.openPosition.type === 'LONG') {
                        nextOppositeCycleStart = findNextCycleStart(inverseCycleStarts, this.openPosition.entryIndex);
                    } else if (this.openPosition.type === 'SHORT') {
                        nextOppositeCycleStart = findNextCycleStart(indexCycleStarts, this.openPosition.entryIndex);
                    }
                    if (nextOppositeCycleStart !== null) {
                        this.openPosition.realCycleEndIndex = nextOppositeCycleStart;
                        // Backfill this info to any partial trades already closed for this position
                        // This ensures TP1, BE etc. get the correct Lag Open value even if closed earlier
                        for (let t of this.trades) {
                            if (t.tradeId === this.openPosition.id) {
                                t.realCycleEndIndex = nextOppositeCycleStart;
                            }
                        }
                    }
                }

                // Check TP/SL exits FIRST (priority over cycle end)
                const exitTriggered = this.checkAdvancedExit(candle, i);
                if (exitTriggered && !this.openPosition) {
                    this.equityCurve.push({ index: i, balance: this.currentBalance });
                }

                // Then check cycle-based exit as FALLBACK (if TP not reached yet)
                if (this.openPosition && exitSignals.has(i)) {
                    const exits = exitSignals.get(i);
                    for (const exit of exits) {
                        if (this.openPosition.type === exit.exitType) {
                            // Cycle ended without hitting TP - close at market
                            this.closePosition(candle.close, i, 'cycle_end');
                            this.equityCurve.push({ index: i, balance: this.currentBalance });
                            break;
                        }
                    }
                }
            }

            // Handle pending 3-bar confirmation
            if (pendingSignal && this.threeBarConfirmation && !this.openPosition) {
                const cycleStartIdx = pendingSignal.cycle.startIndex;
                let barConfirmed = false;

                if (pendingSignal.type === 'LONG') {
                    barConfirmed = candle.close > candles[cycleStartIdx].low;
                } else {
                    barConfirmed = candle.close < candles[cycleStartIdx].high;
                }

                if (barConfirmed) {
                    pendingConfirmBars++;
                    // User Request: Wait only 1 bar for confirmation, not 3 (or 2)
                    if (pendingConfirmBars >= 1) {
                        // Confirmation passed - enter trade
                        this.openTrade(pendingSignal.type, candle.open, i, pendingSignal.slPrice, pendingSignal.counterTrend || false, pendingSignal.cycle);
                        this.equityCurve.push({ index: i, balance: this.currentBalance });
                        pendingSignal = null;
                        pendingConfirmBars = 0;
                    }
                } else {
                    // Failed confirmation - cancel signal
                    pendingSignal = null;
                    pendingConfirmBars = 0;
                }
            }

            // Check new entries
            if (signals.has(i) && !this.openPosition && !pendingSignal) {
                const sigs = signals.get(i);
                for (const sig of sigs) {
                    // Close opposite position
                    if (this.openPosition && this.openPosition.type !== sig.type) {
                        this.closePosition(candle.open, i, 'opposite_signal');
                        this.equityCurve.push({ index: i, balance: this.currentBalance });
                    }

                    if (!this.openPosition) {
                        if (this.threeBarConfirmation) {
                            // Start waiting for 3-bar confirmation
                            pendingSignal = sig;
                            pendingConfirmBars = 0;
                        } else {
                            // No confirmation needed - enter immediately
                            this.openTrade(sig.type, candle.open, i, sig.slPrice, false, sig.cycle);
                            this.equityCurve.push({ index: i, balance: this.currentBalance });
                        }
                    }
                    break;
                }
            }
        }

        // Don't close remaining position - keep it open for display
        // (was: close with 'end_of_data' but this prevents real-time trade display)
        // if (this.openPosition && candles.length > 0) {
        //     this.closePosition(candles[candles.length - 1].close, candles.length - 1, 'end_of_data');
        // }
    }

    openTrade(type, price, index, slPrice, counterTrend = false, cycle = null) {
        // Counter-trend trades use 50% of normal capital
        let capPercent = this.capitalPercentage;
        if (counterTrend) {
            capPercent = capPercent * 0.5;
        }

        const capitalUsed = this.currentBalance * (capPercent / 100);
        const positionSize = (capitalUsed * this.leverage) / price;

        // Extract Cycle Metrics
        let cycleMetrics = {};
        if (cycle) {
            // Use the amplitude directly from the cycle detector
            // For inverted (Index) cycles: amplitude is (maxHigh - startLow)
            // For normal (Inverse) cycles: amplitude is (startHigh - minLow) 
            // Convert to percentage: (amplitude / startPrice) * 100
            let amplitudePercent = 0;
            if (cycle.amplitude && cycle.startPrice) {
                amplitudePercent = (cycle.amplitude / cycle.startPrice) * 100;
            }

            // firstPotentialEnd is when the bot FIRST thought the cycle closed (entry trigger)
            // endIndex is when the cycle REALLY closed
            // Lag Open = endIndex - firstPotentialEnd (how many bars early entry was)
            const firstClose = cycle.firstPotentialEnd !== undefined ? cycle.firstPotentialEnd : cycle.endIndex;

            cycleMetrics = {
                cycleAmplitude: amplitudePercent,
                cycleEndIndex: cycle.endIndex,
                cycleFirstCloseIndex: firstClose,  // When bot first detected cycle close
                cycleDuration: cycle.duration
            };
        }

        this.openPosition = {
            id: this.tradeIdCounter++,
            type,
            entryPrice: price,
            entryIndex: index,
            positionSize,
            capitalUsed,
            slPrice: slPrice,
            partialClosed: false,
            breakEvenActive: false,
            initialCapital: capitalUsed,
            initialSize: positionSize,
            counterTrend,
            ...cycleMetrics
        };
    }

    checkAdvancedExit(candle, index) {
        if (!this.openPosition) return false;
        const pos = this.openPosition;

        // === LONG EXIT ===
        if (pos.type === 'LONG') {
            // 1. SL: Candle closes below the local min of the index cycle
            if (candle.close < pos.slPrice && !pos.breakEvenActive) {
                this.closePosition(candle.close, index, 'sl_cycle_min');
                return true;
            }

            // Max Loss Check (2% of account) - HARD STOP (Intra-bar)
            if (this.maxLossEnabled) {
                // Determine price level that causes max loss
                // MaxLoss = PnL
                // -MaxLimit = ((StopPrice - Entry) / Entry) * Capital * Lev
                // -MaxLimit / (Capital * Lev) = (StopPrice - Entry) / Entry
                // StopPrice = Entry * (1 - (MaxLimitAbs / (Capital * Lev)))

                const maxLossAbs = this.startingBalance * (this.maxLossPercent / 100);
                const stopPrice = pos.entryPrice * (1 - (maxLossAbs / (pos.capitalUsed * this.leverage)));

                // If LOW touched or broke through StopPrice -> trigger
                if (candle.low <= stopPrice) {
                    this.closePosition(stopPrice, index, 'max_loss_hard_stop');
                    return true;
                }
            }

            // Break-even SL check
            // Trigger if LOW touches Entry (or lower)
            if (pos.breakEvenActive && candle.low <= pos.entryPrice) {
                // Execute exactly at Entry Price (Limit/Stop behavior)
                this.closePosition(pos.entryPrice, index, 'break_even');
                return true;
            }

            // 2. TP1: Immediate Execution at High
            // TP1 Price = Entry * (1 + (TargetPump% / 100))
            const tp1PumpPercent = this.avgIndexPump * (this.tp1AvgPercent / 100);
            const tp1Price = pos.entryPrice * (1 + (tp1PumpPercent / 100));

            if (!pos.partialClosed && candle.high >= tp1Price && tp1PumpPercent > 0) {
                // Execute exactly at TP1 price
                this.closePartial(tp1Price, index, this.tp1CloseFraction, 'tp1_partial');
                pos.partialClosed = true;
                pos.breakEvenActive = true;
                return true;
            }

            // 3. TP2: Immediate Execution at High
            if (pos.partialClosed) {
                const tp2PumpPercent = this.avgIndexPump * (this.tp2AvgPercent / 100);
                const tp2Price = pos.entryPrice * (1 + (tp2PumpPercent / 100));

                if (candle.high >= tp2Price && tp2PumpPercent > 0) {
                    // Execute exactly at TP2 price
                    this.closePosition(tp2Price, index, 'tp2_cycle_avg');
                    return true;
                }
            }
        }
        // === SHORT EXIT ===
        if (pos.type === 'SHORT') {
            // 1. SL: Candle closes above the local max of the inverse cycle
            if (candle.close > pos.slPrice && !pos.breakEvenActive) {
                this.closePosition(candle.close, index, 'sl_cycle_max');
                return true;
            }

            // Max Loss Check (2% of account) - HARD STOP (Intra-bar)
            if (this.maxLossEnabled) {
                const maxLossAbs = this.startingBalance * (this.maxLossPercent / 100);
                // StopPrice = Entry * (1 + (MaxLimitAbs / (Capital * Lev)))  For short, price goes UP to lose
                const stopPrice = pos.entryPrice * (1 + (maxLossAbs / (pos.capitalUsed * this.leverage)));

                // If HIGH touched or broke through StopPrice -> trigger
                if (candle.high >= stopPrice) {
                    this.closePosition(stopPrice, index, 'max_loss_hard_stop');
                    return true;
                }
            }

            // Break-even SL check
            // Trigger if HIGH touches Entry (or higher)
            if (pos.breakEvenActive && candle.high >= pos.entryPrice) {
                // Execute exactly at Entry Price (Limit/Stop behavior)
                this.closePosition(pos.entryPrice, index, 'break_even');
                return true;
            }

            // 2. TP1: Immediate Execution at Low
            // TP1 Price = Entry * (1 - (TargetDrop% / 100))
            const tp1DropPercent = this.avgInverseDrop * (this.tp1AvgPercent / 100);
            const tp1Price = pos.entryPrice * (1 - (tp1DropPercent / 100));

            if (!pos.partialClosed && candle.low <= tp1Price && tp1DropPercent > 0) {
                // Execute exactly at TP1 price
                this.closePartial(tp1Price, index, this.tp1CloseFraction, 'tp1_partial');
                pos.partialClosed = true;
                pos.breakEvenActive = true;
                return true;
            }

            // 3. TP2: Immediate Execution at Low
            if (pos.partialClosed) {
                const tp2DropPercent = this.avgInverseDrop * (this.tp2AvgPercent / 100);
                const tp2Price = pos.entryPrice * (1 - (tp2DropPercent / 100));

                if (candle.low <= tp2Price && tp2DropPercent > 0) {
                    // Execute exactly at TP2 price
                    this.closePosition(tp2Price, index, 'tp2_cycle_avg');
                    return true;
                }
            }
        }

        return false;
    }

    closePartial(exitPrice, index, fraction, reason) {
        if (!this.openPosition) return;
        const pos = this.openPosition;

        const closedCapital = pos.capitalUsed * fraction;
        const closedSize = pos.positionSize * fraction;

        let priceDiff = pos.type === 'LONG'
            ? exitPrice - pos.entryPrice
            : pos.entryPrice - exitPrice;

        let pnl = (priceDiff / pos.entryPrice) * closedCapital * this.leverage;

        let tradeFees = 0;
        if (this.feesEnabled) {
            tradeFees = closedCapital * this.leverage * (this.takerFeePercent / 100) * 2;
            pnl -= tradeFees;
            this.totalFees += tradeFees;
        }

        this.currentBalance += pnl;
        this.totalPnL += pnl;
        if (pnl > 0) this.winCount++; else this.lossCount++;

        this.trades.push({
            type: pos.type,
            entryPrice: pos.entryPrice,
            exitPrice,
            entryIndex: pos.entryIndex,
            exitIndex: index,
            pnl,
            fees: tradeFees,
            pnlPercent: (priceDiff / pos.entryPrice) * 100 * this.leverage,
            reason,
            balanceAfter: this.currentBalance,
            partial: true,
            fraction,
            tradeId: pos.id,
            cycleAmplitude: pos.cycleAmplitude,
            cycleEndIndex: pos.cycleEndIndex,
            cycleFirstCloseIndex: pos.cycleFirstCloseIndex,
            realCycleEndIndex: pos.realCycleEndIndex
        });

        pos.capitalUsed -= closedCapital;
        pos.positionSize -= closedSize;
    }

    closePosition(exitPrice, index, reason) {
        if (!this.openPosition) return;
        const pos = this.openPosition;

        let priceDiff = pos.type === 'LONG'
            ? exitPrice - pos.entryPrice
            : pos.entryPrice - exitPrice;

        let pnl = (priceDiff / pos.entryPrice) * pos.capitalUsed * this.leverage;

        let tradeFees = 0;
        if (this.feesEnabled) {
            tradeFees = pos.capitalUsed * this.leverage * (this.takerFeePercent / 100) * 2;
            pnl -= tradeFees;
            this.totalFees += tradeFees;
        }

        this.currentBalance += pnl;
        this.totalPnL += pnl;
        if (pnl > 0) this.winCount++; else this.lossCount++;

        this.trades.push({
            type: pos.type,
            entryPrice: pos.entryPrice,
            exitPrice,
            entryIndex: pos.entryIndex,
            exitIndex: index,
            pnl,
            fees: tradeFees,
            pnlPercent: (priceDiff / pos.entryPrice) * 100 * this.leverage,
            reason,
            balanceAfter: this.currentBalance,
            tradeId: pos.id,
            cycleAmplitude: pos.cycleAmplitude,
            cycleEndIndex: pos.cycleEndIndex,
            cycleFirstCloseIndex: pos.cycleFirstCloseIndex,
            realCycleEndIndex: pos.realCycleEndIndex
        });

        this.openPosition = null;
    }

    getStats() {
        const totalTrades = this.winCount + this.lossCount;
        return {
            currentBalance: this.currentBalance,
            totalPnL: this.totalPnL,
            pnlPercent: ((this.currentBalance - this.startingBalance) / this.startingBalance) * 100,
            totalTrades,
            wins: this.winCount,
            losses: this.lossCount,
            winRate: totalTrades > 0 ? (this.winCount / totalTrades) * 100 : 0,
            openPosition: this.openPosition,
            avgIndexPump: this.avgIndexPump,
            avgInverseDrop: this.avgInverseDrop
        };
    }

    getEquityCurve() { return this.equityCurve; }
    getTrades() { return this.trades; }
}
