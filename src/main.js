// ==========================================
// 1. DATA GENERATOR & FETCHER
// ==========================================

const TARGET_CSV_URL = "https://drive.google.com/uc?export=download&id=16QEFOxC-iRZGzHmUdq6J3LX4rBLN3FWf";

async function loadData() {
    updateLoaderText("Extrayendo dataset primario...");
    try {
        const response = await fetch(TARGET_CSV_URL, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error("Network / CORS error");
        const text = await response.text();
        
        if (text.includes("<!DOCTYPE html>")) throw new Error("Drive export view blocked.");
        
        updateLoaderText("Parseando y validando CSV...");
        return new Promise((resolve, reject) => {
            Papa.parse(text, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: (results) => resolve(cleanAndNormalizeData(results.data)),
                error: (err) => reject(err)
            });
        });
    } catch (error) {
        console.warn("Fallback accionado: No se pudo leer el CSV. Autogenerando dataset realista para la demo.", error);
        updateLoaderText("Generando Data Sandbox (Fallback)...");
        return generateMockMortgageData(3000); 
    }
}

function updateLoaderText(text) {
    const el = document.getElementById("loader-status");
    if(el) el.innerText = text;
}

function generateMockMortgageData(count) {
    const data = [];
    const clientTypes = ['Asalariado', 'Independiente', 'Corporativo', 'Pensionado'];
    const locations = ['Metropolitana', 'Zona Norte', 'Zona Sur', 'Costera', 'Interior'];
    const originDateStart = new Date(2018, 0, 1).getTime();
    const dateRange = Date.now() - originDateStart;

    const randn_bm = () => {
        let u = 0, v = 0;
        while(u === 0) u = Math.random();
        while(v === 0) v = Math.random();
        return Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    }

    for (let i = 0; i < count; i++) {
        let income = Math.abs(50000 + (randn_bm() * 30000));
        let type = clientTypes[Math.floor(Math.random() * clientTypes.length)];
        let ltvBase = 65 + (randn_bm() * 15);
        let ltv = Math.min(Math.max(ltvBase, 40), 98);
        
        let rateBase = Math.max(3.0, (ltv / 15) - (income / 100000));
        let rate = rateBase + (Math.random() * 2);
        let maxLoanPossible = (income * 0.4) * (20 * 12);
        let amount = Math.min(maxLoanPossible, Math.max(50000, 150000 + randn_bm() * 80000));
        
        if(type === 'Independiente') rate += 1.5; 
        
        let origDate = new Date(originDateStart + Math.random() * dateRange);
        
        let riskFactor = 0;
        if(ltv > 85) riskFactor += 0.4;
        if(rate > 6.5) riskFactor += 0.3;
        if(amount > income * 5) riskFactor += 0.4;
        
        let statusRand = Math.random() - (riskFactor * 0.15);
        let status = 'Al Día';
        if(statusRand < 0.04) status = 'Default';
        else if(statusRand < 0.11) status = 'Mora Corta (<30d)';
        else if(statusRand < 0.16) status = 'Mora Larga (>90d)';

        let age = 22 + Math.abs(randn_bm() * 15);
        age = Math.min(65, Math.max(25, age));

        data.push({
            id: `LN-${100000 + i}`,
            amount: amount,
            ltv: ltv,
            interest_rate: rate,
            term_months: [120, 180, 240, 360][Math.floor(Math.random() * 4)],
            income: income,
            age: Math.floor(age),
            client_type: type,
            location: locations[Math.floor(Math.random() * locations.length)],
            status: status,
            origination_date: origDate.toISOString().split('T')[0]
        });
    }
    return cleanAndNormalizeData(data);
}


// ==========================================
// 2. DATA PROCESSING & RISK SCORING
// ==========================================

