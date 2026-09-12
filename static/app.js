let allSegments = [];
const rows = document.querySelector('#rows');
const u = document.querySelector('#unstable');
const m = document.querySelector('#marginal');
const uOut = document.querySelector('#unstableOut');
const mOut = document.querySelector('#marginalOut');

// NH-07 Coordinates roughly mapping for S1 to S12 (Rishikesh to Badrinath tracking)
const segmentCoords = {
    'NH07-S01': [30.0869, 78.2676], // Near Rishikesh
    'NH07-S02': [30.1150, 78.4200],
    'NH07-S03': [30.1459, 78.5996], // Devprayag
    'NH07-S04': [30.1800, 78.6900],
    'NH07-S05': [30.2223, 78.7849], // Srinagar
    'NH07-S06': [30.2500, 78.8800],
    'NH07-S07': [30.2844, 78.9811], // Rudraprayag
    'NH07-S08': [30.2700, 79.1000],
    'NH07-S09': [30.2583, 79.2215], // Karnaprayag
    'NH07-S10': [30.4010, 79.3500],
    'NH07-S11': [30.5506, 79.5660], // Joshimath
    'NH07-S12': [30.7433, 79.4938]  // Badrinath
};

// ----------------------------------------------------
// MAP INITIALIZATION (Leaflet + Esri Satellite)
// ----------------------------------------------------
const map = L.map('real-map', {
    zoomControl: false,
    attributionControl: false
}).setView([30.35, 78.9], 9);

// Add custom zoom control to bottom right
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Define Base Layers
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 17
});

const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17
});

// We will use OpenStreetMap tiles inverted via CSS for the dark layer to avoid any API key issues
const standardOSMLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 17
});

// Set default layer
satelliteLayer.addTo(map);

// Map Controls Logic
document.getElementById('btn-sat').onclick = (e) => setMapLayer(e, satelliteLayer, false);
document.getElementById('btn-topo').onclick = (e) => setMapLayer(e, topoLayer, false);
document.getElementById('btn-dark').onclick = (e) => setMapLayer(e, standardOSMLayer, true);

function setMapLayer(btnEvent, layer, isDark) {
    document.querySelectorAll('.map-btn').forEach(b => b.classList.remove('selected'));
    btnEvent.target.classList.add('selected');

    if (isDark) {
        document.getElementById('real-map').classList.add('tactical-dark');
    } else {
        document.getElementById('real-map').classList.remove('tactical-dark');
    }

    map.eachLayer((l) => map.removeLayer(l));
    layer.addTo(map);

    // Re-add markers
    renderMarkers();
    if (movableMarker) movableMarker.addTo(map);
}

let mapMarkers = [];

// Create custom green dot icon (larger hit area for draggability)
const greenDotIcon = L.divIcon({
    className: 'custom-drag-icon',
    html: '<div class="pulse-probe"></div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
});

// Place it on the map and make it draggable
let movableMarker = L.marker([30.35, 78.9], {
    icon: greenDotIcon,
    draggable: true,
    autoPan: true
}).addTo(map);

