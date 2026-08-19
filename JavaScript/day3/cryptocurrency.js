const CONFIG = Object.freeze({
    API_URL: 'https://api4.binance.com/api/v3/ticker/24hr',
    QUOTE_ASSET: 'USDT',
    REFRESH_MS: 1000,
    HEATMAP_LIMIT: 48,
    MOVERS_LIMIT: 5,
    FAVORITES_LIMIT: 8,
    TABLE_STEP: 80,
    HISTORY_LIMIT: 30,
    MAX_COLOR_CHANGE: 10
});

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

function toFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeTickers(rawData) {
    if (!Array.isArray(rawData)) return [];

    return rawData
        .filter((item) => {
            const symbol = typeof item.symbol === 'string' ? item.symbol : '';
            return symbol.endsWith(CONFIG.QUOTE_ASSET) && toFiniteNumber(item.lastPrice) > 0;
        })
        .map((item) => ({
            symbol: item.symbol,
            baseAsset: item.symbol.slice(0, -CONFIG.QUOTE_ASSET.length),
            quoteAsset: CONFIG.QUOTE_ASSET,
            lastPrice: toFiniteNumber(item.lastPrice),
            changePercent: toFiniteNumber(item.priceChangePercent),
            highPrice: toFiniteNumber(item.highPrice),
            lowPrice: toFiniteNumber(item.lowPrice),
            openPrice: toFiniteNumber(item.openPrice),
            weightedAvgPrice: toFiniteNumber(item.weightedAvgPrice),
            volume: toFiniteNumber(item.volume),
            quoteVolume: Math.max(0, toFiniteNumber(item.quoteVolume)),
            tradeCount: Math.max(0, Math.trunc(toFiniteNumber(item.count)))
        }));
}

function calculateRangePosition(currentPrice, lowPrice, highPrice) {
    const current = toFiniteNumber(currentPrice);
    const low = toFiniteNumber(lowPrice);
    const high = toFiniteNumber(highPrice);

    if (high <= low) return 50;
    return clamp(((current - low) / (high - low)) * 100, 0, 100);
}

function getPriceDirection(currentPrice, previousPrice) {
    if (!Number.isFinite(previousPrice)) return 'initial';
    if (currentPrice > previousPrice) return 'up';
    if (currentPrice < previousPrice) return 'down';
    return 'flat';
}

function calculateTileSpans(quoteVolume, minLog, maxLog, limits = {}) {
    const maxColumns = Math.max(1, Math.trunc(limits.maxColumns || 4));
    const maxRows = Math.max(1, Math.trunc(limits.maxRows || 3));
    const volumeLog = Math.log10(Math.max(0, toFiniteNumber(quoteVolume)) + 1);
    const logRange = maxLog - minLog;
    const score = logRange > 0 ? clamp((volumeLog - minLog) / logRange, 0, 1) : 0.5;

    return {
        columns: 1 + Math.round(score * (maxColumns - 1)),
        rows: 1 + Math.round(score * (maxRows - 1)),
        score
    };
}

function calculateMarketSummary(data) {
    const validData = Array.isArray(data) ? data : [];
    const summary = validData.reduce((result, item) => {
        const change = toFiniteNumber(item.changePercent);
        result.totalQuoteVolume += Math.max(0, toFiniteNumber(item.quoteVolume));
        result.changeTotal += change;

        if (change > 0) result.advancers += 1;
        else if (change < 0) result.decliners += 1;
        else result.unchanged += 1;

        return result;
    }, {
        total: validData.length,
        advancers: 0,
        decliners: 0,
        unchanged: 0,
        totalQuoteVolume: 0,
        changeTotal: 0,
        averageChange: 0
    });

    summary.averageChange = summary.total ? summary.changeTotal / summary.total : 0;
    delete summary.changeTotal;
    return summary;
}