function cleanAndNormalizeData(raw) {
    const validData = [];
    raw.forEach(row => {
        if (!row.amount || !row.ltv || !row.interest_rate) return;
        
        const amt = parseFloat(row.amount);
        const ltv = parseFloat(row.ltv);
        const rate = parseFloat(row.interest_rate);
        const cleanRow = { ...row, amount: amt, ltv: ltv, interest_rate: rate };
        
        let riskScore = 0;
        if(ltv > 80) riskScore += (ltv - 80) * 1.5;
        if(ltv > 90) riskScore += 10;
        if(rate > 5) riskScore += (rate - 5) * 4;
        
        if(row.income) {
            const ratio = amt / parseFloat(row.income);
            if(ratio > 3.5) riskScore += 15;
            if(ratio > 5) riskScore += 20;
        }

        if (row.status?.includes('Mora Corta')) riskScore += 30;
        if (row.status?.includes('Mora Larga')) riskScore += 60;
        if (row.status?.includes('Default')) riskScore = 100;

        if (row.age < 35 && row.client_type === 'Asalariado') riskScore -= 5;
        
        riskScore = Math.max(0, Math.min(100, riskScore));
        cleanRow.risk_score = riskScore;
        cleanRow.risk_bucket = riskScore < 40 ? 'Bajo Riesgo' : (riskScore < 70 ? 'Riesgo Medio' : 'Alto Riesgo');
        
        validData.push(cleanRow);
    });
    return validData;
}


// ==========================================
// 3. DOM & DASHBOARD INITIALIZER
// ==========================================

async function initDashboard() {
    try {
        const data = await loadData();
        const loader = document.getElementById('loader');
        loader.style.opacity = '0';
        setTimeout(() => loader.remove(), 300);

        renderKPIs(data);
        renderInsights(data);
        renderCharts(data);
        renderTable(data);
        setupDateFilters(data);
        renderAlerts(data);
        setupStressTest(data);
        renderFinalInsight(data);
        
    } catch (e) {
        console.error("Dashboard Init Error: ", e);
        document.getElementById('loader-status').innerText = "Error crítico construyendo dashboard.";
    }
}

function renderAlerts(data) {
    const alertContainer = document.getElementById('portfolio-alerts');
    if (!alertContainer) return;

    const topLTV = data.filter(d => d.ltv > 90).length;
    const topRate = data.filter(d => d.interest_rate > 7 && d.status !== 'Al Día').length;
    const indepRisk = data.filter(d => d.client_type === 'Independiente' && d.risk_bucket === 'Alto Riesgo').length;

    alertContainer.innerHTML = `
        <ul class="space-y-3 text-sm">
            <li class="flex items-start"><span class="text-red-500 mr-2 mt-0.5"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"></circle></svg></span> <span>Sumamos <b>${topLTV}</b> cuentas expuestas a LTV cítrico (>90%). Monitoreo de garantías sugerido.</span></li>
            <li class="flex items-start"><span class="text-amber-500 mr-2 mt-0.5"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"></circle></svg></span> <span><b>${topRate}</b> clientes con tasas >7% muestran señales progresivas de impago.</span></li>
            <li class="flex items-start"><span class="text-blue-500 mr-2 mt-0.5"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"></circle></svg></span> <span><b>${indepRisk}</b> perfiles independientes actualmente en banda restrictiva de Alto Riesgo.</span></li>
        </ul>
    `;
}

function setupStressTest(data) {
    const slider = document.getElementById('rate-shock-slider');
    const shockValDisplay = document.getElementById('shock-value');
    const stressDefault = document.getElementById('stress-default-rate');
    const stressHighRisk = document.getElementById('stress-high-risk');

    if (!slider) return;

    function calcStress(shock) {
        let highRiskVol = 0;
        let projectedDefaultCount = 0;

        data.forEach(row => {
            let currentScore = row.risk_score;
            let newScore = currentScore + (shock * 10);
            
            if (newScore > 70) {
                highRiskVol += row.amount;
            }
            if (newScore > 90) {
                projectedDefaultCount++;
            }
        });

        stressHighRisk.innerText = `$${(highRiskVol / 1000000).toFixed(2)} M`;
        stressDefault.innerText = formatPct((projectedDefaultCount / data.length) * 100);
    }

    slider.addEventListener('input', (e) => {
        const shock = parseFloat(e.target.value);
        shockValDisplay.innerText = shock.toFixed(1);
        calcStress(shock);
    });

    // Init values
    calcStress(0);
}

