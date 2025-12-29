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

                // NEW RULE: Candidate Min must have Close < Previous Low
                // Trend Exception: If close strict rule fails, check for strong prior trend (4 conditions)
                if (j > 0 && candles[j].close >= candles[j - 1].low) {
                    // Check if previous 2 candles were strongly trending down
                    // conditions: prev < prev-2 (close & low) AND prev-2 < prev-3 (close & low)
                    if (j < 3) return false; // Not enough history
                    const prev = candles[j - 1]; const prev2 = candles[j - 2]; const prev3 = candles[j - 3];
                    const strongTrend = prev.close < prev2.close && prev.low < prev2.low &&
                        prev2.close < prev3.close && prev2.low < prev3.low;

                    if (!strongTrend) return false;
                }

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

                // NEW RULE: Candidate Max must have Close > Previous High
                // Trend Exception: If close strict rule fails, check for strong prior trend (4 conditions)
                if (j > 0 && candles[j].close <= candles[j - 1].high) {
                    // Check if previous 2 candles were strongly trending up
                    // conditions: prev > prev-2 (close & high) AND prev-2 > prev-3 (close & high)
                    if (j < 3) return false; // Not enough history
                    const prev = candles[j - 1]; const prev2 = candles[j - 2]; const prev3 = candles[j - 3];
                    const strongTrend = prev.close > prev2.close && prev.high > prev2.high &&
                        prev2.close > prev3.close && prev2.high > prev3.high;

                    if (!strongTrend) return false;
                }

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
        // Initialize bestExtremum based on type
        // Inverted: We want lowest Close. Init to Infinity.
        // Normal: We want to beat the previous High with our Close. 
        // If we found a priority match, that is our baseline.
        let bestExtremum = invert ? Infinity : -Infinity;

        if (firstValidEnd !== null) {
            bestCandidate = { endIndex: firstValidEnd, minIndex: isValidEnd(firstValidEnd).minIndex };
            if (invert) {
                bestExtremum = candles[firstValidEnd].low; // Initial threshold is Low of first match
            } else {
                bestExtremum = candles[firstValidEnd].high; // Initial threshold is High of first match
            }
        }

        // If priority is enabled, we already checked minEndIndex, so start from +1.
        // If priority is disabled, we haven't checked anything, so start from minEndIndex.
        const loopStart = priorityMinDuration ? minEndIndex + 1 : minEndIndex;

        for (let j = loopStart; j <= maxEndIndex; j++) {
            const check = isValidEnd(j);
            if (check) {
                if (firstValidEnd === null) {
                    firstValidEnd = j;
                    // First match found in loop
                    bestCandidate = { endIndex: j, minIndex: check.minIndex };
                    if (invert) {
                        bestExtremum = candles[j].low;
                    } else {
                        bestExtremum = candles[j].high;
                    }
                    continue; // Initialized, move to next
                }

                // Found a subsequent valid end. Check if it's better.
                if (invert) {
                    // Inverted Cycle: End is a Local Min.
                    // NEW RULE: Update only if Current Close < Best Candidate's LOW
                    if (candles[j].close < bestExtremum) {
                        // Update best candidate
                        bestCandidate = { endIndex: j, minIndex: check.minIndex };
                        // Update threshold to THIS candle's Low
                        bestExtremum = candles[j].low;
                    }
                } else {
                    // Normal Cycle: End is a Local Max
                    // NEW RULE: Update only if Current Close > Best Candidate's HIGH
                    if (candles[j].close > bestExtremum) {
                        // Update best candidate
                        bestCandidate = { endIndex: j, minIndex: check.minIndex };
                        // Update threshold to THIS candle's High
                        bestExtremum = candles[j].high;
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
