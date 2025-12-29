class CycleSwingMomentum {
    constructor() {
        this.cycs = 50;
        // Settings from user image
        this.lbR = 5;
        this.lbL = 5;
        this.rangeUpper = 60;
        this.rangeLower = 5;
    }

    Cycle1(i, waveThrottle, cycs) {
        let ret = 6.0 * waveThrottle + 1.0;
        if (i === 0) ret = 1.0 + waveThrottle;
        else if (i === 1) ret = 1.0 + waveThrottle * 5.0;
        else if (i === cycs - 1) ret = 1.0 + waveThrottle;
        else if (i === cycs - 2) ret = 1.0 + waveThrottle * 5.0;
        return ret;
    }

    Cycle2(i, waveThrottle, cycs) {
        let ret = -4.0 * waveThrottle;
        if (i === 0) ret = -2.0 * waveThrottle;
        else if (i === cycs - 1) ret = 0.0;
        else if (i === cycs - 2) ret = -2.0 * waveThrottle;
        return ret;
    }

    Cycle3(i, waveThrottle, cycs) {
        let ret = waveThrottle;
        if (i === cycs - 1) ret = 0.0;
        else if (i === cycs - 2) ret = 0.0;
        return ret;
    }

    iWTT_CSI_processor(CycleCount, closes) {
        // This function in Pine Script processes the ENTIRE series for each bar?
        // No, Pine Script runs on each bar. The loop `for i = 0 to cycs - 1` looks back.
        // So for each candle, we calculate the value.

        const results = [];
        const cycs = this.cycs;
        const waveThrottle = 160 * CycleCount;

        for (let k = 0; k < closes.length; k++) {
            // Need at least 50 bars of history? Pine script uses src[49-i] which implies looking back 50 bars.
            // If k < 49, we can't calculate fully.

            if (k < 49) {
                results.push(0);
                continue;
            }

            let wtt1 = 0.0;
            let wtt2 = 0.0;
            let wtt3 = 0.0;
            let wtt4 = 0.0;
            let wtt5 = 0.0;
            let _wtt1 = 0.0;
            let _wtt2 = 0.0;
            let _wtt3 = 0.0;
            let _wtt4 = 0.0;
            let _wtt5 = 0.0;
            let momentum = 0.0;
            let acceleration = 0.0;
            let swing = 0.0;
            let currentVal = 0.0;

            for (let i = 0; i < cycs; i++) {
                swing = this.Cycle1(i, waveThrottle, cycs) - wtt4 * wtt1 - _wtt5 * _wtt2;
                if (swing === 0) break;

                momentum = this.Cycle2(i, waveThrottle, cycs);
                _wtt1 = wtt1;
                wtt1 = (momentum - wtt4 * wtt2) / swing;

                acceleration = this.Cycle3(i, waveThrottle, cycs);
                _wtt2 = wtt2;
                wtt2 = acceleration / swing;

                // src[49-i] in Pine Script context of the loop:
                // The loop goes 0 to 49.
                // It seems to be a filter implementation.
                // In Pine, src[0] is current, src[1] is previous.
                // Here we are at index k.
                // The loop uses src[49-i]. 
                // Wait, the Pine Script loop is:
                // for i = 0 to cycs - 1
                //    ...
                //    _valToUse=src[49-i]
                // 
                // This looks like it's iterating through a fixed window of 50 past values?
                // Or is it a recursive filter structure?
                // It looks like a recursive filter where the coefficients change or it's a specific FIR/IIR structure.
                // Actually, `src[49-i]` means:
                // When i=0, src[49]. When i=49, src[0].
                // This suggests it's processing a window of 50 items ending at the current bar?
                // But `src` in Pine is relative to current bar.
                // So src[49] is 49 bars ago.
                // So it takes the value from 49 bars ago, then 48, ..., down to 0 (current)?
                // Yes, it processes a window of 50 bars.

                // So at index k, we need values from k-49 to k.
                // And the loop i goes 0..49.
                // valToUse = closes[k - (49 - i)]?
                // Let's trace: i=0 -> src[49] (oldest). i=49 -> src[0] (newest).
                // Yes.

                const valToUse = closes[k - (49 - i)];

                currentVal = (valToUse - _wtt3 * _wtt5 - wtt3 * wtt4) / swing;
                _wtt3 = wtt3;
                wtt3 = currentVal;
                wtt4 = momentum - wtt5 * _wtt1;
                _wtt5 = wtt5;
                wtt5 = acceleration;
            }
            results.push(currentVal);
        }
        return results;
    }

    calculate(closes) {
        const thrust1 = this.iWTT_CSI_processor(1, closes);
        const thrust2 = this.iWTT_CSI_processor(10, closes);

        const csiBuffer = [];
        for (let i = 0; i < closes.length; i++) {
            csiBuffer.push(thrust1[i] - thrust2[i]);
        }
        return csiBuffer;
    }

    detectDivergences(momentumValues, highs, lows) {
        const divergences = [];
        const len = momentumValues.length;

        // Helper to find Pivot Low
        const isPivotLow = (src, i, l, r) => {
            if (i - l < 0 || i + r >= src.length) return false;
            const val = src[i];
            for (let x = 1; x <= l; x++) if (src[i - x] <= val) return false; // Strictly less? Pine uses < usually for pivots? ta.pivotlow: "value is less than the 'left' preceding values and less than the 'right' succeeding values"
            // Actually Pine pivotlow is: src[i] < src[i-1]... and src[i] < src[i+1]...
            // Usually it's strictly less or equal? 
            // Docs: "If there are multiple equal values, the first one is returned."
            // Let's stick to strictly less for simplicity or <=.
            // Let's use < for neighbors.
            for (let x = 1; x <= l; x++) if (src[i - x] < val) return false; // If neighbor is lower, then i is not pivot low.
            for (let x = 1; x <= r; x++) if (src[i + x] < val) return false;
            return true;
        };

        // Helper to find Pivot High
        const isPivotHigh = (src, i, l, r) => {
            if (i - l < 0 || i + r >= src.length) return false;
            const val = src[i];
            for (let x = 1; x <= l; x++) if (src[i - x] > val) return false;
            for (let x = 1; x <= r; x++) if (src[i + x] > val) return false;
            return true;
        };

        // We need to track past pivots to implement `valuewhen` and `barssince`
        // `valuewhen(condition, source, occurrence)`
        // We iterate through the array.

        // Store pivot occurrences: { index, value, priceLow/High }
        const pivotLows = [];
        const pivotHighs = [];

        for (let i = this.lbL; i < len - this.lbR; i++) {
            // Check for Pivot Low at index i
            // But in Pine, the signal occurs at i + lbR (when the right side is confirmed)
            // So we are currently at `currentBar = i + this.lbR`.
            // The pivot is at `i`.

            const currentBar = i + this.lbR;

            // Check Pivot Low
            if (isPivotLow(momentumValues, i, this.lbL, this.lbR)) {
                pivotLows.push({ index: i, osc: momentumValues[i], price: lows[i] });

                // Check Divergence (Bullish)
                // We need at least 2 pivots
                if (pivotLows.length >= 2) {
                    const prev = pivotLows[pivotLows.length - 2];
                    const curr = pivotLows[pivotLows.length - 1];

                    const barsDiff = curr.index - prev.index;

                    if (barsDiff >= this.rangeLower && barsDiff <= this.rangeUpper) {
                        // Regular Bullish: Price Lower Low, Osc Higher Low
                        if (curr.price < prev.price && curr.osc > prev.osc) {
                            divergences.push({ index: i, type: 'bullish', price: curr.price });
                        }

                        // Hidden Bullish: Price Higher Low, Osc Lower Low
                        if (curr.price > prev.price && curr.osc < prev.osc) {
                            divergences.push({ index: i, type: 'hidden_bullish', price: curr.price });
                        }
                    }
                }
            }

            // Check Pivot High
            if (isPivotHigh(momentumValues, i, this.lbL, this.lbR)) {
                pivotHighs.push({ index: i, osc: momentumValues[i], price: highs[i] });

                if (pivotHighs.length >= 2) {
                    const prev = pivotHighs[pivotHighs.length - 2];
                    const curr = pivotHighs[pivotHighs.length - 1];

                    const barsDiff = curr.index - prev.index;

                    if (barsDiff >= this.rangeLower && barsDiff <= this.rangeUpper) {
                        // Regular Bearish: Price Higher High, Osc Lower High
                        if (curr.price > prev.price && curr.osc < prev.osc) {
                            divergences.push({ index: i, type: 'bearish', price: curr.price });
                        }

                        // Hidden Bearish: Price Lower High, Osc Higher High
                        if (curr.price < prev.price && curr.osc > prev.osc) {
                            divergences.push({ index: i, type: 'hidden_bearish', price: curr.price });
                        }
                    }
                }
            }
        }

        return divergences;
    }
}