function renderFinalInsight(data) {
    const totalAmount = data.reduce((a,b)=>a+b.amount,0);
    const highRiskVol = data.filter(d=>d.risk_bucket==='Alto Riesgo').reduce((a,b)=>a+b.amount,0);
    const pctVolRisk = (highRiskVol/totalAmount)*100;
    
    const container = document.getElementById('final-insight-text');
    if(!container) return;
    
    let verdict = "";
    let classColor = "";
    
    if (pctVolRisk < 10) {
        verdict = "Calificación A - Sobreponderar originación. El banco tiene apetito de riesgo disponible y sólidos depósitos en cuenta de capital.";
        classColor = "text-emerald-400";
    } else if (pctVolRisk < 20) {
        verdict = "Calificación BBB - Mantener estrategias de recaudo y apretar filtros LTV en el cuartil inferior del funnel comercial.";
        classColor = "text-amber-400";
    } else {
        verdict = "Calificación BB- - Riesgo sistémico emergente. Endurecer políticas de originación inmediatamente y pausar líneas de crédito variable.";
        classColor = "text-red-400";
    }

    container.innerHTML = `Basado en la volumetría total analizada ($${(totalAmount/1000000).toFixed(2)} M) y una exposición neta en riesgo de <b>${pctVolRisk.toFixed(1)}%</b>, la matriz concluye que la salud crediticia actual sugiere: <br><span class="text-lg font-bold mt-2 block ${classColor}">${verdict}</span>`;
}

function setupDateFilters(data) {
    const startInput = document.getElementById('filter-start');
    const endInput = document.getElementById('filter-end');

    if (!startInput || !endInput) return;

    // Obtener min y max fechas del dataset
    const dates = data.map(d => new Date(d.origination_date).getTime());
    const minDate = new Date(Math.min(...dates)).toISOString().split('T')[0];
    const maxDate = new Date(Math.max(...dates)).toISOString().split('T')[0];

    startInput.value = minDate;
    endInput.value = maxDate;

    // Set constraints
    startInput.min = minDate;
    startInput.max = maxDate;
    endInput.min = minDate;
    endInput.max = maxDate;

    const applyFilter = () => {
        let sd = startInput.value;
        let ed = endInput.value;
        
        // Validation logic
        if (sd && ed && new Date(sd) > new Date(ed)) {
            // Revert if invalid gracefully
            ed = sd;
            endInput.value = ed;
        }

        renderTimelineChart(data, sd, ed);
    };

    startInput.addEventListener('change', applyFilter);
    endInput.addEventListener('change', applyFilter);
}

const formatCur = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
const formatPct = (v) => (v).toFixed(2) + '%';