function getHeatColors(changePercent) {
    const change = toFiniteNumber(changePercent);
    const strength = clamp(Math.abs(change) / CONFIG.MAX_COLOR_CHANGE, 0, 1);

    if (change > 0) {
        return {
            background: `hsl(153 48% ${14 + strength * 17}%)`,
            border: `hsl(153 55% ${28 + strength * 24}%)`
        };
    }

    if (change < 0) {
        return {
            background: `hsl(354 48% ${15 + strength * 18}%)`,
            border: `hsl(354 58% ${29 + strength * 24}%)`
        };
    }

    return {
        background: 'hsl(205 14% 17%)',
        border: 'hsl(205 14% 29%)'
    };
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        normalizeTickers,
        calculateRangePosition,
        getPriceDirection,
        calculateTileSpans,
        calculateMarketSummary
    };
}

if (typeof document !== 'undefined') {
    const state = {
        data: [],
        favorites: loadFavorites(),
        currentTab: 'all',
        searchTerm: '',
        selectedSymbol: '',
        directions: new Map(),
        priceHistory: new Map(),
        sortKey: 'quoteVolume',
        sortDirection: 'desc',
        visibleRows: CONFIG.TABLE_STEP,
        isLoading: false,
        lastUpdated: null,
        nextRefreshAt: null,
        toastTimer: null,
        resizeTimer: null
    };

    let elements = {};

    function loadFavorites() {
        try {
            const saved = JSON.parse(localStorage.getItem('cryptoFavorites'));
            return Array.isArray(saved) ? saved.filter((item) => typeof item === 'string') : [];
        } catch (error) {
            return [];
        }
    }

    function saveFavorites() {
        try {
            localStorage.setItem('cryptoFavorites', JSON.stringify(state.favorites));
        } catch (error) {
            console.warn('관심 종목을 브라우저 저장소에 저장하지 못했습니다.', error);
        }
    }

    function cacheElements() {
        elements = {
            tabs: Array.from(document.querySelectorAll('[data-tab]')),
            searchInput: document.getElementById('searchInput'),
            refreshButton: document.getElementById('refreshButton'),
            favoriteCount: document.getElementById('favoriteCount'),
            connectionState: document.getElementById('connectionState'),
            connectionText: document.getElementById('connectionText'),
            countdown: document.getElementById('countdown'),
            currentClock: document.getElementById('currentClock'),
            errorBanner: document.getElementById('errorBanner'),
            errorMessage: document.getElementById('errorMessage'),
            summaryTotal: document.getElementById('summaryTotal'),
            summaryAdvancers: document.getElementById('summaryAdvancers'),
            summaryAdvanceRate: document.getElementById('summaryAdvanceRate'),
            summaryDecliners: document.getElementById('summaryDecliners'),
            summaryDeclineRate: document.getElementById('summaryDeclineRate'),
            summaryAverage: document.getElementById('summaryAverage'),
            summaryVolume: document.getElementById('summaryVolume'),
            breadthText: document.getElementById('breadthText'),
            breadthUp: document.getElementById('breadthUp'),
            breadthFlat: document.getElementById('breadthFlat'),
            breadthDown: document.getElementById('breadthDown'),
            loadingState: document.getElementById('loadingState'),
            heatmap: document.getElementById('heatmap'),
            heatmapEmpty: document.getElementById('heatmapEmpty'),
            selectedFavoriteButton: document.getElementById('selectedFavoriteButton'),
            selectedEmpty: document.getElementById('selectedEmpty'),
            selectedContent: document.getElementById('selectedContent'),
            selectedSymbol: document.getElementById('selectedSymbol'),
            selectedPair: document.getElementById('selectedPair'),
            selectedPrice: document.getElementById('selectedPrice'),
            selectedChange: document.getElementById('selectedChange'),
            sparkline: document.getElementById('sparkline'),
            sessionChange: document.getElementById('sessionChange'),
            selectedOpen: document.getElementById('selectedOpen'),
            selectedHigh: document.getElementById('selectedHigh'),
            selectedLow: document.getElementById('selectedLow'),
            selectedVolume: document.getElementById('selectedVolume'),
            selectedRangeText: document.getElementById('selectedRangeText'),
            selectedRangeBar: document.getElementById('selectedRangeBar'),
            topGainers: document.getElementById('topGainers'),
            topLosers: document.getElementById('topLosers'),
            favoritesList: document.getElementById('favoritesList'),
            table: document.getElementById('cryptoTable'),
            cryptoList: document.getElementById('cryptoList'),
            tableStatus: document.getElementById('tableStatus'),
            tableEmpty: document.getElementById('tableEmpty'),
            loadMoreButton: document.getElementById('loadMoreButton'),
            lastUpdated: document.getElementById('lastUpdated'),
            toast: document.getElementById('toast')
        };
    }

    function bindEvents() {
        elements.tabs.forEach((tab) => {
            tab.addEventListener('click', () => setCurrentTab(tab.dataset.tab));
        });

        elements.searchInput.addEventListener('input', (event) => {
            state.searchTerm = event.target.value.trim().toUpperCase();
            state.visibleRows = CONFIG.TABLE_STEP;
            renderDashboard();
        });

        elements.refreshButton.addEventListener('click', () => fetchCryptoData(true));
        elements.selectedFavoriteButton.addEventListener('click', () => {
            if (state.selectedSymbol) toggleFavorite(state.selectedSymbol);
        });

        elements.heatmap.addEventListener('click', handleSymbolSelection);
        elements.topGainers.addEventListener('click', handleSymbolSelection);
        elements.topLosers.addEventListener('click', handleSymbolSelection);
        elements.favoritesList.addEventListener('click', handleSymbolSelection);

        elements.table.addEventListener('click', (event) => {
            const favoriteButton = event.target.closest('[data-favorite-symbol]');
            if (favoriteButton) {
                toggleFavorite(favoriteButton.dataset.favoriteSymbol);
                return;
            }

            const symbolButton = event.target.closest('[data-symbol]');
            if (symbolButton) selectSymbol(symbolButton.dataset.symbol);
        });

        elements.table.querySelectorAll('[data-sort]').forEach((button) => {
            button.addEventListener('click', () => changeSort(button.dataset.sort));
        });

        elements.loadMoreButton.addEventListener('click', () => {
            state.visibleRows += CONFIG.TABLE_STEP;
            renderTable(getFilteredData());
        });

        window.addEventListener('resize', () => {
            window.clearTimeout(state.resizeTimer);
            state.resizeTimer = window.setTimeout(() => renderHeatmap(getFilteredData()), 120);
        });
    }

    function setCurrentTab(tabName) {
        state.currentTab = tabName === 'favorites' ? 'favorites' : 'all';
        state.visibleRows = CONFIG.TABLE_STEP;

        elements.tabs.forEach((tab) => {
            const active = tab.dataset.tab === state.currentTab;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', String(active));
        });

        renderDashboard();
    }

    function handleSymbolSelection(event) {
        const target = event.target.closest('[data-symbol]');
        if (target) selectSymbol(target.dataset.symbol);
    }

    function selectSymbol(symbol) {
        if (!state.data.some((item) => item.symbol === symbol)) return;
        state.selectedSymbol = symbol;
        renderHeatmap(getFilteredData());
        renderSelectedAsset();
        renderTable(getFilteredData());
    }

    function toggleFavorite(symbol) {
        const index = state.favorites.indexOf(symbol);
        const willRemove = index >= 0;

        if (willRemove) state.favorites.splice(index, 1);
        else state.favorites.push(symbol);

        saveFavorites();
        showToast(`${symbol} 관심 종목 ${willRemove ? '해제' : '등록'}`);
        renderDashboard();
    }

    function changeSort(sortKey) {
        if (state.sortKey === sortKey) {
            state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            state.sortKey = sortKey;
            state.sortDirection = sortKey === 'symbol' ? 'asc' : 'desc';
        }

        state.visibleRows = CONFIG.TABLE_STEP;
        renderTable(getFilteredData());
    }

    async function fetchCryptoData(isManualRefresh = false) {
        if (state.isLoading) return;

        state.isLoading = true;
        setConnectionState('loading', isManualRefresh ? 'REFRESHING' : 'UPDATING');
        elements.refreshButton.disabled = true;
        elements.refreshButton.classList.add('is-loading');
        elements.errorBanner.hidden = true;

        if (state.data.length === 0) {
            elements.loadingState.hidden = false;
            elements.heatmap.hidden = true;
        }

        try {
            const response = await fetch(CONFIG.API_URL, { cache: 'no-store' });
            if (!response.ok) throw new Error(`API 응답 오류: HTTP ${response.status}`);

            const rawData = await response.json();
            const normalizedData = normalizeTickers(rawData)
                .sort((a, b) => b.quoteVolume - a.quoteVolume);

            if (normalizedData.length === 0) {
                throw new Error('유효한 USDT 거래쌍을 찾지 못했습니다.');
            }

            updatePriceTracking(normalizedData);
            state.data = normalizedData;
            state.lastUpdated = new Date();
            state.nextRefreshAt = Date.now() + CONFIG.REFRESH_MS;

            if (!state.selectedSymbol || !state.data.some((item) => item.symbol === state.selectedSymbol)) {
                state.selectedSymbol = state.data[0].symbol;
            }

            elements.loadingState.hidden = true;
            elements.heatmap.hidden = false;
            setConnectionState('online', 'LIVE');
            renderDashboard();
        } catch (error) {
            console.error('시장 데이터 조회 오류:', error);
            state.nextRefreshAt = Date.now() + CONFIG.REFRESH_MS;
            setConnectionState('error', 'OFFLINE');
            elements.errorMessage.textContent = error.message || '시장 데이터를 불러오지 못했습니다.';
            elements.errorBanner.hidden = false;

            if (state.data.length === 0) {
                elements.loadingState.hidden = true;
                elements.heatmap.hidden = true;
                elements.heatmapEmpty.hidden = false;
            }
        } finally {
            state.isLoading = false;
            elements.refreshButton.disabled = false;
            elements.refreshButton.classList.remove('is-loading');
        }
    }

    function updatePriceTracking(nextData) {
        const previousPrices = new Map(state.data.map((item) => [item.symbol, item.lastPrice]));
        const nextDirections = new Map();
        const now = Date.now();

        nextData.forEach((item) => {
            const previousPrice = previousPrices.get(item.symbol);
            nextDirections.set(item.symbol, getPriceDirection(item.lastPrice, previousPrice));

            const history = state.priceHistory.get(item.symbol) || [];
            history.push({ time: now, price: item.lastPrice });
            if (history.length > CONFIG.HISTORY_LIMIT) history.splice(0, history.length - CONFIG.HISTORY_LIMIT);
            state.priceHistory.set(item.symbol, history);
        });

        state.directions = nextDirections;
    }

    function getFilteredData() {
        return state.data.filter((item) => {
            const matchesSearch = !state.searchTerm
                || item.symbol.includes(state.searchTerm)
                || item.baseAsset.includes(state.searchTerm);
            const matchesTab = state.currentTab === 'all' || state.favorites.includes(item.symbol);
            return matchesSearch && matchesTab;
        });
    }

    function renderDashboard() {
        const filteredData = getFilteredData();

        if (filteredData.length > 0 && !filteredData.some((item) => item.symbol === state.selectedSymbol)) {
            state.selectedSymbol = filteredData[0].symbol;
        }

        renderFavoriteCount();
        renderSummary(filteredData);
        renderHeatmap(filteredData);
        renderSelectedAsset();
        renderMovers(filteredData);
        renderFavorites();
        renderTable(filteredData);
        renderLastUpdated();
    }

    function renderFavoriteCount() {
        elements.favoriteCount.textContent = String(state.favorites.length);
    }

    function renderSummary(data) {
        const summary = calculateMarketSummary(data);
        const safeTotal = summary.total || 1;
        const advanceRate = (summary.advancers / safeTotal) * 100;
        const declineRate = (summary.decliners / safeTotal) * 100;
        const flatRate = (summary.unchanged / safeTotal) * 100;

        elements.summaryTotal.textContent = formatInteger(summary.total);
        elements.summaryAdvancers.textContent = formatInteger(summary.advancers);
        elements.summaryAdvanceRate.textContent = `${advanceRate.toFixed(1)}%`;
        elements.summaryDecliners.textContent = formatInteger(summary.decliners);
        elements.summaryDeclineRate.textContent = `${declineRate.toFixed(1)}%`;
        elements.summaryAverage.textContent = formatPercent(summary.averageChange);
        elements.summaryAverage.className = getChangeClass(summary.averageChange);
        elements.summaryVolume.textContent = `${formatCompact(summary.totalQuoteVolume)} USDT`;
        elements.breadthText.textContent = `상승 ${summary.advancers} · 하락 ${summary.decliners} · 보합 ${summary.unchanged}`;
        elements.breadthUp.style.width = `${advanceRate}%`;
        elements.breadthFlat.style.width = `${flatRate}%`;
        elements.breadthDown.style.width = `${declineRate}%`;
    }

    function renderHeatmap(data) {
        const heatmapData = [...data]
            .sort((a, b) => b.quoteVolume - a.quoteVolume)
            .slice(0, CONFIG.HEATMAP_LIMIT);

        elements.heatmap.innerHTML = '';
        elements.heatmapEmpty.hidden = heatmapData.length > 0;
        elements.heatmap.hidden = heatmapData.length === 0;

        if (heatmapData.length === 0) return;

        const volumeLogs = heatmapData.map((item) => Math.log10(item.quoteVolume + 1));
        const minLog = Math.min(...volumeLogs);
        const maxLog = Math.max(...volumeLogs);
        const spanLimits = getResponsiveSpanLimits();
        const fragment = document.createDocumentFragment();

        heatmapData.forEach((item) => {
            const spans = calculateTileSpans(item.quoteVolume, minLog, maxLog, spanLimits);
            const colors = getHeatColors(item.changePercent);
            const rangePosition = calculateRangePosition(item.lastPrice, item.lowPrice, item.highPrice);
            const direction = state.directions.get(item.symbol) || 'initial';
            const tileArea = spans.columns * spans.rows;
            const tile = document.createElement('button');

            tile.type = 'button';
            tile.className = [
                'market-tile',
                tileArea <= 2 ? 'tile-compact' : '',
                state.selectedSymbol === item.symbol ? 'is-selected' : '',
                direction === 'up' ? 'flash-up' : '',
                direction === 'down' ? 'flash-down' : ''
            ].filter(Boolean).join(' ');
            tile.dataset.symbol = item.symbol;
            tile.style.setProperty('--column-span', spans.columns);
            tile.style.setProperty('--row-span', spans.rows);
            tile.style.setProperty('--tile-bg', colors.background);
            tile.style.setProperty('--tile-border', colors.border);
            tile.style.setProperty('--range-position', `${rangePosition}%`);
            tile.title = `${item.symbol} · 현재가 ${formatPrice(item.lastPrice)} · 24H ${formatPercent(item.changePercent)} · 거래대금 ${formatCompact(item.quoteVolume)} USDT`;
            tile.setAttribute('aria-label', tile.title);
            tile.innerHTML = `
                <span class="tile-head">
                    <span class="tile-symbol">${escapeHtml(item.baseAsset)}</span>
                    <span class="tile-pair">/USDT</span>
                </span>
                <span class="tile-main">
                    <span class="tile-price">${formatPrice(item.lastPrice)}</span>
                    <span class="tile-change">${formatPercent(item.changePercent)}</span>
                </span>
                <span class="tile-foot">
                    <span class="tile-foot-row">
                        <span class="tile-volume">VOL ${formatCompact(item.quoteVolume)}</span>
                        <span class="tile-range-label">RANGE ${rangePosition.toFixed(0)}%</span>
                    </span>
                    <span class="tile-range"><span></span></span>
                </span>
            `;
            fragment.appendChild(tile);
        });

        elements.heatmap.appendChild(fragment);
    }

    function getResponsiveSpanLimits() {
        const width = window.innerWidth;
        if (width <= 420) return { maxColumns: 2, maxRows: 2 };
        if (width <= 680) return { maxColumns: 3, maxRows: 2 };
        if (width <= 1250) return { maxColumns: 4, maxRows: 3 };
        return { maxColumns: 5, maxRows: 3 };
    }

    function renderSelectedAsset() {
        const item = state.data.find((ticker) => ticker.symbol === state.selectedSymbol);

        if (!item) {
            elements.selectedEmpty.hidden = false;
            elements.selectedContent.hidden = true;
            elements.selectedFavoriteButton.disabled = true;
            return;
        }

        const rangePosition = calculateRangePosition(item.lastPrice, item.lowPrice, item.highPrice);
        const history = state.priceHistory.get(item.symbol) || [];
        const firstPrice = history.length ? history[0].price : item.lastPrice;
        const sessionPercent = firstPrice ? ((item.lastPrice - firstPrice) / firstPrice) * 100 : 0;
        const isFavorite = state.favorites.includes(item.symbol);

        elements.selectedEmpty.hidden = true;
        elements.selectedContent.hidden = false;
        elements.selectedFavoriteButton.disabled = false;
        elements.selectedFavoriteButton.textContent = isFavorite ? '★' : '☆';
        elements.selectedFavoriteButton.classList.toggle('is-favorite', isFavorite);
        elements.selectedFavoriteButton.setAttribute('aria-label', `${item.symbol} 관심 종목 ${isFavorite ? '해제' : '등록'}`);
        elements.selectedSymbol.textContent = item.baseAsset;
        elements.selectedPair.textContent = item.symbol;
        elements.selectedPrice.textContent = formatPrice(item.lastPrice);
        setChangeText(elements.selectedChange, item.changePercent);
        setChangeText(elements.sessionChange, sessionPercent);
        elements.selectedOpen.textContent = formatPrice(item.openPrice);
        elements.selectedHigh.textContent = formatPrice(item.highPrice);
        elements.selectedLow.textContent = formatPrice(item.lowPrice);
        elements.selectedVolume.textContent = `${formatCompact(item.quoteVolume)} USDT`;
        elements.selectedRangeText.textContent = `${rangePosition.toFixed(1)}%`;
        elements.selectedRangeBar.style.width = `${rangePosition}%`;
        elements.sparkline.innerHTML = createSparkline(history, item.changePercent);
    }

    function createSparkline(history, changePercent) {
        const width = 300;
        const height = 82;
        const padding = 8;
        const prices = history.map((point) => point.price);
        const plotPrices = prices.length > 1 ? prices : [prices[0] || 0, prices[0] || 0];
        const minimum = Math.min(...plotPrices);
        const maximum = Math.max(...plotPrices);
        const range = maximum - minimum || 1;
        const color = changePercent > 0 ? '#25c78a' : changePercent < 0 ? '#ff6070' : '#7e8b96';
        const points = plotPrices.map((price, index) => {
            const x = padding + (index / Math.max(plotPrices.length - 1, 1)) * (width - padding * 2);
            const y = height - padding - ((price - minimum) / range) * (height - padding * 2);
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(' ');

        return `
            <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="현재 브라우저 세션에서 수집한 가격 흐름">
                <line x1="${padding}" y1="${height / 2}" x2="${width - padding}" y2="${height / 2}" stroke="#253039" stroke-width="1" stroke-dasharray="3 4"></line>
                <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></polyline>
                <circle cx="${points.split(' ').at(-1).split(',')[0]}" cy="${points.split(' ').at(-1).split(',')[1]}" r="3" fill="${color}"></circle>
            </svg>
        `;
    }

    function renderMovers(data) {
        const gainers = data
            .filter((item) => item.changePercent > 0)
            .sort((a, b) => b.changePercent - a.changePercent)
            .slice(0, CONFIG.MOVERS_LIMIT);
        const losers = data
            .filter((item) => item.changePercent < 0)
            .sort((a, b) => a.changePercent - b.changePercent)
            .slice(0, CONFIG.MOVERS_LIMIT);

        renderMoverList(elements.topGainers, gainers, 'up');
        renderMoverList(elements.topLosers, losers, 'down');
    }

    function renderMoverList(container, data, direction) {
        if (data.length === 0) {
            container.innerHTML = '<span class="mover-list-empty">표시할 데이터 없음</span>';
            return;
        }

        container.innerHTML = data.map((item, index) => `
            <button class="mover-row" type="button" data-symbol="${escapeHtml(item.symbol)}">
                <span class="mover-rank">${String(index + 1).padStart(2, '0')}</span>
                <span class="mover-symbol">${escapeHtml(item.baseAsset)}</span>
                <span class="mover-change ${direction === 'up' ? 'is-up' : 'is-down'}">${formatPercent(item.changePercent)}</span>
            </button>
        `).join('');
    }

    function renderFavorites() {
        const favoriteData = state.favorites
            .map((symbol) => state.data.find((item) => item.symbol === symbol))
            .filter(Boolean)
            .sort((a, b) => b.quoteVolume - a.quoteVolume)
            .slice(0, CONFIG.FAVORITES_LIMIT);

        if (favoriteData.length === 0) {
            elements.favoritesList.innerHTML = '<span class="favorite-list-empty">표 또는 선택 패널의 ☆를 눌러 관심 종목을 등록하세요.</span>';
            return;
        }

        elements.favoritesList.innerHTML = favoriteData.map((item) => `
            <button class="favorite-row" type="button" data-symbol="${escapeHtml(item.symbol)}">
                <span class="favorite-symbol">${escapeHtml(item.baseAsset)}</span>
                <span class="favorite-price">${formatPrice(item.lastPrice)}</span>
                <span class="favorite-change ${getChangeClass(item.changePercent)}">${formatPercent(item.changePercent)}</span>
            </button>
        `).join('');
    }

    function renderTable(data) {
        const sortedData = sortData(data);
        const visibleData = sortedData.slice(0, state.visibleRows);
        const fragment = document.createDocumentFragment();

        elements.cryptoList.innerHTML = '';
        elements.tableEmpty.hidden = sortedData.length > 0;
        elements.table.hidden = sortedData.length === 0;
        elements.loadMoreButton.hidden = visibleData.length >= sortedData.length || sortedData.length === 0;
        elements.loadMoreButton.textContent = `더 보기 (${visibleData.length}/${sortedData.length})`;
        elements.tableStatus.textContent = `${formatInteger(visibleData.length)} / ${formatInteger(sortedData.length)}개 종목 표시`;

        updateSortHeaders();

        visibleData.forEach((item) => {
            const rangePosition = calculateRangePosition(item.lastPrice, item.lowPrice, item.highPrice);
            const isFavorite = state.favorites.includes(item.symbol);
            const direction = state.directions.get(item.symbol) || 'initial';
            const row = document.createElement('tr');
            const directionMarker = direction === 'up' ? '▲' : direction === 'down' ? '▼' : direction === 'flat' ? '―' : '';

            row.dataset.symbol = item.symbol;
            row.className = [
                state.selectedSymbol === item.symbol ? 'is-selected' : '',
                direction === 'up' ? 'flash-up' : '',
                direction === 'down' ? 'flash-down' : ''
            ].filter(Boolean).join(' ');
            row.innerHTML = `
                <td>
                    <button class="row-favorite ${isFavorite ? 'is-favorite' : ''}" type="button" data-favorite-symbol="${escapeHtml(item.symbol)}" aria-label="${escapeHtml(item.symbol)} 관심 종목 ${isFavorite ? '해제' : '등록'}">
                        ${isFavorite ? '★' : '☆'}
                    </button>
                </td>
                <td>
                    <button class="symbol-button" type="button" data-symbol="${escapeHtml(item.symbol)}">${escapeHtml(item.symbol)}</button>
                </td>
                <td>
                    ${formatPrice(item.lastPrice)}
                    <span class="tick-direction ${direction === 'up' ? 'is-up' : direction === 'down' ? 'is-down' : 'is-flat'}">${directionMarker}</span>
                </td>
                <td class="${getChangeClass(item.changePercent)}">${formatPercent(item.changePercent)}</td>
                <td>${formatPrice(item.highPrice)}</td>
                <td>${formatPrice(item.lowPrice)}</td>
                <td class="table-range-cell">
                    <div class="table-range">
                        <span class="table-range-track"><span style="--range-position:${rangePosition}%"></span></span>
                        <small>${rangePosition.toFixed(0)}%</small>
                    </div>
                </td>
                <td>${formatCompact(item.quoteVolume)} USDT</td>
            `;
            fragment.appendChild(row);
        });

        elements.cryptoList.appendChild(fragment);
    }

    function sortData(data) {
        const sorted = [...data];
        const multiplier = state.sortDirection === 'asc' ? 1 : -1;

        sorted.sort((a, b) => {
            const first = a[state.sortKey];
            const second = b[state.sortKey];

            if (typeof first === 'string') return first.localeCompare(second) * multiplier;
            return (toFiniteNumber(first) - toFiniteNumber(second)) * multiplier;
        });

        return sorted;
    }

    function updateSortHeaders() {
        elements.table.querySelectorAll('th').forEach((header) => header.removeAttribute('aria-sort'));
        const activeButton = elements.table.querySelector(`[data-sort="${state.sortKey}"]`);
        if (activeButton) {
            activeButton.closest('th').setAttribute('aria-sort', state.sortDirection === 'asc' ? 'ascending' : 'descending');
        }
    }

    function renderLastUpdated() {
        elements.lastUpdated.textContent = state.lastUpdated
            ? `LAST UPDATE ${formatTime(state.lastUpdated)}`
            : 'LAST UPDATE --:--:--';
    }

    function updateClock() {
        const now = new Date();
        elements.currentClock.textContent = formatTime(now);
        elements.currentClock.dateTime = now.toISOString();

        if (!state.nextRefreshAt) {
            elements.countdown.textContent = '--:--';
            return;
        }

        const remainingSeconds = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        elements.countdown.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function setConnectionState(status, text) {
        elements.connectionState.dataset.state = status;
        elements.connectionText.textContent = text;
    }

    function setChangeText(element, change) {
        element.textContent = formatPercent(change);
        element.className = getChangeClass(change);
    }

    function getChangeClass(change) {
        if (change > 0) return 'is-up';
        if (change < 0) return 'is-down';
        return 'is-flat';
    }

    function formatPercent(value) {
        const number = toFiniteNumber(value);
        return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
    }

    function formatPrice(value) {
        const number = Math.abs(toFiniteNumber(value));
        let maximumFractionDigits = 2;

        if (number < 1) maximumFractionDigits = 6;
        if (number < 0.01) maximumFractionDigits = 8;

        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits
        }).format(number);
    }

    function formatCompact(value) {
        return new Intl.NumberFormat('en-US', {
            notation: 'compact',
            maximumFractionDigits: 2
        }).format(toFiniteNumber(value));
    }

    function formatInteger(value) {
        return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(toFiniteNumber(value));
    }

    function formatTime(date) {
        return new Intl.DateTimeFormat('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(date);
    }

    function showToast(message) {
        window.clearTimeout(state.toastTimer);
        elements.toast.textContent = message;
        elements.toast.classList.add('is-visible');
        state.toastTimer = window.setTimeout(() => elements.toast.classList.remove('is-visible'), 1800);
    }

    function initialize() {
        cacheElements();
        bindEvents();
        renderFavoriteCount();
        updateClock();
        fetchCryptoData();
        window.setInterval(updateClock, 1000);
        window.setInterval(() => fetchCryptoData(), CONFIG.REFRESH_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
}