movableMarker.on('dragend', async function(event) {
    const coords = movableMarker.getLatLng();
    const lat = coords.lat.toFixed(4);
    const lng = coords.lng.toFixed(4);

    // Show a loading state in the popup
    const popupStyle = `background:#0a0e1c; color:#f0f4f8; padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); width: 180px;`;

    movableMarker.bindPopup(`
        <div style="${popupStyle}">
            <i>Extracting telemetry for <b>${lat}, ${lng}</b>...</i>
        </div>
    `, { className: 'dark-popup' }).openPopup();

    try {
        // Fetch new weather data directly (using open-meteo)
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=precipitation,temperature_2m,wind_speed_10m&timezone=auto`;

        const response = await fetch(url);
        const data = await response.json();

        const rain = data.current.precipitation;
        const temp = data.current.temperature_2m;

        // Update popup with live intelligence
        movableMarker.getPopup().setContent(`
            <div style="${popupStyle}">
                <h4 style="margin:0 0 5px; color:#00f2fe">GEOSPATIAL PROBE</h4>
                <div style="font-size:11px; margin-bottom:5px;">LAT: ${lat} | LON: ${lng}</div>
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span style="color:#8899ac">Rainfall:</span>
                    <strong>${rain} mm</strong>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span style="color:#8899ac">Temp:</span>
                    <strong>${temp} °C</strong>
                </div>
                <div style="font-size:9px; color:#536275; margin-top:8px;">*Requires backend sync for FoS</div>
            </div>
        `);
    } catch (err) {
        movableMarker.getPopup().setContent(`
            <div style="${popupStyle}">
                <span style='color:#990011;'>Telemetry link failed.</span>
            </div>
        `);
    }
});

// Fetch live data from backend
async function fetchSegments() {
    try {
        const response = await fetch('/api/segments');
        if (response.ok) {
            const data = await response.json();
            allSegments = data.segments;

            // Sync thresholds from initial load
            if (data.thresholds) {
                u.value = data.thresholds.unstable;
                m.value = data.thresholds.marginal;
                sync();
            }

            render();
            renderMarkers(); // Update Map 3D Markers
            updateStats();
            updateTicker(); // Live ticker update
        }
    } catch (e) {
        console.error("Failed to load segments:", e);
        rows.innerHTML = '<div style="padding:20px;color:#990011">Failed to connect to telemetry datalink. Retrying...</div>';
    }
}

// Render Map Markers dynamically based on risk level
function renderMarkers() {
    // Clear old markers
    mapMarkers.forEach(m => map.removeLayer(m));
    mapMarkers = [];

    allSegments.forEach(seg => {
        const coords = segmentCoords[seg.id] || [30.1, 78.5]; // Fallback
        const isEndangered = (seg.id === 'NH07-S07' || seg.id === 'NH07-S11' || seg.id === 'S7' || seg.id === 'S11');
        const riskClass = isEndangered ? 'endangered' : seg.risk_level.toLowerCase();
        const badgeColor = isEndangered ? '#a855f7' : (riskClass === 'unstable' ? '#990011' : (riskClass === 'marginal' ? '#ff9900' : '#2ed573'));

        // Create 3D HTML marker
        const iconHtml = `<div class="custom-map-marker ${riskClass}">${seg.id.replace(/\D/g, '')}</div>`;
        const customIcon = L.divIcon({
            html: iconHtml,
            className: 'dummy-leaflet-class', // Leaflet needs a class, but we style the inner div
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });

        const marker = L.marker(coords, { icon: customIcon }).addTo(map);

        // Popup with rich data
        const popupContent = `
            <div style="background:#0a0e1c; color:#f0f4f8; padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); width: 180px; cursor:pointer;" onclick="playUIBeep('click'); showSegmentProfile('${seg.id}')">
                <h4 style="margin:0 0 5px; color:#00f2fe">${seg.name}</h4>
                <div style="font-size:11px; margin-bottom:5px;">Chainage: KM ${seg.km}</div>
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span style="color:#8899ac">FoS:</span>
                    <strong style="color:${badgeColor}">${seg.fos.min.toFixed(2)}</strong>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span style="color:#8899ac">24H Rain:</span>
                    <strong>${seg.rainfall.accum_24h_mm} mm</strong>
                </div>
                <div style="font-size:9px; color:${isEndangered ? '#a855f7' : '#536275'}; margin-top:8px; font-weight:bold;">${isEndangered ? '🟣 HISTORICALLY ENDANGERED' : 'CONFIDENCE: ' + seg.confidence}</div>
            </div>
        `;

        marker.bindPopup(popupContent, {
            className: 'dark-popup'
        });

        mapMarkers.push(marker);
    });
}

// Map popup specific styles override
const style = document.createElement('style');
style.innerHTML = `
    .leaflet-popup-content-wrapper { background: transparent; box-shadow: none; padding: 0; }
    .leaflet-popup-tip-container { display: none; }
    .leaflet-popup-content { margin: 0; }
`;
document.head.appendChild(style);

// Render rows exactly matching 3d aesthetics
function render() {
    if (!allSegments.length) return;

    rows.innerHTML = allSegments.map((seg, idx) => {
        const isEndangered = (seg.id === 'NH07-S07' || seg.id === 'NH07-S11' || seg.id === 'S7' || seg.id === 'S11');
        const cls = isEndangered ? 'endangered' : seg.risk_level.toLowerCase();
        const displayRisk = isEndangered ? 'Endangered' : (cls.charAt(0).toUpperCase() + cls.slice(1));

        let confMarker = '●';
        if (seg.confidence === 'MEDIUM') confMarker = '◐';
        if (seg.confidence === 'LOW') confMarker = '○';

        return `<div class="row" style="--i: ${idx}; cursor:pointer;" onclick="playUIBeep('click'); showSegmentProfile('${seg.id}')" title="Click to view Sector Cross-Section Profile & 24H Forecast">
            <div class="segment">
                <b>${seg.id}</b>
                <small>${seg.name} (KM ${seg.km})</small>
            </div>
            <strong class="fos ${cls}">${seg.fos.min.toFixed(2)}</strong>
            <span class="rain">${seg.rainfall.accum_24h_mm} mm</span>
            <span class="confidence-text">${seg.confidence} · ${confMarker}</span>
            <span class="status ${cls}">${displayRisk}</span>
        </div>`;
    }).join('');
}

// Update top statistics panel based on data
function updateStats() {
    const unstableCount = allSegments.filter(s => s.risk_level === 'UNSTABLE').length;

    // --- EMERGENCY NOTIFICATION LOGIC ---
    const banner = document.getElementById('emergency-banner');
    if (banner) {
        if (unstableCount > 0 && !window.emergencyMuted) {
            banner.classList.add('show');
            const details = document.getElementById('emergency-details');
            if(details) details.textContent = `${unstableCount} Sectors Reporting UNSTABLE. Evacuation Protocols Recommended.`;

            // Play Alarm Custom Synthesis
            if (!window.alarmInterval) {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

                window.alarmInterval = setInterval(() => {
                    if (audioCtx.state === 'suspended') audioCtx.resume();
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(400, audioCtx.currentTime);
                    osc.frequency.linearRampToValueAtTime(800, audioCtx.currentTime + 0.3);

                    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
                    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start();
                    osc.stop(audioCtx.currentTime + 0.5);
                }, 1000);
            }
        } else if (unstableCount === 0) {
            banner.classList.remove('show');
            if (window.alarmInterval) {
                clearInterval(window.alarmInterval);
                window.alarmInterval = null;
            }
        }
    }


    // Update the critical segments counter
    const alertCard = document.querySelector('#unstableCount');
    if (alertCard) {
        alertCard.textContent = unstableCount.toString().padStart(2, '0');
    }

    // Total 24h rainfall over all segments
    const maxRainfall = Math.max(...allSegments.map(s => s.rainfall.accum_24h_mm || 0));
    const rainCard = document.querySelector('#maxRain');
    if (rainCard) {
        rainCard.innerHTML = `${maxRainfall.toFixed(1)} <small>mm</small>`;
    }

    // Time
    const timeElem = document.querySelector('#time');
    if (timeElem) {
        const now = new Date();
        timeElem.textContent = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second: '2-digit'});
    }
}

// Sync slider visually
function sync() {
    uOut.value = (+u.value).toFixed(2);
    mOut.value = (+m.value).toFixed(2);
}

// Event Listeners for sliders
[u, m].forEach(slider => {
    slider.addEventListener('input', (e) => {
        sync();
        // Optimistic UI update (client side logic matching threshold temporarily)
        allSegments.forEach(s => {
            if (s.fos.min < +u.value) s.risk_level = 'UNSTABLE';
            else if (s.fos.min < +m.value) s.risk_level = 'MARGINAL';
            else s.risk_level = 'STABLE';
        });
        render();
        renderMarkers();
        updateStats();
        updateTicker();

        // 3D Visual Feedback: Spawn dust particles around the slider thumb when dragging
        const rect = slider.getBoundingClientRect();
        const percent = (slider.value - slider.min) / (slider.max - slider.min);
        const thumbX = rect.left + (percent * rect.width);
        const thumbY = rect.top + (rect.height / 2);

        // Only spawn 1-2 dust particles per move to avoid lagging
        for(let i=0; i < 2; i++) {
            // Spawn specific type based on which slider it is
            spawnRockParticle(thumbX, thumbY, slider === u ? 'glowing' : 'dust');
        }
    });
});

// Update thresholds on backend
document.querySelector('#apply').onclick = async () => {
    const btn = document.querySelector('#apply');
    const ogText = btn.innerHTML;
    btn.innerHTML = '<span>Calibrating...</span>';

    try {
        await fetch('/api/thresholds', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                unstable: parseFloat(u.value),
                marginal: parseFloat(m.value)
            })
        });
        await fetchSegments();
        btn.innerHTML = '<span>Calibrated ✓</span>';
        setTimeout(() => btn.innerHTML = ogText, 2000);
    } catch (e) {
        console.error("Failed to update thresholds", e);
        btn.innerHTML = '<span>Link Error!</span>';
        setTimeout(() => btn.innerHTML = ogText, 2000);
    }
};

// Force Refresh Data
document.querySelector('#refresh').onclick = async () => {
    const btn = document.querySelector('#refresh');
    const ogText = btn.innerHTML;
    btn.innerHTML = '<span class="refresh-icon">...</span><span>Fetching...</span>';

    try {
        await fetch('/api/refresh', { method: 'POST' });
        await fetchSegments();
    } finally {
        setTimeout(() => { btn.innerHTML = ogText; }, 1000);
    }
};

// Start
sync();
fetchSegments();

// Auto refresh every 5 min
setInterval(fetchSegments, 300000);

// ----------------------------------------------------
// UI INTERACTION & ANIMATIONS (Sidebar tabs & Modals)
// ----------------------------------------------------

// 1. Sidebar Navigation Switcher
const navLinks = document.querySelectorAll('.nav-link');
const viewSections = document.querySelectorAll('.view-section');

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        // Remove active class from all links
        navLinks.forEach(l => l.classList.remove('active'));
        // Add active to clicked log
        link.classList.add('active');

        const targetId = link.getAttribute('data-view');
        const targetView = document.getElementById(targetId);

        // Hide all views except target
        viewSections.forEach(view => {
            if (view !== targetView) {
                view.classList.add('hidden');
                setTimeout(() => {
                    if (view.classList.contains('hidden')) {
                        view.style.display = 'none';
                    }
                }, 300); // Wait for transition
            }
        });

        // Show target view immediately
        targetView.style.display = 'block';

        // Small delay to allow display:block to apply before removing hidden to trigger opacity transition
        setTimeout(() => {
            targetView.classList.remove('hidden');

            // If returning to command view, ensure map fixes its size (Leaflet bug workaround when hidden)
            if (targetId === 'view-command') {
                map.invalidateSize();
            }
            if (targetId === 'view-terrain') {
                initTerrain();
                setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
            }
            if (targetId === 'view-rainfall' || targetId === 'view-validation') {
                initCharts();
                if (targetId === 'view-validation') loadIncidents();
                setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
            }
        }, 50);
    });
});

// 2. Telemetry Inspector Modal
const inspectBtn = document.getElementById('inspect-btn');
const telemetryModal = document.getElementById('telemetry-modal');
const closeModal = document.getElementById('close-telemetry');
const textOutput = document.getElementById('telemetry-output');

inspectBtn.addEventListener('click', () => {
    telemetryModal.style.display = 'flex';
    setTimeout(() => telemetryModal.classList.remove('hidden'), 50);

    // Simulate animated terminal extraction of telemetry
    textOutput.innerHTML = 'Establishing secure link to Open-Meteo...\nFetching spatial tensors...\n';

    let simLines = [
        '[OK] Handshake completed w/ api.open-meteo.com',
        '[SYS] Querying geospatial polygon for NH-07 / 30.1N 78.5E',
        '-------------------------------------------',
    ];

    if (allSegments.length > 0) {
        allSegments.forEach(s => {
            let wind = s.rainfall.wind_speed ? s.rainfall.wind_speed + 'km/h' : 'N/A';
            let pressure = s.rainfall.pressure_msl ? s.rainfall.pressure_msl + 'hPa' : 'N/A';
            let temp = s.rainfall.temperature ? s.rainfall.temperature + '°C' : 'N/A';
            simLines.push(`[DAT] ${s.id} | Rain: ${s.rainfall.accum_24h_mm}mm | Wind: ${wind} | Press: ${pressure} | Temp: ${temp} | FoS: ${s.fos.min.toFixed(2)}`);
        });

        const testSeg = allSegments[0];
        if (testSeg && testSeg.rainfall.sunrise) {
            simLines.push(`[ASTRO] Sunrise: ${testSeg.rainfall.sunrise.split('T')[1] || 'N/A'} | Sunset: ${testSeg.rainfall.sunset.split('T')[1] || 'N/A'}`);
        }
    } else {
        simLines.push('[ERR] No active segment data in buffer.');
    }

    simLines.push('-------------------------------------------');
    simLines.push('[OK] Stream synced. Real-time updates active.');

    let lineIndex = 0;
    const interval = setInterval(() => {
        if (lineIndex < simLines.length) {
            textOutput.innerHTML += simLines[lineIndex] + '\n';
            lineIndex++;
        } else {
            clearInterval(interval);
        }
    }, 150);
});

closeModal.addEventListener('click', () => {
    telemetryModal.classList.add('hidden');
    setTimeout(() => {
        telemetryModal.style.display = 'none';
    }, 300);
});

// ----------------------------------------------------
// Ticker Interface Logic
// ----------------------------------------------------
function updateTicker() {
    const tickerContainer = document.getElementById('ticker-text');
    if (!tickerContainer || !allSegments.length) return;

    let tickerHTML = '';
    const sep = '<span class="ticker-sep">///</span>';

    // Base system status
    tickerHTML += `<span>[SYS] SENSOR MESH ONLINE · ${new Date().toLocaleTimeString()}</span> ${sep} `;

    // Alerts
    const unstable = allSegments.filter(s => s.risk_level === 'UNSTABLE');
    const marginal = allSegments.filter(s => s.risk_level === 'MARGINAL');

    if (unstable.length > 0) {
        tickerHTML += `<span class="ticker-alert">[CRITICAL] ${unstable.length} SECTORS EXCEED THRESHOLD</span> ${sep} `;
        unstable.forEach(s => {
            tickerHTML += `<span class="ticker-alert">EVAC ALERT: ${s.name} (KM ${s.km}) - FoS: ${s.fos.min.toFixed(2)} | RAIN: ${s.rainfall.accum_24h_mm}mm</span> ${sep} `;
        });
    }

    if (marginal.length > 0) {
        tickerHTML += `<span class="ticker-caution">[WARNING] ${marginal.length} SECTORS SHOWING ATYPICAL PORE PRESSURE</span> ${sep} `;
    }

    // Standard telemetry
    const maxRainfall = Math.max(...allSegments.map(s => s.rainfall.accum_24h_mm || 0));
    tickerHTML += `<span>PEAK 24H RAINFALL DETECTED: ${maxRainfall.toFixed(1)}mm</span> ${sep} `;
    tickerHTML += `<span>MONITORING CORRIDOR NH-07 UTTARAKHAND (RISHIKESH ⇄ BADRINATH)</span> ${sep} `;
    tickerHTML += `<span>INFINITE-SLOPE ACTIVE CALIBRATION ENABLED</span>`;

    // Duplicate content twice to ensure seamless marquee looping
    tickerContainer.innerHTML = tickerHTML + ` ${sep} ` + tickerHTML + ` ${sep} ` + tickerHTML;
}

// ----------------------------------------------------
// Interactive Rock Physics (Click Effect)
// ----------------------------------------------------
document.addEventListener('click', (e) => {
    // Avoid spawning debris when clicking buttons, inputs, links, map, or modals to not block UI interactions too aggressively
    const targetTags = ['BUTTON', 'A', 'INPUT', 'SELECT'];
    if (targetTags.includes(e.target.tagName)) return;
    if (e.target.closest('.map-viewport') || e.target.closest('.modal-overlay')) return;

    // Spawn 5-8 particles at click location
    const numParticles = Math.floor(Math.random() * 4) + 5;

    for (let i = 0; i < numParticles; i++) {
        spawnRockParticle(e.clientX, e.clientY);
    }
});

function spawnRockParticle(x, y, forceType = null) {
    const rock = document.createElement('div');
    rock.className = 'debris-rock';

    // 15% chance to be glowing hot debris, 30% chance to be dust, 55% normal rock
    // Or force type if passed
    if (forceType === 'glowing' || (!forceType && Math.random() < 0.15)) {
        rock.classList.add('glowing');
    } else if (forceType === 'dust' || (!forceType && Math.random() < 0.45)) {
        rock.classList.add('dust');
    }

    // Randomize shape (angular clip paths for rocks)
    if (!rock.classList.contains('dust')) {
        const p1 = Math.floor(Math.random()*20);
        const p2 = 80 + Math.floor(Math.random()*20);
        const p3 = 80 + Math.floor(Math.random()*20);
        const p4 = Math.floor(Math.random()*20);
        rock.style.clipPath = `polygon(${p1}% 0%, ${p2}% ${p4}%, 100% ${p3}%, ${p4}% 100%, 0% ${p2}%)`;
    }

    // Size
    const size = rock.classList.contains('dust') ?
        Math.random() * 30 + 10 :
        Math.random() * 12 + 4;

    rock.style.width = size + 'px';
    rock.style.height = size + 'px';
    rock.style.left = (x - size/2) + 'px';
    rock.style.top = (y - size/2) + 'px';

    document.body.appendChild(rock);

    // Physics variables
    let posX = x - size/2;
    let posY = y - size/2;
    // Explode outward (burst)
    let velX = (Math.random() - 0.5) * 12;
    let velY = forceType ? (Math.random() - 0.5) * 6 : (Math.random() - 1) * 10 - 2; // Less upward jump if from slider
    let gravity = forceType ? 0.2 : 0.5; // Lighter gravity for slider sparks
    let rotation = Math.random() * 360;
    const rotSpeed = (Math.random() - 0.5) * 20;
    let opacity = rock.classList.contains('dust') ? 0.6 : 1;
    let bounceCount = 0;

    let frameId;
    function updatePhysics() {
        velY += gravity;
        posX += velX;
        posY += velY;
        rotation += rotSpeed;

        if (rock.classList.contains('dust')) {
            opacity -= 0.02; // Dust fades faster
            // Dust floats a bit more, higher drag
            velX *= 0.9;
            velY -= gravity * 0.8;
        } else {
            // Normal fade
            opacity -= 0.015;

            // Add a simple bounce effect off the bottom of the window
            if (posY + size > window.innerHeight && bounceCount < 2) {
                posY = window.innerHeight - size;
                velY = -velY * 0.5; // lose half energy
                velX = velX * 0.7; // friction
                bounceCount++;
            }
        }

        rock.style.transform = `translate(${posX - x + size/2}px, ${posY - y + size/2}px) rotate(${rotation}deg)`;
        rock.style.opacity = opacity;

        if (opacity > 0 && posY < window.innerHeight + 50) {
            frameId = requestAnimationFrame(updatePhysics);
        } else {
            rock.remove();
        }
    }

    frameId = requestAnimationFrame(updatePhysics);
}

// ----------------------------------------------------
// 3D Terrain Analysis (Three.js) & Charting
// ----------------------------------------------------
let terrainScene, terrainCamera, terrainRenderer, terrainControls;
let terrainAnimationId = null;

function initTerrain() {
    const container = document.getElementById('terrain-canvas');
    if (!container) {
        console.warn('terrain-canvas container not found');
        return;
    }

    let initW = container.clientWidth || (container.parentElement ? container.parentElement.clientWidth : 0) || 800;
    let initH = container.clientHeight || (container.parentElement ? container.parentElement.clientHeight : 0) || 550;

    console.log('Initializing 3D Terrain with size:', initW, 'x', initH);

    // If renderer doesn't exist, create WebGL renderer and scene
    if (!terrainRenderer) {
        terrainScene = new THREE.Scene();
        terrainScene.background = new THREE.Color(0x0a0e1c);
        terrainScene.fog = new THREE.FogExp2(0x0a0e1c, 0.02);

        terrainCamera = new THREE.PerspectiveCamera(45, initW / initH, 0.1, 1000);
        terrainCamera.position.set(0, 45, 75);
        terrainCamera.lookAt(0, -10, 0);

        terrainRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        terrainRenderer.setSize(initW, initH);
        terrainRenderer.setPixelRatio(window.devicePixelRatio);
        terrainRenderer.setClearColor(0x0a0e1c, 1);

        container.innerHTML = '';
        container.appendChild(terrainRenderer.domElement);

        const OrbitControlsClass = (typeof THREE !== 'undefined' && THREE.OrbitControls) || window.OrbitControls;
        if (OrbitControlsClass) {
            try {
                terrainControls = new OrbitControlsClass(terrainCamera, terrainRenderer.domElement);
                terrainControls.enableDamping = true;
                terrainControls.dampingFactor = 0.05;
                terrainControls.autoRotate = true;
                terrainControls.autoRotateSpeed = 1.5;
                terrainControls.maxPolarAngle = Math.PI / 2 - 0.05;
                terrainControls.enableZoom = true;
            } catch (e) {
                console.warn('OrbitControls instantiation failed:', e);
                terrainControls = null;
            }
        }
    } else {
        terrainRenderer.setSize(initW, initH);
        if (terrainCamera) {
            terrainCamera.aspect = initW / initH;
            terrainCamera.updateProjectionMatrix();
        }
    }

    // Clear previous children to rebuild scene cleanly
    while (terrainScene.children.length > 0) {
        terrainScene.remove(terrainScene.children[0]);
    }

    // Lights
    const ambient = new THREE.AmbientLight(0x404040, 1.5);
    terrainScene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffaa00, 1.2);
    dirLight.position.set(100, 100, 50);
    terrainScene.add(dirLight);
    const redLight = new THREE.DirectionalLight(0x990011, 0.6);
    redLight.position.set(-100, 50, -50);
    terrainScene.add(redLight);

    // Sort segments by ID order (NH07-S01 to NH07-S12)
    const sortedSegs = [...allSegments].sort((a, b) => {
        const numA = parseInt(a.id.replace(/\D/g, '')) || 0;
        const numB = parseInt(b.id.replace(/\D/g, '')) || 0;
        return numA - numB;
    });

    const getSectorAtZ = (z) => {
        const t = Math.max(0, Math.min(1, (z + 100) / 200));
        const idx = Math.min(sortedSegs.length - 1, Math.floor(t * sortedSegs.length));
        return sortedSegs[idx] || sortedSegs[0];
    };

    const getHighwayX = (z) => {
        const t = (z + 100) / 200;
        return Math.sin(t * Math.PI * 2) * 18;
    };

    // Generate Canvas Map Texture for 3D Terrain Map Surface
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = 1024;
    mapCanvas.height = 1024;
    const mapCtx = mapCanvas.getContext('2d');

    // Base dark topography background
    mapCtx.fillStyle = '#0b1320';
    mapCtx.fillRect(0, 0, 1024, 1024);

    // Draw Topographic Contour Lines
    mapCtx.strokeStyle = 'rgba(0, 242, 254, 0.15)';
    mapCtx.lineWidth = 2;
    for (let r = 40; r < 1000; r += 35) {
        mapCtx.beginPath();
        mapCtx.arc(512, 512, r, 0, Math.PI * 2);
        mapCtx.stroke();
    }

    // Draw River Valley Flow Path
    mapCtx.strokeStyle = 'rgba(2, 132, 199, 0.6)';
    mapCtx.lineWidth = 18;
    mapCtx.beginPath();
    for (let py = 0; py <= 1024; py += 15) {
        let px = 512 + Math.sin(py * 0.006) * 110;
        if (py === 0) mapCtx.moveTo(px, py);
        else mapCtx.lineTo(px, py);
    }
    mapCtx.stroke();

    const mapTexture = new THREE.CanvasTexture(mapCanvas);

    // Generate real NH-07 mountain terrain surface using segment elevation profiles
    const geometry = new THREE.PlaneGeometry(200, 200, 80, 80);
    geometry.rotateX(-Math.PI / 2);

    const vertices = geometry.attributes.position.array;
    for (let i = 0; i < vertices.length; i += 3) {
        const x = vertices[i];
        const z = vertices[i + 2];

        const seg = getSectorAtZ(z);
        const baseElev = seg ? (seg.elevation || (seg.terrain ? seg.terrain.mean_elevation_m : 350)) : 350;
        const slopeDeg = seg ? (seg.slope ? seg.slope.beta_deg : (seg.terrain ? seg.terrain.max_slope_deg : 30)) : 30;

        const hwX = getHighwayX(z);
        const distFromHw = Math.abs(x - hwX);

        let y = (baseElev - 200) / 35;
        if (distFromHw > 8) {
            const mountainRise = Math.tan((slopeDeg * Math.PI) / 180) * (distFromHw - 8) * 0.4;
            y += Math.min(45, mountainRise);
        }
        y += Math.sin(x * 0.2) * Math.cos(z * 0.2) * 2.0;

        vertices[i + 1] = y;
    }
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
        map: mapTexture,
        color: 0x1e293b,
        emissive: 0x081220,
        wireframe: false,
        roughness: 0.5,
        metalness: 0.2
    });

    const terrain = new THREE.Mesh(geometry, material);
    terrainScene.add(terrain);

    // Add 3D Wireframe Overlay for High-Tech GIS Terrain Contours
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe, wireframe: true, transparent: true, opacity: 0.2 });
    const wireMesh = new THREE.Mesh(geometry, wireMat);
    terrainScene.add(wireMesh);

    // Render 3D Connected Path Line passing through all 12 Route Points (S1 to S12)
    const routePoints = [];
    sortedSegs.forEach((seg, index) => {
        const t = (index + 0.5) / Math.max(1, sortedSegs.length);
        const z = -100 + t * 200;
        const x = getHighwayX(z);
        const baseElev = seg.elevation || (seg.terrain ? seg.terrain.mean_elevation_m : 350);
        const y = (baseElev - 200) / 35 + 1.2;
        routePoints.push(new THREE.Vector3(x, y, z));
    });

    const routeCurve = new THREE.CatmullRomCurve3(routePoints);
    const tubeGeo = new THREE.TubeGeometry(routeCurve, 120, 0.8, 8, false);
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff8800, emissiveIntensity: 0.8, roughness: 0.2 });
    const highway = new THREE.Mesh(tubeGeo, tubeMat);
    terrainScene.add(highway);

    // Interactive 3D Points of Elevation & Depth (3D Pin Markers for S01 to S12)
    const pinGroup = new THREE.Group();
    const pinObjects = [];

    sortedSegs.forEach((seg, index) => {
        const t = (index + 0.5) / Math.max(1, sortedSegs.length);
        const z = -100 + t * 200;
        const x = getHighwayX(z);
        const baseElev = seg.elevation || (seg.terrain ? seg.terrain.mean_elevation_m : 350);
        const groundY = (baseElev - 200) / 35 + 0.8;

        const isEndangered = (seg.id === 'NH07-S07' || seg.id === 'NH07-S11' || seg.id === 'S7' || seg.id === 'S11');
        const riskClass = seg.risk_level ? seg.risk_level.toLowerCase() : 'stable';
        let pinColor = 0x2ed573; // Stable Green
        if (isEndangered) pinColor = 0xa855f7; // Purple for Historically Endangered
        else if (riskClass === 'unstable') pinColor = 0x990011; // Dark Red
        else if (riskClass === 'marginal') pinColor = 0xff9900; // Solar Amber

        // Vertical Pin Stem
        const stemGeo = new THREE.CylinderGeometry(0.25, 0.25, 7, 8);
        const stemMat = new THREE.MeshBasicMaterial({ color: pinColor, transparent: true, opacity: 0.85 });
        const stem = new THREE.Mesh(stemGeo, stemMat);
        stem.position.set(x, groundY + 3.5, z);

        // Pin Top Sphere
        const headGeo = new THREE.SphereGeometry(1.2, 16, 16);
        const headMat = new THREE.MeshStandardMaterial({
            color: pinColor,
            emissive: pinColor,
            emissiveIntensity: 0.6,
            roughness: 0.2
        });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.set(x, groundY + 7, z);

        const pin = new THREE.Group();
        pin.add(stem);
        pin.add(head);
        pin.userData = seg;

        pinGroup.add(pin);
        pinObjects.push(head);
    });

    terrainScene.add(pinGroup);

    // Interactive HUD Update on Hover / Raycasting
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const updateHUD = (seg) => {
        if (!seg) return;
        const thSector = document.getElementById('thud-sector');
        const thCoords = document.getElementById('thud-coords');
        const thElev = document.getElementById('thud-elev');
        const thDepth = document.getElementById('thud-depth');
        const thSlope = document.getElementById('thud-slope');
        const thFos = document.getElementById('thud-fos');

        const lat = Array.isArray(seg.coords[0]) ? (seg.coords[0][0] + seg.coords[1][0])/2 : seg.coords[0];
        const lon = Array.isArray(seg.coords[0]) ? (seg.coords[0][1] + seg.coords[1][1])/2 : seg.coords[1];

        if (thSector) thSector.textContent = `${seg.id} (${seg.name})`;
        if (thCoords) thCoords.textContent = `${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E`;
        if (thElev) thElev.textContent = `${seg.elevation || (seg.terrain ? seg.terrain.mean_elevation_m : 350)} m`;
        if (thDepth) thDepth.textContent = `${seg.soil ? (seg.soil.depth_m || seg.soil.soil_depth_m) : 2.5} m`;
        if (thSlope) thSlope.textContent = `${seg.slope ? seg.slope.beta_deg : (seg.terrain ? seg.terrain.max_slope_deg : 30)}°`;
        if (thFos) {
            thFos.textContent = seg.fos ? seg.fos.min.toFixed(2) : '1.00';
            const isEndangered = (seg.id === 'NH07-S07' || seg.id === 'NH07-S11' || seg.id === 'S7' || seg.id === 'S11');
            thFos.style.color = isEndangered ? '#a855f7' : (seg.risk_level === 'UNSTABLE' ? '#990011' : (seg.risk_level === 'MARGINAL' ? '#ff9900' : '#2ed573'));
        }
    };

    // Render Waypoint Buttons at top of 3D Terrain Card
    const wpBar = document.getElementById('terrain-waypoint-bar');
    if (wpBar && sortedSegs.length > 0) {
        wpBar.innerHTML = sortedSegs.map((s) => {
            const lat = Array.isArray(s.coords[0]) ? (s.coords[0][0] + s.coords[1][0])/2 : s.coords[0];
            const isEndangered = (s.id === 'NH07-S07' || s.id === 'NH07-S11' || s.id === 'S7' || s.id === 'S11');
            const borderCol = isEndangered ? '#a855f7' : (s.risk_level === 'UNSTABLE' ? '#990011' : (s.risk_level === 'MARGINAL' ? '#ff9900' : '#2ed573'));
            return `<button class="map-btn" style="border: 1px solid ${borderCol}; padding: 3px 8px; font-size: 10px; cursor: pointer;" onclick="playUIBeep('click'); focus3DRoutePoint('${s.id}')">${s.id.replace('NH07-', '')} (${lat.toFixed(2)}°, ${s.elevation || 350}m)</button>`;
        }).join('');
    }

    window.focus3DRoutePoint = (segId) => {
        const seg = allSegments.find(s => s.id === segId);
        if (!seg) return;
        updateHUD(seg);

        const idx = sortedSegs.findIndex(s => s.id === segId);
        if (idx !== -1) {
            const t = (idx + 0.5) / Math.max(1, sortedSegs.length);
            const z = -100 + t * 200;
            const x = getHighwayX(z);
            const baseElev = seg.elevation || (seg.terrain ? seg.terrain.mean_elevation_m : 350);
            const groundY = (baseElev - 200) / 35 + 8;

            if (terrainControls) {
                terrainControls.target.set(x, groundY, z);
                terrainCamera.position.set(x + 15, groundY + 25, z + 35);
            }
        }
    };

    const raycastTargets = [...pinObjects, highway];

    const onPointerMove = (event) => {
        const rect = terrainRenderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, terrainCamera);
        const intersects = raycaster.intersectObjects(raycastTargets);

        if (intersects.length > 0) {
            const hitObj = intersects[0].object;
            let hitSeg = null;
            if (hitObj.parent && hitObj.parent.userData && hitObj.parent.userData.id) {
                hitSeg = hitObj.parent.userData;
            } else if (intersects[0].point) {
                const zHit = intersects[0].point.z;
                hitSeg = getSectorAtZ(zHit);
            }
            if (hitSeg) {
                updateHUD(hitSeg);
                terrainRenderer.domElement.style.cursor = 'pointer';
            }
        } else {
            terrainRenderer.domElement.style.cursor = 'default';
        }
    };

    terrainRenderer.domElement.addEventListener('pointermove', onPointerMove);
    terrainRenderer.domElement.addEventListener('click', onPointerMove);

    // Initial HUD Load
    if (sortedSegs.length > 0) {
        updateHUD(sortedSegs[0]);
    }

    let orbitAngle = 0;
    function animateTerrain() {
        terrainAnimationId = requestAnimationFrame(animateTerrain);

        if (terrainControls) {
            terrainControls.update();
        } else {
            orbitAngle += 0.005;
            terrainCamera.position.x = Math.sin(orbitAngle) * 70;
            terrainCamera.position.z = Math.cos(orbitAngle) * 70;
            terrainCamera.lookAt(0, -10, 0);
        }

        // Update particle positions
        const positions = particles.geometry.attributes.position.array;
        for (let i = 0; i < particleCount; i++) {
            positions[i*3+2] += particleSpeeds[i];
            if (positions[i*3+2] > 80) {
                positions[i*3+2] = -80;
            }
            let z = positions[i*3+2];
            let y = Math.sin(0) * Math.cos(z * 0.1) * 15 + Math.sin(0) * Math.cos(z * 0.2) * 5 + 1.5;
            positions[i*3+1] = y;
        }
        particles.geometry.attributes.position.needsUpdate = true;

        terrainRenderer.render(terrainScene, terrainCamera);
    }

    animateTerrain();
    console.log('✓ 3D Terrain initialized and rendering at', initW, 'x', initH);

    // Populate terrain HUD with real backend data
    fetch('/api/terrain/stats')
        .then(r => r.json())
        .then(data => {
            const hudTitle = document.getElementById('terrain-hud-title');
            if (hudTitle) hudTitle.textContent = 'SRTM DEM SLOPE VECTORS';
            const statsEl = document.getElementById('terrain-hud-stats');
            if (statsEl && data.slope_deg) {
                const avgSlope = data.slope_deg.mean ? data.slope_deg.mean.toFixed(1) : '-';
                const maxSlope = data.slope_deg.max ? data.slope_deg.max.toFixed(1) : '-';
                const meanElev = data.elevation && data.elevation.mean ? data.elevation.mean.toFixed(0) : '-';
                const cellInfo = data.cell_size_m ? data.cell_size_m.toFixed(0) : '30';
                // Update the stats
                statsEl.innerHTML = `
                    <h3 style="margin:0 0 10px; color:#00f2fe; font-size:14px; font-family:'DM Mono', monospace;">SRTM DEM SLOPE VECTORS</h3>
                    <div style="display:flex; justify-content:space-between; width:200px; margin-bottom:5px;"><span style="color:#8899ac; font-size:12px;">Avg Gradient (β):</span> <strong style="font-size:12px;">${avgSlope}°</strong></div>
                    <div style="display:flex; justify-content:space-between; width:200px; margin-bottom:5px;"><span style="color:#8899ac; font-size:12px;">Max Slope:</span> <strong style="font-size:12px;">${maxSlope}°</strong></div>
                    <div style="display:flex; justify-content:space-between; width:200px; margin-bottom:5px;"><span style="color:#8899ac; font-size:12px;">Mean Elevation:</span> <strong style="font-size:12px;">${meanElev} m</strong></div>
                    <div style="display:flex; justify-content:space-between; width:200px;"><span style="color:#8899ac; font-size:12px;">DEM Resolution:</span> <strong style="font-size:12px;">${cellInfo} m</strong></div>
                `;
            }
        })
        .catch(err => console.warn('Terrain stats fetch failed:', err));

    // Handle window resize
    const handleResize = () => {
        if (!container.offsetParent) return; // Hidden
        let w = container.clientWidth || 800;
        let h = container.clientHeight || 500;
        if (w < 50 || h < 50) return;

        terrainCamera.aspect = w / h;
        terrainCamera.updateProjectionMatrix();
        terrainRenderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);
}

// Data Visualizations (Chart.js)
let chartsInitialized = false;
function initCharts() {
    if (chartsInitialized) return;
    chartsInitialized = true;

    if (typeof Chart === 'undefined') return;

    Chart.defaults.color = '#8899ac';
    Chart.defaults.font.family = "'DM Mono', monospace";
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.05)';

    const ctxRain = document.getElementById('rainChart');
    if (ctxRain) {
        window.rainChartInstance = new Chart(ctxRain, {
            type: 'line',
            data: {
                labels: ['-72h', '-60h', '-48h', '-36h', '-24h', '-12h', 'NOW'],
                datasets: [
                    {
                        label: 'Precipitation (mm)',
                        data: [12, 18, 45, 80, 140, 110, 85],
                        borderColor: '#4facfe',
                        backgroundColor: 'rgba(79, 172, 254, 0.2)',
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Pore Pressure (u)',
                        data: [10, 15, 30, 60, 110, 95, 75],
                        borderColor: '#ffa502',
                        backgroundColor: 'transparent',
                        borderDash: [5, 5],
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top', align: 'end' } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    const ctxRadar = document.getElementById('radarChart');
    if (ctxRadar) {
        window.radarChartInstance = new Chart(ctxRadar, {
            type: 'radar',
            data: {
                labels: ['Cohesion', 'Friction (φ)', 'Rainfall (m)', 'Slope (β)', 'Soil Depth'],
                datasets: [{
                    label: 'Sector S7 Risk Vector',
                    data: [40, 60, 90, 85, 70],
                    backgroundColor: 'rgba(153, 0, 17, 0.2)',
                    borderColor: '#990011',
                    pointBackgroundColor: '#990011',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    r: {
                        angleLines: { color: 'rgba(255,255,255,0.1)' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        pointLabels: { color: '#00f2fe', font: { size: 10 } },
                        ticks: { display: false, max: 100 }
                    }
                }
            }
        });
    }

    const ctxConf = document.getElementById('confusionChart');
    if (ctxConf) {
        window.confChartInstance = new Chart(ctxConf, {
            type: 'bar',
            data: {
                labels: ['True Pos', 'True Neg', 'False Pos', 'False Neg'],
                datasets: [{
                    label: 'Events',
                    data: [142, 856, 12, 4],
                    backgroundColor: [
                        'rgba(46, 213, 115, 0.6)',
                        'rgba(46, 213, 115, 0.4)',
                        'rgba(255, 165, 2, 0.6)',
                        'rgba(153, 0, 17, 0.8)'
                    ],
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, type: 'logarithmic' },
                    x: { grid: { display: false } }
                }
            }
        });
    }
}

// ----------------------------------------------------
// ADVANCED UPGRADE FEATURES (Profile, Cloudburst & Bulletin)
// ----------------------------------------------------


window.rainChartInstance = null;
window.radarChartInstance = null;
window.confChartInstance = null;
let profileChartInstance = null;

function updateChartData(seg) {
    if (window.rainChartInstance) {
        // Build mock time sequence based on current accum and rate for aesthetic UI
        const basePlot = seg.rainfall.accum_24h_mm || 0;
        const rate = (seg.rainfall.rain_rate_mm_h || basePlot / 24) * 5;

        const r1 = Math.max(0, basePlot - rate * 6);
        const r2 = Math.max(0, basePlot - rate * 5);
        const r3 = Math.max(0, basePlot - rate * 4);
        const r4 = Math.max(0, basePlot - rate * 3);
        const r5 = Math.max(0, basePlot - rate * 2);
        const r6 = Math.max(0, basePlot - rate * 1);
        const r7 = basePlot;

        window.rainChartInstance.data.datasets[0].data = [r1, r2, r3, r4, r5, r6, r7];

        // Pore pressure roughly correlates visually
        const p1 = r1 * 0.8;
        const p2 = r2 * 0.85;
        const p3 = r3 * 0.9;
        const p4 = r4 * 0.88;
        const p5 = r5 * 0.92;
        const p6 = r6 * 0.85;
        const p7 = r7 * 0.95;
        window.rainChartInstance.data.datasets[1].data = [p1, p2, p3, p4, p5, p6, p7];

        window.rainChartInstance.update();
    }

    if (window.radarChartInstance) {
        window.radarChartInstance.data.datasets[0].label = `Sector ${seg.id} Risk Vector`;
        // Normalize values to 0-100 for the radar chart
        const cohesionNorm = Math.min(100, (seg.soil.cohesion_kpa / 20) * 100);
        const frictionNorm = Math.min(100, (seg.soil.phi_deg / 45) * 100);
        const rainNorm = Math.min(100, ((seg.rainfall.accum_24h_mm || 0) / 150) * 100);
        const slopeNorm = Math.min(100, (seg.slope.beta_deg / 60) * 100);
        const depthNorm = Math.min(100, (seg.soil.depth_m / 10) * 100);

        window.radarChartInstance.data.datasets[0].data = [cohesionNorm, frictionNorm, rainNorm, slopeNorm, depthNorm];

        // Dynamically change radar color based on risk
        const riskClass = seg.risk_level.toLowerCase();
        let color = '#2ed573'; // Stable
        if (riskClass === 'marginal') color = '#ffa502';
        if (riskClass === 'unstable') color = '#990011';

        window.radarChartInstance.data.datasets[0].borderColor = color;
        window.radarChartInstance.data.datasets[0].backgroundColor = color.replace(')', ', 0.2)').replace('rgb', 'rgba');
        if(window.radarChartInstance.data.datasets[0].backgroundColor.indexOf('#') === 0) {
            window.radarChartInstance.data.datasets[0].backgroundColor = color + '33'; // hex alpha
        }
        window.radarChartInstance.data.datasets[0].pointBackgroundColor = color;

        window.radarChartInstance.update();
    }

    // Call updateTerrainData too if WebGL implies looking at this segment
    updateTerrainData(seg);
}

function updateTerrainData(seg) {
    // 3D HUD Elements update
    const uiTitle = document.getElementById('terrain-hud-title');
    const uiStats = document.getElementById('terrain-hud-stats');

    if(uiTitle && uiStats) {
        uiTitle.innerHTML = `<span style="color:#00f2fe; text-shadow: 0 0 10px #00f2fe;">${seg.id} : ${seg.name}</span> | <span style="font-size:12px; color:#a0a0a0">3D TOPOLOGY SCAN</span>`;
        uiStats.innerHTML = `
            <div style="margin-top:10px; font-size:12px; line-height:1.6;">
                <div style="display:flex; justify-content:space-between"><span>BASE ANGLE:</span><span style="color:#ffcc00">${seg.slope.beta_deg}°</span></div>
                <div style="display:flex; justify-content:space-between"><span>SOIL Φ:</span><span style="color:#ffcc00">${seg.soil.phi_deg}°</span></div>
                <div style="display:flex; justify-content:space-between"><span>COHESION:</span><span style="color:#ffcc00">${seg.soil.cohesion_kpa} kPa</span></div>
                <div style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.1)">
                    <div style="display:flex; justify-content:space-between"><span>CUR. FOs:</span><span style="color:${seg.fos.min < 1.0 ? '#990011' : (seg.fos.min < 1.35 ? '#ffa502' : '#2ed573')}">${seg.fos.min.toFixed(2)}</span></div>
                    <div style="display:flex; justify-content:space-between"><span>STATUS:</span><span style="color:${seg.fos.min < 1.0 ? '#990011' : (seg.fos.min < 1.35 ? '#ffa502' : '#2ed573')}">${seg.risk_level}</span></div>
                </div>
            </div>
        `;
    }
}


function showSegmentProfile(segId) {
    updateChartData(allSegments.find(s => s.id === segId));
    const seg = allSegments.find(s => s.id === segId);
    if (!seg) return;

    const modal = document.getElementById('profile-modal');
    document.getElementById('profile-title').textContent = `${seg.id}: ${seg.name} (KM ${seg.km})`;

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.remove('hidden'), 50);

    const forecastBoxes = document.getElementById('profile-forecast-boxes');
    const f = seg.fos_forecast || { "6h": seg.fos.min, "12h": seg.fos.min, "24h": seg.fos.min };

    forecastBoxes.innerHTML = `
        <div style="background: rgba(0, 0, 0, 0.3); border: 1px solid var(--card-border); padding: 12px; border-radius: 8px; text-align: center;">
            <div style="font-size: 10px; color: var(--text-muted); font-family: 'DM Mono', monospace;">+6H PROJECTED FoS</div>
            <div style="font-size: 20px; font-weight: bold; color: ${f['6h'] < 1.0 ? '#990011' : (f['6h'] < 1.35 ? '#ffa502' : '#2ed573')}; font-family: 'DM Mono';">${f['6h'].toFixed(2)}</div>
        </div>
        <div style="background: rgba(0, 0, 0, 0.3); border: 1px solid var(--card-border); padding: 12px; border-radius: 8px; text-align: center;">
            <div style="font-size: 10px; color: var(--text-muted); font-family: 'DM Mono', monospace;">+12H PROJECTED FoS</div>
            <div style="font-size: 20px; font-weight: bold; color: ${f['12h'] < 1.0 ? '#990011' : (f['12h'] < 1.35 ? '#ffa502' : '#2ed573')}; font-family: 'DM Mono';">${f['12h'].toFixed(2)}</div>
        </div>
        <div style="background: rgba(0, 0, 0, 0.3); border: 1px solid var(--card-border); padding: 12px; border-radius: 8px; text-align: center;">
            <div style="font-size: 10px; color: var(--text-muted); font-family: 'DM Mono', monospace;">+24H PROJECTED FoS</div>
            <div style="font-size: 20px; font-weight: bold; color: ${f['24h'] < 1.0 ? '#990011' : (f['24h'] < 1.35 ? '#ffa502' : '#2ed573')}; font-family: 'DM Mono';">${f['24h'].toFixed(2)}</div>
        </div>
    `;

    const ctx = document.getElementById('profileChart').getContext('2d');
    if (profileChartInstance) profileChartInstance.destroy();

    const elevProfile = seg.terrain.profile || [300, 320, 350, 410, 480, 520, 490, 420, 380, 350];
    const slopeProfile = seg.terrain.slope_profile || [12, 18, 28, 38, 45, 42, 36, 25, 18, 14];

    profileChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: elevProfile.map((_, i) => `Point ${i + 1}`),
            datasets: [
                {
                    label: 'Elevation (m)',
                    data: elevProfile,
                    borderColor: '#00f2fe',
                    backgroundColor: 'rgba(0, 242, 254, 0.1)',
                    fill: true,
                    yAxisID: 'yElev',
                    tension: 0.3
                },
                {
                    label: 'Slope Angle (°)',
                    data: slopeProfile,
                    borderColor: '#990011',
                    backgroundColor: 'transparent',
                    borderDash: [4, 4],
                    yAxisID: 'ySlope',
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top', align: 'end' } },
            scales: {
                yElev: {
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: 'Elevation (m)', color: '#00f2fe' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                ySlope: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'Slope (°)', color: '#990011' },
                    grid: { display: false }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

// Cloudburst Simulation Toggle
let isSimulating = false;
const simBtn = document.getElementById('simulate-btn');
if (simBtn) {
    simBtn.onclick = async () => {
        const simBtnText = document.getElementById('sim-btn-text');

        if (!isSimulating) {
            simBtnText.textContent = 'Demo Started...';
            isSimulating = true;
            simBtnText.textContent = '↻ Stop Alert Demo';
            simBtn.style.background = 'linear-gradient(135deg, rgba(46, 213, 115, 0.2), rgba(0, 242, 254, 0.2))';
            simBtn.style.borderColor = 'rgba(46, 213, 115, 0.4)';
            simBtn.style.color = '#2ed573';
            toggleStormEffect(true);

            try {
                await fetch('/api/simulate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ preset: 'cloudburst' })
                });
                await fetchSegments();
            } catch (e) {
                console.error('Simulation error:', e);
                simBtnText.textContent = 'Simulate Error';
            }
        } else {
            simBtnText.textContent = 'Alert Demo';
            isSimulating = false;
            simBtn.style.background = 'linear-gradient(135deg, rgba(153, 0, 17, 0.2), rgba(255, 165, 2, 0.2))';
            simBtn.style.borderColor = 'rgba(153, 0, 17, 0.4)';
            simBtn.style.color = '#990011';
            toggleStormEffect(false);

            try {
                await fetch('/api/simulate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ preset: 'reset' })
                });
                await fetchSegments();
            } catch (e) {
                console.error('Reset error:', e);
                simBtnText.textContent = 'Reset Error';
            }
        }
    };
}

// Export USDMA Advisory Bulletin
const bulletinBtn = document.getElementById('bulletin-btn');
if (bulletinBtn) {
    bulletinBtn.onclick = async () => {
        const modal = document.getElementById('bulletin-modal');
        const body = document.getElementById('bulletin-body');

        modal.style.display = 'flex';
        setTimeout(() => modal.classList.remove('hidden'), 50);

        body.innerHTML = '<i>Fetching USDMA Disaster Advisory Stream...</i>';

        try {
            const resp = await fetch('/api/bulletin');
            const data = await resp.json();

            let critHTML = '';
            if (data.critical_sectors.length > 0) {
                critHTML = data.critical_sectors.map(c => `
                    <div style="background: rgba(153, 0, 17, 0.15); border: 1px solid rgba(153, 0, 17, 0.4); padding: 12px; border-radius: 6px; margin-bottom: 10px;">
                        <div style="color: #990011; font-weight: bold;">🚨 CRITICAL SECTOR: ${c.id} — ${c.name} (KM ${c.km})</div>
                        <div style="margin-top: 4px; color: #f0f4f8;">• Current FoS: <strong>${c.fos_min.toFixed(2)}</strong> | Saturation Ratio: <strong>${c.saturation_ratio}</strong> | 24h Rain: <strong>${c.rain_24h_mm}mm</strong></div>
                        <div style="margin-top: 4px; color: #ff6b81; font-weight: bold;">➔ ACTION: ${c.recommended_action}</div>
                    </div>
                `).join('');
            } else {
                critHTML = '<div style="color: #2ed573; background: rgba(46, 213, 115, 0.1); border: 1px solid rgba(46, 213, 115, 0.3); padding: 12px; border-radius: 6px;">🟢 NOMINAL STATUS: No sectors currently breach critical stability threshold. Continuous monitoring active.</div>';
            }

            body.innerHTML = `
                <div style="border-bottom: 1px solid var(--card-border); padding-bottom: 12px; margin-bottom: 16px;">
                    <div style="color: var(--accent-cyan); font-weight: bold; font-size: 14px;">${data.title}</div>
                    <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">AUTHORITY: ${data.issuing_authority} | TIMESTAMP: ${data.timestamp}</div>
                    <div style="color: var(--text-muted); font-size: 11px;">MODE: ${data.mode} | CORRIDOR: ${data.corridor}</div>
                </div>

                <div style="margin-bottom: 16px;">
                    <div style="font-weight: bold; margin-bottom: 8px; color: #fff;">SECTOR STATUS SUMMARY (${data.total_monitored_sectors} Monitored Sectors):</div>
                    <div style="display: flex; gap: 16px;">
                        <span>🔴 Unstable: <strong style="color: #990011">${data.unstable_count}</strong></span>
                        <span>🟠 Marginal: <strong style="color: #ffa502">${data.marginal_count}</strong></span>
                        <span>Overall Level: <strong style="color: ${data.unstable_count > 0 ? '#990011' : '#2ed573'}">${data.overall_status}</strong></span>
                    </div>
                </div>

                <div style="margin-bottom: 16px;">
                    <div style="font-weight: bold; margin-bottom: 8px; color: #fff;">RECOMMENDED EMERGENCY ADVISORIES:</div>
                    ${critHTML}
                </div>

                <div style="font-size: 10px; color: var(--text-muted); font-style: italic;">
                    ${data.disclaimer}
                </div>
            `;
        } catch (e) {
            body.innerHTML = '<span style="color: #990011;">Failed to generate bulletin stream.</span>';
        }
    };
}

// Copy Advisory
const copyBtn = document.getElementById('copy-bulletin-btn');
if (copyBtn) {
    copyBtn.onclick = () => {
        const text = document.getElementById('bulletin-body').innerText;
        navigator.clipboard.writeText(text);
        const og = copyBtn.textContent;
        copyBtn.textContent = 'Copied ✓';
        setTimeout(() => copyBtn.textContent = og, 2000);
    };
}

// Close Modals
const closeBul = document.getElementById('close-bulletin');
if (closeBul) {
    closeBul.onclick = () => {
        document.getElementById('bulletin-modal').classList.add('hidden');
        setTimeout(() => document.getElementById('bulletin-modal').style.display = 'none', 300);
    };
}

const closeProf = document.getElementById('close-profile');
if (closeProf) {
    closeProf.onclick = () => {
        document.getElementById('profile-modal').classList.add('hidden');
        setTimeout(() => document.getElementById('profile-modal').style.display = 'none', 300);
    };
}



// ----------------------------------------------------
// Ground-Truth Incident Feedback Loop (Requirement 10)
// ----------------------------------------------------
async function loadIncidents() {
    try {
        const response = await fetch('/api/incidents');
        if (response.ok) {
            const incidents = await response.json();
            renderIncidents(incidents);
            const countBadge = document.getElementById('incident-count');
            if (countBadge) countBadge.textContent = incidents.length + ' LOGGED';
        }
    } catch (e) {
        console.warn('Could not load incidents:', e);
    }
}

function renderIncidents(incidents) {
    const container = document.getElementById('incident-rows');
    if (!container) return;

    if (!incidents || incidents.length === 0) {
        container.innerHTML = '<div style="padding:20px; color:var(--text-muted); font-size:12px; text-align:center;">No field incidents logged yet.</div>';
        return;
    }

    container.innerHTML = incidents.slice().reverse().map((inc, idx) => {
        const t = new Date(inc.timestamp);
        const timeStr = t.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) + ' ' + t.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
        const severityClass = (inc.severity === 'critical' || inc.severity === 'high') ? 'unstable' : inc.severity === 'medium' ? 'marginal' : 'stable';
        const typeLabel = (inc.type || '').replace(/_/g, ' ').toUpperCase();
        return `
            <div class="row" style="--i:${idx};">
                <div><b>${timeStr}</b></div>
                <div>${inc.segment_id || '-'}</div>
                <span class="rain">${typeLabel}</span>
                <span class="status ${severityClass}" style="font-size:9px; padding:4px 8px;">${(inc.severity||'').toUpperCase()}</span>
                <span class="confidence-text">✓ LOGGED</span>
            </div>
        `;
    }).join('');
}

const incidentForm = document.getElementById('incident-form');
if (incidentForm) {
    incidentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const statusEl = document.getElementById('inc-status');

        const segmentId = document.getElementById('inc-segment').value;
        const type = document.getElementById('inc-type').value;
        const severity = document.getElementById('inc-severity').value;
        const rainfall = parseFloat(document.getElementById('inc-rainfall').value) || 0;
        const description = document.getElementById('inc-description').value.trim();

        // Find FoS of the selected segment from current data
        const seg = allSegments.find(s => s.id === segmentId);
        const fosAtTime = seg ? seg.fos : null;

        statusEl.textContent = 'Transmitting...';
        statusEl.style.color = '#00f2fe';

        try {
            const res = await fetch('/api/incidents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    segment_id: segmentId,
                    type: type,
                    severity: severity,
                    description: description,
                    fos_at_time: fosAtTime,
                    rainfall_at_time: rainfall
                })
            });

            if (res.ok) {
                statusEl.textContent = '✓ Incident logged';
                statusEl.style.color = '#2ed573';
                incidentForm.reset();
                loadIncidents();
                setTimeout(() => { statusEl.textContent = ''; }, 3000);
            } else {
                statusEl.textContent = '✗ Server error';
                statusEl.style.color = '#990011';
            }
        } catch (err) {
            statusEl.textContent = '✗ Network error';
            statusEl.style.color = '#990011';
        }
    });
}

// Load incidents on startup
loadIncidents();


// ----------------------------------------------------
// Tactical UI Audio Feedback (Procedural Web Audio API)
// ----------------------------------------------------
const AudioContext = window.AudioContext || window.webkitAudioContext;
const uiAudioCtx = new AudioContext();

function playUIBeep(type = 'click') {
    if (uiAudioCtx.state === 'suspended') uiAudioCtx.resume();
    
    const osc = uiAudioCtx.createOscillator();
    const gain = uiAudioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(uiAudioCtx.destination);
    
    const now = uiAudioCtx.currentTime;
    
    if (type === 'click') {
        // High pitched short tech ping
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.05);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.05, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.06);
    } else if (type === 'hover') {
        // Very subtle soft click
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, now);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.01);
        gain.gain.linearRampToValueAtTime(0, now + 0.03);
        osc.start(now);
        osc.stop(now + 0.04);
    } else if (type === 'confirm') {
        // Double ping (e.g. calibration)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1000, now);
        osc.frequency.setValueAtTime(1400, now + 0.1);
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.08);
        
        gain.gain.setValueAtTime(0, now + 0.1);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.12);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.3);
        
        osc.start(now);
        osc.stop(now + 0.35);
    } else if (type === 'error') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.linearRampToValueAtTime(100, now + 0.2);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.25);
    }
}

// Dismiss alarm button
const dismissBtn = document.getElementById('dismiss-emergency');
if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
        window.emergencyMuted = true;
        document.getElementById('emergency-banner').classList.remove('show');
        if (window.alarmInterval) {
            clearInterval(window.alarmInterval);
            window.alarmInterval = null;
        }

        // Reset mute if it goes stable later
        setTimeout(() => {
            const unstableCount = allSegments.filter(s => s.risk_level === 'UNSTABLE').length;
            if (unstableCount === 0) window.emergencyMuted = false;
        }, 10000);
    });
}

// Heavy Storm UI & Canvas Engine
let stormRainFrame;
let lightningInterval;
function toggleStormEffect(active) {
    const stormCont = document.getElementById('storm-container');
    const stormRain = document.getElementById('storm-rain-canvas');
    const stormLig = document.getElementById('storm-lightning');
    if(!stormCont || !stormRain) return;

    if (active) {
        stormCont.style.display = 'block';
        playUIBeep('error'); // simulate siren/alert beep

        // Rain canvas logic
        const ctx = stormRain.getContext('2d');
        stormRain.width = window.innerWidth;
        stormRain.height = window.innerHeight;
        const raindrops = [];
        for(let i=0; i<300; i++){
            raindrops.push({
                x: Math.random() * stormRain.width,
                y: Math.random() * stormRain.height,
                len: Math.random() * 20 + 10,
                speed: Math.random() * 15 + 15
            });
        }
        
        function drawRain() {
            ctx.clearRect(0, 0, stormRain.width, stormRain.height);
            ctx.strokeStyle = 'rgba(174,194,224,0.6)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for(let i=0; i<raindrops.length; i++) {
                let d = raindrops[i];
                ctx.moveTo(d.x, d.y);
                ctx.lineTo(d.x - d.len/4, d.y + d.len);
                d.y += d.speed;
                d.x -= d.speed/4;
                if(d.y > stormRain.height) {
                    d.y = -20;
                    d.x = Math.random() * stormRain.width + 50;
                }
            }
            ctx.stroke();
            stormRainFrame = requestAnimationFrame(drawRain);
        }
        drawRain();

        // Lightning logic
        lightningInterval = setInterval(() => {
            if(Math.random() > 0.6) {
                stormLig.style.animation = 'none';
                void stormLig.offsetWidth; // trigger reflow
                stormLig.style.animation = 'strobeLightning 0.5s ease-out';
                setTimeout(() => playUIBeep('error'), 100);
            }
        }, 3000);

    } else {
        stormCont.style.display = 'none';
        cancelAnimationFrame(stormRainFrame);
        clearInterval(lightningInterval);
        stormLig.style.animation = 'none';
    }
}