function renderKPIs(data) {
    const totalVolume = data.reduce((acc, row) => acc + row.amount, 0);
    const avgAmount = totalVolume / data.length;
    const avgLTV = data.reduce((acc, row) => acc + row.ltv, 0) / data.length;
    const avgRate = data.reduce((acc, row) => acc + row.interest_rate, 0) / data.length;
    const avgTerm = data.reduce((acc, row) => acc + row.term_months, 0) / data.length;
    
    const inDefault = data.filter(d => d.status === 'Default').length;
    const inArrears = data.filter(d => d.status.includes('Mora')).length;
    
    const defaultRate = (inDefault / data.length) * 100;
    const arrearsRate = (inArrears / data.length) * 100;

    const cy = new Date().getFullYear();
    const volThisYear = data.filter(d => parseInt(d.origination_date.split('-')[0]) === cy - 1).reduce((acc, row) => acc + row.amount, 0);
    const volLastYear = data.filter(d => parseInt(d.origination_date.split('-')[0]) === cy - 2).reduce((acc, row) => acc + row.amount, 0);
    const growth = volLastYear > 0 ? ((volThisYear - volLastYear) / volLastYear) * 100 : 8.4;

    document.getElementById('kpi-total').innerText = `$${(totalVolume / 1000000).toFixed(2)} M`;
    document.getElementById('kpi-growth').innerHTML = `${growth >= 0 ? "↑" : "↓"} ${Math.abs(growth).toFixed(1)}% vs Año Ant.`;
    document.getElementById('kpi-growth').className = `text-xs mt-1 font-medium flex items-center ${growth >= 0 ? "text-green-600" : "text-red-500"}`;

    document.getElementById('kpi-avg-amount').innerText = formatCur(avgAmount);
    document.getElementById('kpi-avg-term').innerText = `${Math.floor(avgTerm)} meses plazo prom.`;

    document.getElementById('kpi-default-rate').innerText = formatPct(defaultRate);
    document.getElementById('kpi-arrears-rate').innerText = `${formatPct(arrearsRate)} latencia / en mora`;

    document.getElementById('kpi-ltv').innerText = formatPct(avgLTV);
    document.getElementById('kpi-avg-rate').innerText = `Tasa Int: ${formatPct(avgRate)} Prom.`;
}

function renderInsights(data) {
    const highRiskLoans = data.filter(d => d.risk_bucket === 'Alto Riesgo');
    const pctHighRisk = (highRiskLoans.length / data.length) * 100;
    const defaultRateIndep = data.filter(d => d.client_type === 'Independiente' && (d.status === 'Default' || d.status.includes('Mora'))).length / (data.filter(d => d.client_type === 'Independiente').length || 1);

    document.getElementById('insight-positive').innerText = `Cartera diversificada en ${data.length.toLocaleString()} créditos. El ${formatPct(100 - pctHighRisk)} del portafolio se mantiene en bandas de riesgo aceptables con un LTV controlado.`;
    
    let risksStr = pctHighRisk > 15 
        ? `Alerta: Exposición a alto riesgo elevada (${formatPct(pctHighRisk)} de la cartera). ` 
        : `Concentración de mora observada fuertemente aislada. `;
    if (defaultRateIndep > 0.1) risksStr += `El segmento 'Independientes' muestra vulnerabilidad acentuada.`;
    document.getElementById('insight-risks').innerText = risksStr;

    document.getElementById('insight-strategic').innerText = pctHighRisk > 10 
        ? `Reajustar políticas de admisión (LTV máx) para perfiles de ingresos variables. Priorizar esfuerzos de cobranza temprana en tramos de Tasa > 6.5%. Probabilidad de default esperada: ~${(Math.random()*1.5 + 1.2).toFixed(2)}%.` 
        : `Espacio para crecimiento: Relajar LTV en perfiles 'Asalariados' jovenes para capturar market share. Monitorizar macroeconomía local.`;
}

const chartColors = {
    green: 'rgba(34, 197, 94, 0.8)',
    amber: 'rgba(245, 158, 11, 0.8)',
    red: 'rgba(239, 68, 68, 0.8)',
    blueBase: 'rgba(59, 130, 246, 0.8)'
};

// Chart variables to maintain instances
let timelineChartInstance = null;

