class CycleDetector {
    constructor() {
        this.minDuration = 24;
        this.maxDuration = 44;
    }

    /**
     * Detects cycles in the provided candlestick data.
     * @param {Array} candles - Array of {open, high, low, close, volume}
     * @param {boolean} useMomentum - Whether to enforce momentum rules
     * @param {Array} momentumValues - Array of momentum values corresponding to candles
     * @param {boolean} invert - Whether to detect inverted cycles (Low -> High -> Low)
     * @param {number} minDuration - Minimum cycle duration (default 24)
     * @param {number} maxDuration - Maximum cycle duration (default 44)
     * @returns {Array} List of detected cycles
     */
    detectCycles(candles, useMomentum = false, momentumValues = [], invert = false, minDuration = 24, maxDuration = 44, priorityMinDuration = true, manualCycle = null) {
        let cycles = [];
        let i = 0;

        // Use passed duration or fallback to class defaults (though defaults are in params now)
        const minDur = minDuration || this.minDuration;
        const maxDur = maxDuration || this.maxDuration;

        // If Manual Cycle is provided, we split detection:
        // 1. Detect UP TO manual cycle start
        // 2. Insert Manual Cycle
        // 3. Detect FROM manual cycle end

        let limitIndex = candles.length;
        if (manualCycle) {
            limitIndex = manualCycle.startIndex;
        }

        // Phase 1: Detect up to limit
        while (i < limitIndex - minDur) {
            // Check for Start Condition at index i
            if (this.isStartCondition(candles, i, useMomentum, momentumValues, invert)) {
                // Look for End Condition
                // Important: Cycle must end at or before limitIndex if we want to enforce continuity?
                // For now, let's just run standard detection. If a cycle overshoots manual start, we might need to trim or discard.
                // Simplification: Allow standard detection, but stop loop if we pass limit.

                const cycle = this.findCycleEnd(candles, i, useMomentum, momentumValues, invert, minDur, maxDur, priorityMinDuration);

                if (cycle) {
                    // Check if this cycle overlaps significantly or goes past manual start?
                    // Let's just add it.
                    if (cycle.duration >= minDur) {
                        // If manual cycle exists, ensure we don't go past it
                        if (manualCycle && cycle.endIndex > manualCycle.startIndex) {
                            // This cycle conflicts with manual start.
                            // Option A: Discard it.
                            // Option B: Accept it and have overlap.
                            // Let's Discard to keep manual cycle as the "barrier".
                            i++;
                            continue;
                        }

                        cycles.push(cycle);

                        // The end of this cycle is the potential start of the next.
                        if (this.isStartCondition(candles, cycle.endIndex, useMomentum, momentumValues, invert)) {
                            i = cycle.endIndex;
                        } else {
                            i = cycle.endIndex + 1;
                        }
                    } else {
                        i++;
                    }
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }

        // Phase 2: Insert Manual Cycle
        if (manualCycle) {
            // We need to build the full cycle object for the manual points
            // manualCycle has {startIndex, endIndex, type?}
            // We need to find the min/max in between to make it a valid cycle object for rendering
            const fullManualCycle = this.buildManualCycle(candles, manualCycle.startIndex, manualCycle.endIndex, invert);
            cycles.push(fullManualCycle);

            // Phase 3: Detect FROM manual cycle end
            i = manualCycle.endIndex;

            // Resume detection loop from manual end
            while (i < candles.length - minDur) {
                // Same logic as above
                if (this.isStartCondition(candles, i, useMomentum, momentumValues, invert)) {
                    const cycle = this.findCycleEnd(candles, i, useMomentum, momentumValues, invert, minDur, maxDur, priorityMinDuration);

                    if (cycle) {
                        if (cycle.duration >= minDur) {
                            cycles.push(cycle);
                            if (this.isStartCondition(candles, cycle.endIndex, useMomentum, momentumValues, invert)) {
                                i = cycle.endIndex;
                            } else {
                                i = cycle.endIndex + 1;
                            }
                        } else {
                            i++;
                        }
                    } else {
                        i++;
                    }
                } else {
                    i++;
                }
            }
        }

        return cycles;
    }

    buildManualCycle(candles, startIndex, endIndex, invert) {
        // Find extremum between start and end
        let extremumIndex = -1;
        let extremumValue = invert ? -Infinity : Infinity; // Inverted needs Max (High), Normal needs Min (Low)

        // Wait, Inverted: Start(Low) -> Max(High) -> End(Low)
        // Normal: Start(High) -> Min(Low) -> End(High)

        if (invert) {
            // Find Max High
            let maxHigh = -Infinity;
            for (let k = startIndex + 1; k < endIndex; k++) {
                if (candles[k].high > maxHigh) {
                    maxHigh = candles[k].high;
                    extremumIndex = k;
                }
            }
            // Fallback if no intermediate bars (shouldn't happen with min duration check, but manual might be short)
            if (extremumIndex === -1) extremumIndex = Math.floor((startIndex + endIndex) / 2);

            return this.buildCycle(candles, startIndex, extremumIndex, endIndex, invert, endIndex);
        } else {
            // Find Min Low
            let minLow = Infinity;
            for (let k = startIndex + 1; k < endIndex; k++) {
                if (candles[k].low < minLow) {
                    minLow = candles[k].low;
                    extremumIndex = k;
                }
            }
            if (extremumIndex === -1) extremumIndex = Math.floor((startIndex + endIndex) / 2);

            return this.buildCycle(candles, startIndex, extremumIndex, endIndex, invert, endIndex);
        }
    }

    isStartCondition(candles, index, useMomentum, momentumValues, invert) {
        // Basic bounds check
        if (index >= candles.length - 1) return false;

        // Momentum Rule
        if (useMomentum) {
            if (!momentumValues || index >= momentumValues.length) return false;
            const mom = momentumValues[index];
            if (mom === undefined || isNaN(mom)) return false;

            if (invert) {
                // Inverted: Start must be in Red Phase (Momentum <= 0)
                if (mom > 0) return false;
            } else {
                // Normal: Start must be in Green Phase (Momentum >= 0)
                if (mom < 0) return false;
            }
        }

        if (invert) {
            // Inverted: Start is Local Min
            return this.checkLocalMin(candles, index);
        } else {
            // Normal: Start is Local Max
            return this.checkLocalMax(candles, index);
        }
    }



    checkLocalMax(candles, index) {
        if (index === 0) return candles[index].high > candles[index + 1].high;
        if (index === candles.length - 1) return candles[index].high > candles[index - 1].high;

        // Criterio semplice: massimo locale
        return candles[index].high > candles[index - 1].high &&
            candles[index].high > candles[index + 1].high;
    }

    checkLocalMin(candles, index) {
        if (index === 0) return candles[index].low < candles[index + 1].low;
        if (index === candles.length - 1) return candles[index].low < candles[index - 1].low;

        return candles[index].low < candles[index - 1].low &&
            candles[index].low < candles[index + 1].low;
    }

    findCycleEnd(candles, startIndex, useMomentum, momentumValues, invert, minDuration, maxDuration, priorityMinDuration = true) {
        // Cycle must end between startIndex + minDuration and startIndex + maxDuration
        const minEndIndex = startIndex + minDuration;
        const maxEndIndex = Math.min(startIndex + maxDuration, candles.length - 1);

        // Helper to check if a specific index is a valid end
        const isValidEnd = (j) => {
            // Momentum Rule
            if (useMomentum) {
                if (!momentumValues || j >= momentumValues.length) return false;
                const mom = momentumValues[j];
                if (mom === undefined || isNaN(mom)) return false;

                if (invert) {
                    if (mom > 0) return false;
                } else {
                    if (mom < 0) return false;
                }
            }

            if (invert) {
                // Inverted: End is Local Min
                if (!this.checkLocalMin(candles, j)) return false;

                // Inverted: Must have Local Max between Start and End
                let highestHigh = -Infinity;
                let highestIndex = -1;
                for (let k = startIndex + 1; k < j; k++) {
                    if (candles[k].high > highestHigh) {
                        highestHigh = candles[k].high;
                        highestIndex = k;
                    }
                }
                if (highestIndex !== -1) return { minIndex: highestIndex }; // minIndex here stores the intermediate peak

            } else {
                // Normal: End is Local Max
                if (!this.checkLocalMax(candles, j)) return false;

                // Normal: Must have Local Min between Start and End
                let lowestLow = Infinity;
                let lowestIndex = -1;
                for (let k = startIndex + 1; k < j; k++) {
                    if (candles[k].low < lowestLow) {
                        lowestLow = candles[k].low;
                        lowestIndex = k;
                    }
                }
                if (lowestIndex !== -1) return { minIndex: lowestIndex };
            }

            return false;
        };

        // Track first potential end
        let firstValidEnd = null;

        // 1. Priority: Check exactly at minDuration (minEndIndex) IF priority is enabled
        if (priorityMinDuration && minEndIndex <= maxEndIndex) {
            const checkMin = isValidEnd(minEndIndex);
            if (checkMin) {
                if (firstValidEnd === null) firstValidEnd = minEndIndex;
                // Per cicli normali, verifica che sia una candela verde
                if (!invert) {
                    const isGreen = candles[minEndIndex].close > candles[minEndIndex].open;
                    if (isGreen) {
                        return this.buildCycle(candles, startIndex, checkMin.minIndex, minEndIndex, invert, firstValidEnd);
                    }
                    // Se non è verde, continua la ricerca normale
                } else {
                    // Per cicli invertiti, usa la logica normale
                    return this.buildCycle(candles, startIndex, checkMin.minIndex, minEndIndex, invert, firstValidEnd);
                }
            }
        }

        // 2. Check remaining bars (minDuration + 1 to maxDuration) OR all bars if priority is disabled
        let bestCandidate = null;
        let bestExtremum = invert ? Infinity : -Infinity;

        // If priority is enabled, we already checked minEndIndex, so start from +1.
        // If priority is disabled, we haven't checked anything, so start from minEndIndex.
        const loopStart = priorityMinDuration ? minEndIndex + 1 : minEndIndex;

        for (let j = loopStart; j <= maxEndIndex; j++) {
            const check = isValidEnd(j);
            if (check) {
                if (firstValidEnd === null) firstValidEnd = j;
                // Found a valid end. Compare Extremum (High/Low) instead of Close.
                if (invert) {
                    // Inverted Cycle: End is a Local Min. We want the LOWEST Close (not low/wick).
                    if (candles[j].close < bestExtremum) {
                        bestExtremum = candles[j].close;
                        bestCandidate = { endIndex: j, minIndex: check.minIndex };
                    }
                } else {
                    // Normal Cycle: End is a Local Max
                    // REGOLA: Trova l'ultima candela verde PRIMA di questo massimo
                    // e usa il suo close come criterio di selezione

                    let lastGreenClose = -Infinity;

                    // Cerca indietro dalla posizione j fino allo start del ciclo
                    for (let k = j; k >= startIndex; k--) {
                        const isGreen = candles[k].close > candles[k].open;
                        if (isGreen) {
                            lastGreenClose = candles[k].close;
                            break;
                        }
                    }

                    // Confronta il close della candela verde, non il high del massimo
                    if (lastGreenClose > bestExtremum) {
                        bestExtremum = lastGreenClose;
                        bestCandidate = { endIndex: j, minIndex: check.minIndex };
                    }
                }
            }
        }

        if (bestCandidate) {
            return this.buildCycle(candles, startIndex, bestCandidate.minIndex, bestCandidate.endIndex, invert, firstValidEnd);
        }

        return null;
    }

    buildCycle(candles, startIndex, minIndex, endIndex, invert, firstPotentialEnd = endIndex) {
        if (invert) {
            return {
                startIndex: startIndex,
                maxIndex: minIndex, // Intermediate is Max
                endIndex: endIndex,
                duration: endIndex - startIndex,
                amplitude: candles[minIndex].high - candles[startIndex].low, // Amplitude: Max - StartLow
                startPrice: candles[startIndex].low,
                maxPrice: candles[minIndex].high,
                endPrice: candles[endIndex].low,
                firstPotentialEnd: firstPotentialEnd,
                type: 'inverted'
            };
        } else {
            return {
                startIndex: startIndex,
                minIndex: minIndex, // Intermediate is Min
                endIndex: endIndex,
                duration: endIndex - startIndex,
                amplitude: candles[startIndex].high - candles[minIndex].low,
                startPrice: candles[startIndex].high,
                minPrice: candles[minIndex].low,
                endPrice: candles[endIndex].high,
                firstPotentialEnd: firstPotentialEnd,
                type: 'normal'
            };
        }
    }
}
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
        this.feesEnabled = false;
        this.takerFeePercent = 0.04;

        // Exit Strategy Config
        this.tp1AvgPercent = 30;     // TP1 at 30% of avg cycle move (optimized)
        this.tp1CloseFraction = 0.6; // Close 60% at TP1
        this.tp2AccountPercent = 1;  // TP2 at 1% account profit

        // Entry Confirmation
        this.threeBarConfirmation = true; // Require 3 bars confirmation before entry
        this.closeOnOpposite = false; // Close on opposite cycle detection

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
        if (config.tp2AccountPercent !== undefined) {
            this.tp2AccountPercent = parseFloat(config.tp2AccountPercent);
        }
        // Entry confirmation
        if (config.threeBarConfirmation !== undefined) {
            this.threeBarConfirmation = config.threeBarConfirmation;
        }
        if (config.closeOnOpposite !== undefined) {
            this.closeOnOpposite = config.closeOnOpposite;
        }
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
                        const slPrice = liveCandles[lastCycle.startIndex].low;
                        lastTradedLongEnd = lastCycle.endIndex; // Mark: next trade only after THIS cycle ends

                        if (this.threeBarConfirmation) {
                            pendingSignal = { type: 'LONG', cycle: lastCycle, slPrice, detectionIndex: i };
                            pendingConfirmBars = 0;
                        } else {
                            this.openTrade('LONG', currentCandle.close, i, slPrice);
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
                        const slPrice = liveCandles[lastCycle.startIndex].high;
                        lastTradedShortEnd = lastCycle.endIndex; // Mark: next trade only after THIS cycle ends

                        if (this.threeBarConfirmation) {
                            pendingSignal = { type: 'SHORT', cycle: lastCycle, slPrice, detectionIndex: i };
                            pendingConfirmBars = 0;
                        } else {
                            this.openTrade('SHORT', currentCandle.close, i, slPrice);
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
                        this.openTrade(pendingSignal.type, currentCandle.close, i, pendingSignal.slPrice);
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

        // Pending signals waiting for 3-bar confirmation
        let pendingSignal = null;
        let pendingConfirmBars = 0;

        // Process candles
        for (let i = 0; i < candles.length; i++) {
            const candle = candles[i];

            // Check exits
            if (this.openPosition) {
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
                    if (pendingConfirmBars >= 3) {
                        // Confirmation passed - enter trade
                        this.openTrade(pendingSignal.type, candle.open, i, pendingSignal.slPrice);
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
                            this.openTrade(sig.type, candle.open, i, sig.slPrice);
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

    openTrade(type, price, index, slPrice) {
        const capitalUsed = this.currentBalance * (this.capitalPercentage / 100);
        const positionSize = (capitalUsed * this.leverage) / price;

        this.openPosition = {
            type,
            entryPrice: price,
            entryIndex: index,
            positionSize,
            capitalUsed,
            slPrice: slPrice,          // Original SL at cycle extremum
            partialClosed: false,
            breakEvenActive: false,
            initialCapital: capitalUsed,
            initialSize: positionSize
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

            // Break-even SL check
            if (pos.breakEvenActive && candle.close <= pos.entryPrice) {
                this.closePosition(candle.close, index, 'break_even');
                return true;
            }

            // Calculate current pump %
            const currentPump = ((candle.close - pos.entryPrice) / pos.entryPrice) * 100;

            // 2. TP1: At X% of avg pump → close Y%, move to BE
            const tp1Target = this.avgIndexPump * (this.tp1AvgPercent / 100);
            if (!pos.partialClosed && currentPump >= tp1Target && tp1Target > 0) {
                this.closePartial(candle.close, index, this.tp1CloseFraction, 'tp1_partial');
                pos.partialClosed = true;
                pos.breakEvenActive = true;
                return true;
            }

            // 3. TP2: Remaining profit >= X% of account
            if (pos.partialClosed) {
                const remainingPnL = ((candle.close - pos.entryPrice) / pos.entryPrice) * pos.capitalUsed * this.leverage;
                const tp2Target = this.startingBalance * (this.tp2AccountPercent / 100);
                if (remainingPnL >= tp2Target) {
                    this.closePosition(candle.close, index, 'tp2_account');
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

            // Break-even SL check
            if (pos.breakEvenActive && candle.close >= pos.entryPrice) {
                this.closePosition(candle.close, index, 'break_even');
                return true;
            }

            // Calculate current drop %
            const currentDrop = ((pos.entryPrice - candle.close) / pos.entryPrice) * 100;

            // 2. TP1: At X% of avg drop → close Y%, move to BE
            const tp1Target = this.avgInverseDrop * (this.tp1AvgPercent / 100);
            if (!pos.partialClosed && currentDrop >= tp1Target && tp1Target > 0) {
                this.closePartial(candle.close, index, this.tp1CloseFraction, 'tp1_partial');
                pos.partialClosed = true;
                pos.breakEvenActive = true;
                return true;
            }

            // 3. TP2: Remaining profit >= X% of account
            if (pos.partialClosed) {
                const remainingPnL = ((pos.entryPrice - candle.close) / pos.entryPrice) * pos.capitalUsed * this.leverage;
                const tp2Target = this.startingBalance * (this.tp2AccountPercent / 100);
                if (remainingPnL >= tp2Target) {
                    this.closePosition(candle.close, index, 'tp2_account');
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

        if (this.feesEnabled) {
            const fees = closedCapital * this.leverage * (this.takerFeePercent / 100) * 2;
            pnl -= fees;
            this.totalFees += fees;
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
            pnlPercent: (priceDiff / pos.entryPrice) * 100 * this.leverage,
            reason,
            balanceAfter: this.currentBalance,
            partial: true,
            fraction
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

        if (this.feesEnabled) {
            const fees = pos.capitalUsed * this.leverage * (this.takerFeePercent / 100) * 2;
            pnl -= fees;
            this.totalFees += fees;
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
            pnlPercent: (priceDiff / pos.entryPrice) * 100 * this.leverage,
            reason,
            balanceAfter: this.currentBalance
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

// ========== OPTIMIZER CODE ==========
const https = require('https');

async function fetchCandles(symbol, interval, limit = 1000) {
    return new Promise((resolve, reject) => {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const parsed = JSON.parse(data);
                resolve(parsed.map(k => ({
                    time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]
                })));
            });
        }).on('error', reject);
    });
}

async function optimize(interval, name) {
    console.log(`\n== ${name} ==`);
    const candles = await fetchCandles('SUIUSDT', interval, 1000);
    const results = [];
    
    for (const minDur of [10, 12, 18, 24]) {
        for (const maxDur of [30, 36, 44, 52, 60]) {
            if (maxDur <= minDur) continue;
            for (const tp1 of [20, 30, 40, 50]) {
                for (const lev of [10, 20]) {
                    for (const cap of [20, 30]) {
                        const d = new CycleDetector();
                        const b = new CycleTradingBot();
                        b.updateConfig({ startingBalance:1000, leverage:lev, capitalPercentage:cap, feesEnabled:true, tp1AvgPercent:tp1, threeBarConfirmation:true });
                        try {
                            b.simulateLiveTrading(candles, d, [], false, minDur, maxDur, true);
                            const pnl = b.currentBalance - 1000;
                            if (b.trades.length > 0) results.push({minDur, maxDur, tp1, lev, cap, pnl, trades: b.trades.length});
                        } catch(e) {}
                    }
                }
            }
        }
    }
    results.sort((a,b) => b.pnl - a.pnl);
    if (results[0] && results[0].pnl > 0) {
        const r = results[0];
        console.log(`BEST: Range ${r.minDur}-${r.maxDur}, TP1=${r.tp1}%, Lev=${r.lev}x, Cap=${r.cap}% => PnL $${r.pnl.toFixed(0)} (${r.trades} trades)`);
        return r;
    } else {
        console.log('No profitable settings found');
        return null;
    }
}

(async () => {
    console.log('FULL OPTIMIZER WITH FEES');
    for (const [i, n] of [['1m','1 Min'],['5m','5 Min'],['15m','15 Min'],['1h','1 Hour']]) {
        await optimize(i, n);
    }
})();
