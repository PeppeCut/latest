class CandlestickChart {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.data = [];
        this.visibleData = [];

        // Chart dimensions
        this.padding = { top: 40, right: 80, bottom: 30, left: 10 }; // Reduced left padding
        this.chartWidth = 0;
        this.chartHeight = 0;

        // Layout
        this.layout = {
            mainHeight: 0,
            indicatorHeight: 0,
            separatorY: 0,
            gap: 20
        };

        // Zoom and pan state
        this.zoom = 1;
        this.panOffset = 0;
        this.verticalZoom = 1;

        // Mouse interaction
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartOffset = 0;
        this.mouseX = 0;
        this.mouseY = 0;
        this.hoveredCandle = null;

        // Colors
        this.colors = {
            bullish: '#10b981',
            bearish: '#ef4444',
            grid: 'rgba(99, 102, 241, 0.1)',
            text: '#9ca3af',
            crosshair: 'rgba(99, 102, 241, 0.5)',
            textPrimary: '#f9fafb',
            volumeBullish: 'rgba(16, 185, 129, 0.3)',
            volumeBearish: 'rgba(239, 68, 68, 0.3)',
            cycleLine: '#3b82f6',
            cycleLabel: '#60a5fa',
            cycleMin: '#f59e0b',
            momentumBullish: 'rgba(16, 185, 129, 0.5)',
            momentumBearish: 'rgba(239, 68, 68, 0.5)',
            momentumLine: '#9ca3af'
        };

        // Cycle Indicator Config
        this.showLabels = true;
        this.showParabola = true;
        this.showMin = true;
        this.cycles = [];
        this.momentumValues = [];
        this.divergences = [];
        this.showProjections = false;
        this.showProjections = false;
        this.targetLine = null; // { price: number, avgDrop: number }
        this.showProjections = false;
        this.minDuration = 24; // Default min duration
        this.maxDuration = 44; // Default max duration
        this.targetLine = null; // { price: number, avgDrop: number }
        this.rangeEndLine = null; // { index: number, maxDuration: number } - vertical line at cycle range end

        // Manual Cycle State
        this.manualMode = false;
        this.manualPoints = []; // Array of {index, price, time}

        this.onManualCycleComplete = null; // Callback function

        // Closure Markers (Persistent 'S')


        // Closure Markers (Persistent 'S')
        this.closureMarkers = new Map(); // Map of timestamp -> type ('inverted'|'normal')

        // Trade Markers for Bot (LONG/SHORT bubbles)
        this.tradeMarkers = []; // Array of {index, type: 'LONG'|'SHORT', price}
        this.exitMarkers = [];  // Array of {index, reason, price, type}
        this.tradeLines = [];   // Array of {entryIndex, exitIndex, entryPrice, exitPrice}
        this.tpLines = null;    // { tp1: number, tp2: number, type: 'LONG'|'SHORT' } for open position TP lines
        this.openPosition = null; // { entryPrice: number, type: 'LONG'|'SHORT', slPrice: number } for entry line

        this.setupCanvas();
        this.attachEventListeners();
    }

    addClosureMarkers(markers) {
        markers.forEach(m => this.closureMarkers.set(m.time, m.type));
        console.log('Chart closureMarkers size:', this.closureMarkers.size);
        this.render();
    }

    clearClosureMarkers() {
        this.closureMarkers.clear();
        this.render();
    }

    setTradeMarkers(trades) {
        this.tradeMarkers = trades.map(t => ({
            index: t.entryIndex,
            type: t.type,
            price: t.entryPrice
        }));
        this.render();
    }

    clearTradeMarkers() {
        this.tradeMarkers = [];
        this.render();
    }

    setExitMarkers(trades) {
        this.exitMarkers = trades.filter(t => t.exitIndex !== undefined).map(t => ({
            index: t.exitIndex,
            reason: t.reason,
            price: t.exitPrice,
            type: t.type,
            entryIndex: t.entryIndex,
            entryPrice: t.entryPrice
        }));
        this.render();
    }

    clearExitMarkers() {
        this.exitMarkers = [];
        this.render();
    }

    setTradeLines(trades) {
        // Create lines from entry to exit points with reason for coloring
        this.tradeLines = trades.filter(t => t.exitIndex !== undefined).map(t => ({
            entryIndex: t.entryIndex,
            exitIndex: t.exitIndex,
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            type: t.type,
            reason: t.reason || '',
            partial: t.partial || false,
            pnl: t.pnl || 0
        }));
        this.render();
    }

    setTPLines(tp1, tp2, positionType) {
        if (tp1 !== null && tp2 !== null) {
            this.tpLines = { tp1, tp2, type: positionType };
        } else {
            this.tpLines = null;
        }
        this.render();
    }

    clearTPLines() {
        this.tpLines = null;
        this.render();
    }

    setOpenPosition(entryPrice, type, slPrice = null) {
        if (entryPrice !== null) {
            this.openPosition = { entryPrice, type, slPrice };
        } else {
            this.openPosition = null;
        }
        this.render();
    }

    clearOpenPosition() {
        this.openPosition = null;
        this.render();
    }

    setupCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;

        this.ctx.scale(dpr, dpr);

        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';

        this.chartWidth = rect.width - this.padding.left - this.padding.right;
        this.chartHeight = rect.height - this.padding.top - this.padding.bottom;

        // Calculate pane heights (75% Main, 25% Indicator)
        const availableHeight = this.chartHeight - this.layout.gap;
        this.layout.mainHeight = availableHeight * 0.75;
        this.layout.indicatorHeight = availableHeight * 0.25;
        this.layout.separatorY = this.padding.top + this.layout.mainHeight + this.layout.gap / 2;
    }

    attachEventListeners() {
        // Mouse wheel for zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();

            if (e.shiftKey) {
                // Vertical zoom
                const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
                this.verticalZoom *= zoomDelta;
                this.verticalZoom = Math.max(0.5, Math.min(5, this.verticalZoom));
            } else {
                // Horizontal zoom
                const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
                this.zoom *= zoomDelta;
                this.zoom = Math.max(0.5, Math.min(10, this.zoom));
            }

            this.render();
        });

        // Touch Events for Mobile
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                this.isDragging = true;
                this.lastMouseX = e.touches[0].clientX;
            } else if (e.touches.length === 2) {
                // Pinch start
                this.isDragging = false;
                const dist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                this.lastPinchDist = dist;
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault(); // Prevent scrolling while interacting with chart

            if (e.touches.length === 1 && this.isDragging) {
                // Pan
                const deltaX = e.touches[0].clientX - this.lastMouseX;
                this.panOffset += deltaX;
                this.lastMouseX = e.touches[0].clientX;
                this.render();
            } else if (e.touches.length === 2) {
                // Pinch Zoom
                const dist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );

                if (this.lastPinchDist) {
                    const delta = dist - this.lastPinchDist;
                    const zoomFactor = delta > 0 ? 1.02 : 0.98; // Slower zoom for touch
                    this.zoom *= zoomFactor;
                    this.zoom = Math.max(0.5, Math.min(10, this.zoom));
                    this.render();
                }
                this.lastPinchDist = dist;
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', () => {
            this.isDragging = false;
            this.lastPinchDist = null;
        });

        // Mouse down for dragging or manual cycle placement
        this.canvas.addEventListener('mousedown', (e) => {
            if (this.manualMode) {
                const rect = this.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                // Check if click is within chart area
                if (x >= this.padding.left && x <= this.padding.left + this.chartWidth &&
                    y >= this.padding.top && y <= this.padding.top + this.layout.mainHeight) {

                    // Convert X to Index
                    const { candleWidth, candleSpacing, startIndex } = this.calculateVisibleData();
                    const clickOffset = x - this.padding.left - (this.panOffset % (candleWidth + candleSpacing));
                    const indexOffset = Math.round(clickOffset / (candleWidth + candleSpacing));
                    const dataIndex = startIndex + indexOffset;

                    if (dataIndex >= 0 && dataIndex < this.data.length) {
                        const candle = this.data[dataIndex];
                        // Store point
                        this.manualPoints.push({
                            index: dataIndex,
                            price: candle.close, // Or use High/Low based on y? For now, just index matters mostly.
                            time: candle.time
                        });

                        // If we have 2 points, complete the cycle
                        if (this.manualPoints.length === 2) {
                            // Sort points by index
                            this.manualPoints.sort((a, b) => a.index - b.index);

                            if (this.onManualCycleComplete) {
                                this.onManualCycleComplete(this.manualPoints[0], this.manualPoints[1]);
                            }
                            // Reset mode (or keep it? Usually reset after action)
                            this.manualMode = false;
                            this.manualPoints = [];
                            this.canvas.style.cursor = 'default';
                        }

                        this.render();
                        return; // Don't drag
                    }
                }
            }

            this.isDragging = true;
            this.dragStartX = e.offsetX;
            this.dragStartOffset = this.panOffset;
            this.canvas.style.cursor = 'grabbing';
        });

        // Mouse move
        this.canvas.addEventListener('mousemove', (e) => {
            this.mouseX = e.offsetX;
            this.mouseY = e.offsetY;

            if (this.isDragging) {
                const dx = e.offsetX - this.dragStartX;
                this.panOffset = this.dragStartOffset + dx;
                this.render();
            } else {
                this.updateHover();
            }
        });

        // Mouse up
        this.canvas.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        // Mouse leave
        this.canvas.addEventListener('mouseleave', () => {
            this.isDragging = false;
            this.hoveredCandle = null;
            this.render();
            this.hideTooltip();
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.setupCanvas();
            this.render();
        });
    }

    setData(data) {
        this.data = data;
        this.render();
    }

    setCycles(cycles) {
        this.cycles = cycles;
        this.render();
    }

    setMomentum(values) {
        this.momentumValues = values;
        this.render();
    }

    setDivergences(divergences) {
        this.divergences = divergences;
        this.render();
    }

    setTargetLine(price, avgDrop = 0) {
        if (price !== null) {
            this.targetLine = { price, avgDrop };
        } else {
            this.targetLine = null;
        }
        this.render();
    }

    setRangeEndLine(cycleStartIndex, maxDuration) {
        if (cycleStartIndex !== null && maxDuration !== null) {
            this.rangeEndLine = {
                index: cycleStartIndex + maxDuration,
                cycleStart: cycleStartIndex,
                maxDuration: maxDuration,
                color: arguments[2] // Optional color argument
            };
        } else {
            this.rangeEndLine = null;
        }
        this.render();
    }

    updateConfig(config) {
        if (config.showLabels !== undefined) this.showLabels = config.showLabels;
        if (config.showParabola !== undefined) this.showParabola = config.showParabola;
        if (config.showMin !== undefined) this.showMin = config.showMin;
        if (config.showProjections !== undefined) this.showProjections = config.showProjections;
        if (config.showLabels !== undefined) this.showLabels = config.showLabels;
        if (config.showParabola !== undefined) this.showParabola = config.showParabola;
        if (config.showMin !== undefined) this.showMin = config.showMin;
        if (config.showProjections !== undefined) this.showProjections = config.showProjections;
        if (config.minDuration !== undefined) this.minDuration = config.minDuration;
        if (config.maxDuration !== undefined) this.maxDuration = config.maxDuration;
        this.render();
    }

    reset() {
        this.zoom = 1;
        this.panOffset = 0;
        this.verticalZoom = 1;
        this.render();
    }

    calculateVisibleData() {
        const candleWidth = 8 * this.zoom;
        const candleSpacing = 2 * this.zoom;
        const totalCandleWidth = candleWidth + candleSpacing;

        const maxVisibleCandles = Math.floor(this.chartWidth / totalCandleWidth);
        const startIndex = Math.max(0, this.data.length - maxVisibleCandles - Math.floor(this.panOffset / totalCandleWidth));
        const endIndex = Math.min(this.data.length, startIndex + maxVisibleCandles + 20);

        this.visibleData = this.data.slice(startIndex, endIndex);
        return { candleWidth, candleSpacing, startIndex };
    }

    getPriceRange() {
        if (this.visibleData.length === 0) return { min: 0, max: 100 };

        let min = Infinity;
        let max = -Infinity;

        this.visibleData.forEach(candle => {
            min = Math.min(min, candle.low);
            max = Math.max(max, candle.high);
        });

        const padding = (max - min) * 0.1 / this.verticalZoom;
        return { min: min - padding, max: max + padding };
    }

    priceToY(price, priceRange) {
        const ratio = (price - priceRange.min) / (priceRange.max - priceRange.min);
        return this.padding.top + this.layout.mainHeight - (ratio * this.layout.mainHeight);
    }

    indicatorToY(value, range) {
        const ratio = (value - range.min) / (range.max - range.min);
        const top = this.layout.separatorY + this.layout.gap / 2;
        return top + this.layout.indicatorHeight - (ratio * this.layout.indicatorHeight);
    }

    yToPrice(y, priceRange) {
        if (y > this.padding.top + this.layout.mainHeight) return null;
        const ratio = (this.layout.mainHeight - (y - this.padding.top)) / this.layout.mainHeight;
        return priceRange.min + ratio * (priceRange.max - priceRange.min);
    }

    render() {
        const ctx = this.ctx;
        const rect = this.canvas.getBoundingClientRect();

        // Clear canvas
        ctx.clearRect(0, 0, rect.width, rect.height);

        if (this.data.length === 0) {
            ctx.fillStyle = this.colors.text;
            ctx.font = '14px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('No data available', rect.width / 2, rect.height / 2);

            return;
        }

        const { candleWidth, candleSpacing, startIndex } = this.calculateVisibleData();
        const priceRange = this.getPriceRange();

        // Draw grid
        this.drawGrid(priceRange);

        // Draw Volume
        this.drawVolume(candleWidth, candleSpacing, startIndex);

        // Draw Cycles
        this.drawCycles(candleWidth, candleSpacing, startIndex, priceRange);
        if (this.showProjections) {
            this.drawProjections(candleWidth, candleSpacing, startIndex, priceRange);
        }
        // Draw target line with projections
        if (this.targetLine) {
            this.drawTargetLine(priceRange);
        }

        // Draw TP1/TP2 lines for open position
        if (this.tpLines) {
            this.drawTPLines(priceRange);
        }

        // Draw open position entry and SL lines
        if (this.openPosition) {
            this.drawOpenPosition(priceRange);
        }

        // Draw range end line (vertical line at cycle max duration)
        if (this.rangeEndLine) {
            this.drawRangeEndLine(candleWidth, candleSpacing, startIndex);
        }

        // Draw candlesticks FIRST (so markers appear on top)
        this.visibleData.forEach((candle, i) => {
            const x = this.padding.left + (i * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
            this.drawCandle(candle, x, candleWidth, priceRange);
        });

        // Initialize marker stacking
        // We track the Y offset for top and bottom of each candle index to stack markers
        const markerOffsets = new Map(); // index -> { top: 0, bottom: 0 }

        const getMarkerOffset = (index) => {
            if (!markerOffsets.has(index)) {
                markerOffsets.set(index, { top: 15, bottom: 15 }); // Start with base offset
            }
            return markerOffsets.get(index);
        };

        // Draw Closure Markers ('S')
        if (this.closureMarkers.size > 0) {
            // Font settings
            ctx.font = 'bold 12px Inter';
            ctx.textAlign = 'center';

            let sDrawn = 0;
            this.visibleData.forEach((candle, i) => {
                const timeKey = String(candle.time);
                if (this.closureMarkers.has(timeKey)) {
                    sDrawn++;
                    const type = this.closureMarkers.get(timeKey);
                    const offsets = getMarkerOffset(i + startIndex);

                    // Set color based on cycle type
                    // Inverted (Index) -> Blue (#3b82f6)
                    // Normal (Inverse) -> Red (#ef4444)
                    // Default to Red if type is missing/unknown to distinguish from white
                    let color = '#ef4444';
                    if (type === 'inverted') {
                        color = '#3b82f6';
                    }
                    ctx.fillStyle = color;

                    const x = this.padding.left + (i * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
                    const y = this.priceToY(candle.high, priceRange) - offsets.top;

                    ctx.fillText('S', x, y);

                    // Increment stack height
                    offsets.top += 15;
                }
            });
        }

        // Draw Trade Lines (colored based on exit reason)
        if (this.tradeLines && this.tradeLines.length > 0) {
            ctx.save();

            this.tradeLines.forEach(line => {
                // Check if at least part of line is visible
                const lineStart = Math.max(line.entryIndex, startIndex);
                const lineEnd = Math.min(line.exitIndex, startIndex + this.visibleData.length - 1);
                if (lineStart > lineEnd) return;

                const entryCandle = this.data[line.entryIndex];
                const exitCandle = this.data[line.exitIndex];
                if (!entryCandle || !exitCandle) return;

                // Color based on exit reason
                let lineColor;
                const reason = line.reason || '';
                if (reason.includes('tp1')) {
                    lineColor = '#f59e0b'; // Orange for TP1
                } else if (reason.includes('tp2')) {
                    lineColor = '#8b5cf6'; // Purple for TP2
                } else if (reason.includes('sl_') || reason.includes('stop')) {
                    lineColor = '#ef4444'; // Red for SL
                } else if (reason.includes('break_even')) {
                    lineColor = '#6b7280'; // Gray for BE
                } else if (reason.includes('cycle')) {
                    lineColor = '#3b82f6'; // Blue for cycle end
                } else {
                    lineColor = line.pnl >= 0 ? '#10b981' : '#ef4444'; // Green/Red based on PnL
                }

                // All trade lines are dashed
                ctx.setLineDash([5, 5]);

                ctx.strokeStyle = lineColor;
                ctx.lineWidth = line.partial ? 1 : 2; // Thinner for partial closes

                const x1 = this.padding.left + ((line.entryIndex - startIndex) * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
                const x2 = this.padding.left + ((line.exitIndex - startIndex) * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
                const y1 = this.priceToY(line.entryPrice, priceRange);
                const y2 = this.priceToY(line.exitPrice, priceRange);

                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            });

            ctx.restore();
        }

        // Draw Trade Markers (LONG/SHORT bubbles)
        if (this.tradeMarkers.length > 0) {
            this.tradeMarkers.forEach(marker => {
                // Check if visible
                if (marker.index < startIndex || marker.index >= startIndex + this.visibleData.length) return;

                const x = this.padding.left + ((marker.index - startIndex) * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
                const candle = this.data[marker.index];
                if (!candle) return;

                const offsets = getMarkerOffset(marker.index);
                const isLong = marker.type === 'LONG';

                let y;
                if (isLong) {
                    y = this.priceToY(candle.high, priceRange) - offsets.top - 10; // Extra 10 for radius
                    offsets.top += 25; // Increase top stack
                } else {
                    y = this.priceToY(candle.low, priceRange) + offsets.bottom + 10;
                    offsets.bottom += 25; // Increase bottom stack
                }

                // Draw bubble
                const bubbleColor = isLong ? '#10b981' : '#ef4444'; // Green for LONG, Red for SHORT

                // Bubble background
                ctx.fillStyle = bubbleColor;
                ctx.beginPath();
                ctx.arc(x, y, 10, 0, Math.PI * 2);
                ctx.fill();

                // Bubble border
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 2;
                ctx.stroke();

                // Letter inside
                ctx.fillStyle = 'white';
                ctx.font = 'bold 10px Inter';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(isLong ? 'L' : 'S', x, y);
            });
        }

        // Draw Exit Markers (TP1/TP2/SL icons)
        if (this.exitMarkers && this.exitMarkers.length > 0) {
            this.exitMarkers.forEach(marker => {
                if (marker.index < startIndex || marker.index >= startIndex + this.visibleData.length) return;

                const x = this.padding.left + ((marker.index - startIndex) * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
                const candle = this.data[marker.index];
                if (!candle) return;

                const offsets = getMarkerOffset(marker.index);
                const isLong = marker.type === 'LONG';

                // Exits are usually opposite to entry: Long exit is at High, Short exit at Low
                // BUT logically: Close Long (sell) happens at Bid (High/Close), Close Short (buy) happens at Ask (Low/Close)
                // Let's stick to visual convention: Markers above for Long/High events, below for Short/Low events?
                // Actually: Long Exit should be above (Profit/Loss), Short Exit below?
                // Let's just stack "Above" markers and "Below" markers.

                // Let's stick to the previous visual preference but stacked:
                // isLong (Long Trade Exit) -> previously drawn BELOW candle
                // !isLong (Short Trade Exit) -> previously drawn ABOVE candle

                let y;
                if (isLong) {
                    y = this.priceToY(candle.low, priceRange) + offsets.bottom + 8; // +8 for half height
                    offsets.bottom += 20;
                } else {
                    y = this.priceToY(candle.high, priceRange) - offsets.top - 8;
                    offsets.top += 20;
                }

                // Colors based on reason
                let bubbleColor, label;
                const reason = marker.reason || '';
                if (reason === 'tp1_partial') { bubbleColor = '#f59e0b'; label = '1'; }
                else if (reason === 'tp2_account') { bubbleColor = '#8b5cf6'; label = '2'; }
                else if (reason === 'break_even') { bubbleColor = '#6b7280'; label = 'BE'; }
                else if (reason.includes('sl_')) { bubbleColor = '#ef4444'; label = 'SL'; }
                else { bubbleColor = '#3b82f6'; label = 'X'; }

                // Draw square marker
                ctx.fillStyle = bubbleColor;
                ctx.fillRect(x - 10, y - 8, 20, 16);

                // Border
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x - 10, y - 8, 20, 16);

                // Label
                ctx.fillStyle = 'white';
                ctx.font = 'bold 9px Inter';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, x, y);
            });
        }

        // Draw crosshair and highlight hovered candle
        if (this.hoveredCandle) {
            this.drawCrosshair();
        }

        // Draw Manual Points
        if (this.manualPoints.length > 0) {
            const { candleWidth, candleSpacing, startIndex } = this.calculateVisibleData();

            this.manualPoints.forEach(point => {
                // Check visibility
                if (point.index < startIndex || point.index >= startIndex + this.visibleData.length) return;

                const x = this.padding.left + ((point.index - startIndex) * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
                // We don't have exact Y from click stored well (used close), but let's draw a vertical line or a dot at the candle
                // Let's draw a distinct marker at the bottom or top
                const y = this.padding.top + this.layout.mainHeight - 10;

                ctx.fillStyle = '#f59e0b'; // Amber
                ctx.beginPath();
                ctx.arc(x, y, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 2;
                ctx.stroke();
            });
        }


        // Draw axes
        this.drawAxes(priceRange);

        // Draw Indicator Pane (Placeholder)
        this.drawIndicatorPane(candleWidth, candleSpacing, startIndex);
    }

    drawGrid(priceRange) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;

        // Horizontal grid lines
        const priceSteps = 8;
        for (let i = 0; i <= priceSteps; i++) {
            const y = this.padding.top + (this.layout.mainHeight / priceSteps) * i;
            ctx.beginPath();
            ctx.moveTo(this.padding.left, y);
            ctx.lineTo(this.padding.left + this.chartWidth, y);
            ctx.stroke();
        }

        // Vertical grid lines
        const timeSteps = 10;
        for (let i = 0; i <= timeSteps; i++) {
            const x = this.padding.left + (this.chartWidth / timeSteps) * i;
            ctx.beginPath();
            ctx.moveTo(x, this.padding.top);
            ctx.lineTo(x, this.padding.top + this.chartHeight); // Keep vertical lines full height
            ctx.stroke();
        }

        // Separator Line
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.padding.left, this.layout.separatorY);
        ctx.lineTo(this.padding.left + this.chartWidth, this.layout.separatorY);
        ctx.stroke();
    }

    drawVolume(candleWidth, candleSpacing, startIndex) {
        const ctx = this.ctx;
        const maxVolumeHeight = this.layout.mainHeight * 0.2; // Bottom 20% of MAIN pane

        // Find max volume in visible area
        let maxVol = 0;
        this.visibleData.forEach(c => maxVol = Math.max(maxVol, c.volume));

        if (maxVol === 0) return;

        this.visibleData.forEach((candle, i) => {
            const x = this.padding.left + (i * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
            const height = (candle.volume / maxVol) * maxVolumeHeight;
            const y = this.padding.top + this.layout.mainHeight - height;

            const isBullish = candle.close >= candle.open;
            ctx.fillStyle = isBullish ? this.colors.volumeBullish : this.colors.volumeBearish;

            ctx.fillRect(x, y, candleWidth, height);
        });
    }

    drawCycles(candleWidth, candleSpacing, startIndex, priceRange) {
        const ctx = this.ctx;

        this.cycles.forEach(cycle => {
            // Check if cycle is visible (simplified check, could be more robust)
            const cycleStartIdx = cycle.startIndex;
            const cycleEndIdx = cycle.endIndex;
            const visibleStartIdx = startIndex;
            const visibleEndIdx = startIndex + this.visibleData.length;

            if (cycleEndIdx < visibleStartIdx || cycleStartIdx > visibleEndIdx) {
                return; // Cycle is completely outside visible range
            }

            // Calculate coordinates
            const getX = (index) => {
                const visIndex = index - startIndex;
                return this.padding.left + (visIndex * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
            };

            const startX = getX(cycle.startIndex);
            const endX = getX(cycle.endIndex);

            const startY = this.priceToY(cycle.startPrice, priceRange);
            const endY = this.priceToY(cycle.endPrice, priceRange);

            // Draw Parabola
            if (this.showParabola) {
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(startX, startY);

                if (cycle.type === 'inverted') {
                    ctx.strokeStyle = '#3b82f6'; // Blue for Index Cycle (Low-High-Low)

                    // Inverted: Start(Low) -> Max(High) -> End(Low)
                    const maxPrice = cycle.maxPrice;
                    const maxY = this.priceToY(maxPrice, priceRange);
                    const maxX = this.padding.left + ((cycle.maxIndex - startIndex) * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);

                    // To ensure a smooth peak at Max, the control point's Y must match MaxY.
                    // Curve 1: Start -> Max
                    // Control point X is halfway between Start and Max
                    const cp1X = startX + (maxX - startX) / 2;
                    const cp1Y = maxY; // Horizontal tangent at Max

                    ctx.quadraticCurveTo(cp1X, cp1Y, maxX, maxY);

                    // Curve 2: Max -> End
                    const cp2X = maxX + (endX - maxX) / 2;
                    const cp2Y = maxY; // Horizontal tangent at Max

                    ctx.quadraticCurveTo(cp2X, cp2Y, endX, endY);

                } else {
                    ctx.strokeStyle = '#ef4444'; // Red for Inverse Cycle (High-Low-High)

                    // Normal: Start(High) -> Min(Low) -> End(High)
                    const minPrice = cycle.minPrice;
                    const minY = this.priceToY(minPrice, priceRange);
                    const minX = this.padding.left + ((cycle.minIndex - startIndex) * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);

                    // To ensure a smooth valley at Min, the control point's Y must match MinY.
                    // Curve 1: Start -> Min
                    const cp1X = startX + (minX - startX) / 2;
                    const cp1Y = minY; // Horizontal tangent at Min

                    ctx.quadraticCurveTo(cp1X, cp1Y, minX, minY);

                    // Curve 2: Min -> End
                    const cp2X = minX + (endX - minX) / 2;
                    const cp2Y = minY; // Horizontal tangent at Min

                    ctx.quadraticCurveTo(cp2X, cp2Y, endX, endY);
                }

                ctx.stroke();
            }

            // Draw Labels
            if (this.showLabels) {
                ctx.fillStyle = this.colors.cycleLabel;
                ctx.font = '12px Inter';
                ctx.textAlign = 'center';

                // Only End Label with Duration
                ctx.fillText(`Ciclo Fine (${cycle.duration})`, endX, endY - 10);
            }

            // Draw Start and End Red Circles
            if (this.showMin) {
                // Start Circle (Red)
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(startX, startY, 4, 0, Math.PI * 2);
                ctx.fill();

                // End Circle (Red)
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(endX, endY, 4, 0, Math.PI * 2);
                ctx.fill();

                // Draw Min/Max Dot (middle point)
                if (cycle.type === 'inverted') {
                    // Draw Max
                    const maxX = this.padding.left + ((cycle.maxIndex - startIndex) * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
                    const maxY = this.priceToY(cycle.maxPrice, priceRange);

                    ctx.fillStyle = this.colors.cycleMin;
                    ctx.beginPath();
                    ctx.arc(maxX, maxY, 3, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    // Draw Min
                    const minX = this.padding.left + ((cycle.minIndex - startIndex) * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
                    const minY = this.priceToY(cycle.minPrice, priceRange);

                    ctx.fillStyle = this.colors.cycleMin;
                    ctx.beginPath();
                    ctx.arc(minX, minY, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        });
    }

    drawProjections(candleWidth, candleSpacing, startIndex, priceRange) {
        if (this.cycles.length === 0) return;

        const ctx = this.ctx;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);

        // Helper to draw projection from a specific cycle
        const drawProjectionForCycle = (cycle) => {
            const projectStartIdx = cycle.endIndex;
            const projectStartPrice = cycle.endPrice;
            const isIndex = cycle.type === 'inverted'; // Logic swapped: Inverted is Index (Low-High-Low)

            // Color: Index (Inverted) -> Blue, Inverse (Normal) -> Red
            ctx.strokeStyle = isIndex ? '#3b82f6' : '#ef4444';

            const drawCurve = (duration) => {
                const endIdx = projectStartIdx + duration;

                // Coordinates
                const startX = this.padding.left + ((projectStartIdx - startIndex) * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
                const startY = this.priceToY(projectStartPrice, priceRange);

                const endX = this.padding.left + ((endIdx - startIndex) * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
                const endY = startY;

                // Draw schematic curve
                ctx.beginPath();
                ctx.moveTo(startX, startY);

                // Control point
                const cpX = startX + (endX - startX) / 2;

                // Height of projection curve
                // Index (Low-High-Low): Ends at Low. Next cycle goes High. Projection should arch UP?
                // Wait. Cycle: Min -> Max -> Min. End is Min. Next starts at Min.
                // The projection usually shows the NEXT cycle. 
                // Next Index Cycle: Min -> Max -> Min. So it goes UP.
                // Inverse Cycle (High-Low-High): Ends at Max. Next Starts at Max. Go DOWN.

                // isIndex (Low-High-Low) -> Inverted Type -> Ends Low -> Arch UP.
                // !isIndex (High-Low-High) -> Normal Type -> Ends High -> Arch DOWN.

                const heightOffset = this.layout.mainHeight * 0.2;
                // Subtracting Y goes UP on canvas. Adding Y goes DOWN.
                const cpY = isIndex ? startY - heightOffset : startY + heightOffset;

                ctx.quadraticCurveTo(cpX, cpY, endX, endY);
                ctx.stroke();

                // Label
                ctx.fillStyle = this.colors.text;
                ctx.font = '10px Inter';
                ctx.textAlign = 'center';
                ctx.fillText(`${duration}`, endX, endY + (isIndex ? -5 : 15));
            };

            drawCurve(this.minDuration);
            drawCurve(this.maxDuration);
        };

        // Find last Index Cycle (type: inverted)
        const lastIndexCycle = [...this.cycles].reverse().find(c => c.type === 'inverted');
        if (lastIndexCycle) drawProjectionForCycle(lastIndexCycle);

        // Find last Inverse Cycle (type: normal)
        const lastInverseCycle = [...this.cycles].reverse().find(c => c.type !== 'inverted');
        if (lastInverseCycle) drawProjectionForCycle(lastInverseCycle);
        console.log("Last Index:", lastIndexCycle); console.log("Last Inverse:", lastInverseCycle);

        ctx.setLineDash([]);
    }

    drawTargetLine(priceRange) {
        const ctx = this.ctx;
        const y = this.priceToY(this.targetLine.price, priceRange);

        // Draw horizontal line
        ctx.strokeStyle = '#8b5cf6'; // Purple color
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 5]);
        ctx.beginPath();
        ctx.moveTo(this.padding.left, y);
        ctx.lineTo(this.padding.left + this.chartWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw label with price and percentage
        ctx.fillStyle = '#8b5cf6';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'left';
        const labelText = `Target: ${this.targetLine.price.toFixed(2)} (-${this.targetLine.avgDrop.toFixed(2)}%)`;
        ctx.fillText(labelText, this.padding.left + 10, y - 5);
    }

    drawTPLines(priceRange) {
        const ctx = this.ctx;
        const { tp1, tp2, type } = this.tpLines;

        // TP1 Line - Dotted Gray
        const y1 = this.priceToY(tp1, priceRange);
        ctx.strokeStyle = '#9ca3af'; // Gray color
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]); // Dotted pattern
        ctx.beginPath();
        ctx.moveTo(this.padding.left, y1);
        ctx.lineTo(this.padding.left + this.chartWidth, y1);
        ctx.stroke();

        // TP1 Label
        ctx.fillStyle = '#9ca3af';
        ctx.font = '10px Inter';
        ctx.textAlign = 'right';
        ctx.fillText(`TP1: ${tp1.toFixed(4)}`, this.padding.left + this.chartWidth - 5, y1 - 5);

        // TP2 Line - Dotted Gray
        const y2 = this.priceToY(tp2, priceRange);
        ctx.beginPath();
        ctx.moveTo(this.padding.left, y2);
        ctx.lineTo(this.padding.left + this.chartWidth, y2);
        ctx.stroke();

        // TP2 Label
        ctx.fillText(`TP2: ${tp2.toFixed(4)}`, this.padding.left + this.chartWidth - 5, y2 - 5);

        ctx.setLineDash([]); // Reset dash
    }

    drawOpenPosition(priceRange) {
        const ctx = this.ctx;
        const { entryPrice, type, slPrice } = this.openPosition;

        // Entry Line - Solid colored line (green for LONG, red for SHORT)
        const entryY = this.priceToY(entryPrice, priceRange);
        const entryColor = type === 'LONG' ? '#10b981' : '#ef4444';

        ctx.strokeStyle = entryColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]); // Dashed pattern
        ctx.beginPath();
        ctx.moveTo(this.padding.left, entryY);
        ctx.lineTo(this.padding.left + this.chartWidth, entryY);
        ctx.stroke();

        // Entry Label with background
        const labelText = `${type} Entry: ${entryPrice.toFixed(4)}`;
        ctx.font = 'bold 10px Inter';
        const textWidth = ctx.measureText(labelText).width;

        // Label background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(this.padding.left + 5, entryY - 14, textWidth + 10, 16);

        // Label text
        ctx.fillStyle = entryColor;
        ctx.textAlign = 'left';
        ctx.fillText(labelText, this.padding.left + 10, entryY - 3);

        // SL Line - Dashed red line
        if (slPrice) {
            const slY = this.priceToY(slPrice, priceRange);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(this.padding.left, slY);
            ctx.lineTo(this.padding.left + this.chartWidth, slY);
            ctx.stroke();

            // SL Label
            ctx.fillStyle = '#ef4444';
            ctx.font = '10px Inter';
            ctx.textAlign = 'right';
            ctx.fillText(`SL: ${slPrice.toFixed(4)}`, this.padding.left + this.chartWidth - 5, slY - 5);
        }

        ctx.setLineDash([]); // Reset dash
    }

    drawRangeEndLine(candleWidth, candleSpacing, startIndex) {
        const ctx = this.ctx;
        const rangeEndIndex = this.rangeEndLine.index;
        const barsRemaining = rangeEndIndex - (this.data.length - 1);

        // Only draw if the line is visible (within visible data range or slightly ahead)
        if (rangeEndIndex < startIndex || rangeEndIndex > startIndex + this.visibleData.length + 20) {
            return;
        }

        // Calculate X position
        const x = this.padding.left + ((rangeEndIndex - startIndex) * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);

        // Draw vertical dashed line
        const lineColor = this.rangeEndLine.color || '#f59e0b'; // Use passed color or default Amber
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(x, this.padding.top);
        ctx.lineTo(x, this.padding.top + this.layout.mainHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw label at top
        ctx.fillStyle = lineColor;
        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'center';

        const labelText = barsRemaining > 0 ? `Max ${this.rangeEndLine.maxDuration} (${barsRemaining} left)` : `Max ${this.rangeEndLine.maxDuration}`;
        ctx.fillText(labelText, x, this.padding.top + 12);
    }

    drawCandle(candle, x, width, priceRange) {
        const ctx = this.ctx;
        const isBullish = candle.close >= candle.open;
        const color = isBullish ? this.colors.bullish : this.colors.bearish;

        const openY = this.priceToY(candle.open, priceRange);
        const closeY = this.priceToY(candle.close, priceRange);
        const highY = this.priceToY(candle.high, priceRange);
        const lowY = this.priceToY(candle.low, priceRange);

        // Draw wick
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + width / 2, highY);
        ctx.lineTo(x + width / 2, lowY);
        ctx.stroke();

        // Draw body
        const bodyHeight = Math.abs(closeY - openY);
        const bodyY = Math.min(openY, closeY);

        if (isBullish) {
            ctx.fillStyle = color;
        } else {
            ctx.fillStyle = color;
        }

        ctx.fillRect(x, bodyY, width, Math.max(bodyHeight, 1));

        // Highlight if hovered
        if (this.hoveredCandle === candle) {
            ctx.strokeStyle = this.colors.textPrimary;
            ctx.lineWidth = 2;
            ctx.strokeRect(x - 1, bodyY - 1, width + 2, Math.max(bodyHeight, 1) + 2);
        }
    }

    drawAxes(priceRange) {
        const ctx = this.ctx;
        ctx.fillStyle = this.colors.text;
        ctx.font = '11px Inter';

        // Price axis (right)
        const priceSteps = 8;
        for (let i = 0; i <= priceSteps; i++) {
            const price = priceRange.min + (priceRange.max - priceRange.min) * (1 - i / priceSteps);
            const y = this.padding.top + (this.layout.mainHeight / priceSteps) * i;

            ctx.textAlign = 'left';
            ctx.fillText(price.toFixed(3), this.padding.left + this.chartWidth + 10, y + 4);
        }

        // Time axis (bottom)
        const { candleWidth, candleSpacing } = this.calculateVisibleData();
        const timeSteps = Math.min(10, this.visibleData.length);
        const step = Math.max(1, Math.floor(this.visibleData.length / timeSteps));

        for (let i = 0; i < this.visibleData.length; i += step) {
            const candle = this.visibleData[i];
            const x = this.padding.left + (i * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);

            if (x >= this.padding.left && x <= this.padding.left + this.chartWidth) {
                const date = new Date(candle.time);
                const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

                ctx.textAlign = 'center';
                ctx.fillText(timeStr, x, this.padding.top + this.chartHeight + 20);
            }
        }
    }

    drawIndicatorPane(candleWidth, candleSpacing, startIndex) {
        const ctx = this.ctx;
        const top = this.layout.separatorY + this.layout.gap / 2;
        const height = this.layout.indicatorHeight;

        // Title
        ctx.fillStyle = this.colors.text;
        ctx.font = '12px Inter';
        ctx.textAlign = 'left';
        ctx.fillText('Cycle Swing Momentum', this.padding.left + 10, top + 20);

        if (this.momentumValues.length === 0) return;

        // Calculate Range for Indicator
        let minVal = Infinity;
        let maxVal = -Infinity;

        // Only consider visible data for range scaling
        this.visibleData.forEach((_, i) => {
            const dataIndex = startIndex + i;
            if (dataIndex < this.momentumValues.length) {
                const val = this.momentumValues[dataIndex];
                if (!isNaN(val)) {
                    minVal = Math.min(minVal, val);
                    maxVal = Math.max(maxVal, val);
                }
            }
        });

        if (minVal === Infinity) { minVal = -1; maxVal = 1; }

        // Add padding to range
        const rangePadding = (maxVal - minVal) * 0.1;
        const range = { min: minVal - rangePadding, max: maxVal + rangePadding };

        // Draw Zero Line
        const zeroY = this.indicatorToY(0, range);
        ctx.strokeStyle = this.colors.momentumLine;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(this.padding.left, zeroY);
        ctx.lineTo(this.padding.left + this.chartWidth, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw Area
        // We draw bars or area? Pine script uses `plot.style_area`.
        // Let's draw as area.

        ctx.lineWidth = 2;

        // We need to draw segments because color changes based on value > 0 or < 0
        // Actually, we can draw a path for the line, and fill below/above zero?
        // Or just draw vertical bars for simplicity and performance?
        // "Cycle Swing Momentum" is usually a smooth curve.
        // Let's draw the line first.

        // To handle color changes (Green/Red), we can use a gradient or draw segments.
        // Simplest robust way: Draw the line. Then fill area.
        // But the user wants "Green Phase" and "Red Phase".
        // Let's draw filled polygons for positive and negative parts.

        // Draw Positive Area
        ctx.fillStyle = this.colors.momentumBullish;
        ctx.beginPath();
        let started = false;

        for (let i = 0; i < this.visibleData.length; i++) {
            const dataIndex = startIndex + i;
            if (dataIndex >= this.momentumValues.length) break;

            const val = this.momentumValues[dataIndex];
            const x = this.padding.left + (i * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
            const y = this.indicatorToY(Math.max(0, val), range); // Clamp to 0 for positive area
            const zero = this.indicatorToY(0, range);

            if (val >= 0) {
                if (!started) {
                    ctx.moveTo(x, zero);
                    started = true;
                }
                ctx.lineTo(x, y);
            } else if (started) {
                ctx.lineTo(x, zero);
                started = false;
            }
        }
        if (started) {
            const lastI = this.visibleData.length - 1;
            const lastX = this.padding.left + (lastI * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
            const zero = this.indicatorToY(0, range);
            ctx.lineTo(lastX, zero);
        }
        ctx.fill();

        // Draw Negative Area
        ctx.fillStyle = this.colors.momentumBearish;
        ctx.beginPath();
        started = false;

        for (let i = 0; i < this.visibleData.length; i++) {
            const dataIndex = startIndex + i;
            if (dataIndex >= this.momentumValues.length) break;

            const val = this.momentumValues[dataIndex];
            const x = this.padding.left + (i * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
            const y = this.indicatorToY(Math.min(0, val), range);
            const zero = this.indicatorToY(0, range);

            if (val < 0) {
                if (!started) {
                    ctx.moveTo(x, zero);
                    started = true;
                }
                ctx.lineTo(x, y);
            } else if (started) {
                ctx.lineTo(x, zero);
                started = false;
            }
        }
        if (started) {
            const lastI = this.visibleData.length - 1;
            const lastX = this.padding.left + (lastI * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
            const zero = this.indicatorToY(0, range);
            ctx.lineTo(lastX, zero);
        }
        ctx.fill();

        // Draw the Line on top
        ctx.strokeStyle = this.colors.cycleLine; // Reuse blue color or make new one
        ctx.beginPath();

        this.visibleData.forEach((_, i) => {
            const dataIndex = startIndex + i;
            if (dataIndex >= this.momentumValues.length) return;

            const val = this.momentumValues[dataIndex];
            const x = this.padding.left + (i * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
            const y = this.indicatorToY(val, range);

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw Divergences
        if (this.divergences && this.divergences.length > 0) {
            this.divergences.forEach(div => {
                // Check if visible
                if (div.index < startIndex || div.index >= startIndex + this.visibleData.length) return;

                const x = this.padding.left + ((div.index - startIndex) * (candleWidth + candleSpacing)) + this.panOffset % (candleWidth + candleSpacing);
                const val = this.momentumValues[div.index];
                const y = this.indicatorToY(val, range);

                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);

                if (div.type.includes('bullish')) {
                    ctx.fillStyle = div.type.includes('hidden') ? '#a1a1aa' : '#10b981'; // Silver for hidden, Green for regular
                } else {
                    ctx.fillStyle = div.type.includes('hidden') ? '#a1a1aa' : '#ef4444'; // Silver for hidden, Red for regular
                }

                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.stroke();
            });
        }
    }

    drawCrosshair() {
        const ctx = this.ctx;
        ctx.strokeStyle = this.colors.crosshair;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);

        // Vertical line
        ctx.beginPath();
        ctx.moveTo(this.mouseX, this.padding.top);
        ctx.lineTo(this.mouseX, this.padding.top + this.chartHeight);
        ctx.stroke();

        // Horizontal line
        ctx.beginPath();
        ctx.moveTo(this.padding.left, this.mouseY);
        ctx.lineTo(this.padding.left + this.chartWidth, this.mouseY);
        ctx.stroke();

        ctx.setLineDash([]);
    }

    updateHover() {
        if (this.mouseX < this.padding.left || this.mouseX > this.padding.left + this.chartWidth ||
            this.mouseY < this.padding.top || this.mouseY > this.padding.top + this.chartHeight) {
            this.hoveredCandle = null;
            this.hideTooltip();
            this.render();
            return;
        }

        const { candleWidth, candleSpacing } = this.calculateVisibleData();
        const relativeX = this.mouseX - this.padding.left - (this.panOffset % (candleWidth + candleSpacing));
        const candleIndex = Math.floor(relativeX / (candleWidth + candleSpacing));

        if (candleIndex >= 0 && candleIndex < this.visibleData.length) {
            this.hoveredCandle = this.visibleData[candleIndex];
            this.showTooltip(this.hoveredCandle);
            this.render();
        } else {
            this.hoveredCandle = null;
            this.hideTooltip();
            this.render();
        }
    }

    showTooltip(candle) {
        const tooltip = document.getElementById('price-info');
        tooltip.classList.add('visible');

        document.getElementById('info-open').textContent = candle.open.toFixed(2);
        document.getElementById('info-high').textContent = candle.high.toFixed(2);
        document.getElementById('info-low').textContent = candle.low.toFixed(2);
        document.getElementById('info-close').textContent = candle.close.toFixed(2);

        const date = new Date(candle.time);
        document.getElementById('info-time').textContent = date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    hideTooltip() {
        const tooltip = document.getElementById('price-info');
        tooltip.classList.remove('visible');
    }
}