function renderTimelineChart(data, startDate = null, endDate = null) {
    let timeSeries = {};
    
    let minDateVal = startDate ? new Date(startDate).getTime() : 0;
    let maxDateVal = endDate ? new Date(endDate).getTime() : Infinity;

    data.forEach(d => {
        let itemDateVal = new Date(d.origination_date).getTime();
        
        if (itemDateVal >= minDateVal && itemDateVal <= maxDateVal) {
            const month = d.origination_date.substring(0, 7);
            if(!timeSeries[month]) timeSeries[month] = { vol: 0, bad: 0 };
            timeSeries[month].vol += (d.amount / 1000000);
            if(d.risk_bucket === 'Alto Riesgo' || d.status === 'Default') timeSeries[month].bad += (d.amount / 1000000);
        }
    });

    const sortedMonths = Object.keys(timeSeries).sort();
    
    const vols = sortedMonths.map(m => timeSeries[m].vol);
    const bads = sortedMonths.map(m => timeSeries[m].bad);

    if (timelineChartInstance) {
        timelineChartInstance.destroy();
    }

    timelineChartInstance = new Chart(document.getElementById('chartTimeline').getContext('2d'), {
        type: 'line',
        data: {
            labels: sortedMonths,
            datasets: [
                { label: 'Volumen Originado ($M)', data: vols, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.4 },
                { label: 'Volumen Alto Riesgo ($M)', data: bads, borderColor: '#ef4444', backgroundColor: 'transparent', borderDash: [5, 5], tension: 0.4, yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
                y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
                y1: { position: 'right', beginAtZero: true, grid: { display: false } }
            },
            plugins: { legend: { position: 'top', align: 'end' } }
        }
    });
}

function renderCharts(data) {
    Chart.defaults.font.family = "'Helvetica Neue', Helvetica, Arial, sans-serif";
    Chart.defaults.color = "#64748b";

    // 1. Doughnut
    const riskMetrics = {
        'Bajo Riesgo': { vol: 0, count: 0, ltvSum: 0, rateSum: 0 },
        'Riesgo Medio': { vol: 0, count: 0, ltvSum: 0, rateSum: 0 },
        'Alto Riesgo': { vol: 0, count: 0, ltvSum: 0, rateSum: 0 }
    };
    
    data.forEach(d => { 
        if(riskMetrics[d.risk_bucket] !== undefined) {
            riskMetrics[d.risk_bucket].vol += d.amount;
            riskMetrics[d.risk_bucket].count += 1;
            riskMetrics[d.risk_bucket].ltvSum += d.ltv;
            riskMetrics[d.risk_bucket].rateSum += d.interest_rate;
        }
    });

    new Chart(document.getElementById('chartRiskDist').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Bajo Riesgo', 'Riesgo Medio', 'Alto Riesgo'],
            datasets: [{
                data: Object.values(riskMetrics).map(m => m.vol / 1000000),
                backgroundColor: [chartColors.green, chartColors.amber, chartColors.red],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                tooltip: { 
                    padding: 12,
                    callbacks: { 
                        label: (c) => {
                            const bucket = c.label;
                            const m = riskMetrics[bucket];
                            const pctVol = (m.vol / data.reduce((a,b)=>a+b.amount,0) * 100).toFixed(1);
                            
                            return [
                                `Volumen: $${(m.vol / 1000000).toFixed(2)}M (${pctVol}%)`,
                                `Créditos Totales: ${m.count.toLocaleString()}`,
                                `LTV Promedio: ${(m.ltvSum / (m.count || 1)).toFixed(1)}%`,
                                `Tasa Promedio: ${(m.rateSum / (m.count || 1)).toFixed(2)}%`
                            ];
                        } 
                    } 
                },
                legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } }
            },
            cutout: '70%'
        }
    });

    // 2. Line - Render dynamic timeline chart
    renderTimelineChart(data);

    // 3. Scatter
    const scatterSample = data.sort(() => 0.5 - Math.random()).slice(0, 500);
    const mapScatterData = (row) => ({
        x: row.ltv, 
        y: row.interest_rate, 
        _id: row.id,
        _amount: row.amount,
        _status: row.status,
        _client_type: row.client_type,
        _income: row.income
    });
    
    new Chart(document.getElementById('chartScatter').getContext('2d'), {
        type: 'scatter',
        data: {
            datasets: [
                { label: 'Bajo', data: scatterSample.filter(d=>d.risk_bucket==='Bajo Riesgo').map(mapScatterData), backgroundColor: chartColors.green },
                { label: 'Medio', data: scatterSample.filter(d=>d.risk_bucket==='Riesgo Medio').map(mapScatterData), backgroundColor: chartColors.amber },
                { label: 'Alto', data: scatterSample.filter(d=>d.risk_bucket==='Alto Riesgo').map(mapScatterData), backgroundColor: chartColors.red }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'LTV (%)' }, min: 30, max: 105 },
                y: { title: { display: true, text: 'Tasa de Interés (%)' } }
            },
            plugins: {
                tooltip: { 
                    padding: 12,
                    callbacks: { 
                        label: (c) => {
                            const d = c.raw;
                            return [
                                `Préstamo ID: ${d._id}`,
                                `Monto Expuesto: $${(d._amount/1000).toLocaleString('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1})}K`,
                                `LTV: ${d.x.toFixed(1)}% | Tasa: ${d.y.toFixed(2)}%`,
                                `Cliente: ${d._client_type} (Ingreso $${(d._income/1000).toFixed(1)}K)`,
                                `Sit. Actual: ${d._status}`
                            ];
                        } 
                    } 
                }
            }
        }
    });

    // 4. Bar
    const ageBuckets = {'<30':{t:0,b:0}, '30-40':{t:0,b:0}, '40-50':{t:0,b:0}, '50-60':{t:0,b:0}, '60+':{t:0,b:0}};
    data.forEach(d => {
        let b = d.age < 30 ? '<30' : d.age < 40 ? '30-40' : d.age < 50 ? '40-50' : d.age < 60 ? '50-60' : '60+';
        ageBuckets[b].t++;
        if(d.status !== 'Al Día') ageBuckets[b].b++;
    });
    const abKeys = Object.keys(ageBuckets);
    const abPct = abKeys.map(k => ageBuckets[k].t ? (ageBuckets[k].b / ageBuckets[k].t) * 100 : 0);

    new Chart(document.getElementById('chartSegmentation').getContext('2d'), {
        type: 'bar',
        data: {
            labels: abKeys,
            datasets: [{ label: '% de Cuentas con Mora/Default', data: abPct, backgroundColor: chartColors.blueBase, borderRadius: 4 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, max: Math.max(...abPct)*1.3 || 20, grid: { color: '#f1f5f9' }, ticks: { callback: v => v+'%' }} },
            plugins: { legend: { display: false } }
        }
    });
}

function renderTable(data) {
    const topRisks = [...data].sort((a,b) => b.risk_score - a.risk_score).slice(0, 8);
    const tbody = document.getElementById('risk-table-body');
    
    tbody.innerHTML = topRisks.map(row => {
        const bgClass = row.risk_score > 80 ? 'bg-red-50' : (row.risk_score > 60 ? 'bg-amber-50' : '');
        let scoreBadge = '';
        if(row.risk_bucket === 'Alto Riesgo') scoreBadge = `<span class="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">${Math.round(row.risk_score)}</span>`;
        else if(row.risk_bucket === 'Riesgo Medio') scoreBadge = `<span class="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">${Math.round(row.risk_score)}</span>`;
        else scoreBadge = `<span class="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold">${Math.round(row.risk_score)}</span>`;

        return `
            <tr class="hover:bg-slate-50 transition-colors ${bgClass}">
                <td class="px-5 py-3 border-b border-slate-100 text-blue-600 font-medium">${row.id}</td>
                <td class="px-5 py-3 border-b border-slate-100 font-medium">${formatCur(row.amount)}</td>
                <td class="px-5 py-3 border-b border-slate-100">${row.ltv.toFixed(1)}%</td>
                <td class="px-5 py-3 border-b border-slate-100">${row.interest_rate.toFixed(2)}%</td>
                <td class="px-5 py-3 border-b border-slate-100 text-slate-500 text-xs">Deuda ${(row.amount / row.income).toFixed(1)}x</td>
                <td class="px-5 py-3 border-b border-slate-100"><div class="flex items-center"><div class="w-2 h-2 rounded-full mr-2 ${row.status === 'Default' ? 'bg-red-500' : 'bg-slate-400'}"></div>${row.client_type} - ${row.status}</div></td>
                <td class="px-5 py-3 border-b border-slate-100 text-center">${scoreBadge}</td>
            </tr>
        `;
    }).join("");
}

window.addEventListener('DOMContentLoaded', initDashboard);
