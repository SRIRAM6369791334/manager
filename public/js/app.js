let currentView = 'plugins';
let authToken = localStorage.getItem('antigravity_auth') || null;

// Intercept fetch to add auth header
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    let [resource, config] = args;
    config = config || {};
    config.headers = config.headers || {};
    if (authToken) {
        config.headers['Authorization'] = `Bearer ${authToken}`;
    }
    const response = await originalFetch(resource, config);
    if (response.status === 401 && resource !== '/api/login') {
        logout();
    }
    return response;
};

async function attemptLogin() {
    const pwd = document.getElementById('login-password').value;
    const res = await originalFetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password: pwd })
    });
    if (res.ok) {
        const data = await res.json();
        authToken = data.token;
        localStorage.setItem('antigravity_auth', authToken);
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('main-app').style.display = 'flex';
        document.getElementById('login-error').style.display = 'none';
        loadInitialData();
    } else {
        document.getElementById('login-error').style.display = 'block';
    }
}

function logout() {
    authToken = null;
    localStorage.removeItem('antigravity_auth');
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('main-app').style.display = 'none';
}

function initAuth() {
    if (authToken) {
        // Quick check
        fetch('/api/metrics').then(res => {
            if (res.ok) {
                document.getElementById('login-overlay').style.display = 'none';
                document.getElementById('main-app').style.display = 'flex';
                loadInitialData();
            }
        });
    }
}

function loadInitialData() {
    loadViewData('plugins');
    setInterval(updateMetrics, 2000);
    updateMetrics();
    fetchTokenBudget();
}

window.onload = () => {
    initAuth();
};

// Theme Management
function initTheme() {
    const savedTheme = localStorage.getItem('antigravity_theme') || 'theme-cyberpunk';
    setTheme(savedTheme);
}
function setTheme(themeClass) {
    document.body.className = themeClass;
    localStorage.setItem('antigravity_theme', themeClass);
    document.querySelectorAll('.theme-circle').forEach(c => c.classList.remove('active'));
    const circle = document.querySelector(`.tc-${themeClass.split('-')[1]}`);
    if(circle) circle.classList.add('active');
}
initTheme();

// Navigation Logic
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        
        const target = item.getAttribute('data-target');
        document.querySelectorAll('.view-section').forEach(view => view.classList.remove('active'));
        document.getElementById(`view-${target}`).classList.add('active');
        
        document.getElementById('page-title').innerText = item.innerText.trim().toUpperCase();
        currentView = target;
        loadViewData(target);
    });
});

function loadViewData(view) {
    if (view === 'plugins') fetchPlugins();
    else if (view === 'skills') fetchSkills();
    else if (view === 'tasks') fetchTasks();
    else if (view === 'analytics') fetchAnalytics();
    else if (view === 'session-analytics') fetchSessionAnalytics();
    else if (view === 'backup') fetchBackups();
    else if (view === 'global-rules') fetchRules();
    else if (view === 'subagents') fetchAgents();
    else if (view === 'online-store') fetchStore();
    else if (view === 'macros') fetchMacros();
    else if (view === 'memory') fetchMemory();
    else if (view === 'system-controls') initSystemControlsView();
    else if (view === 'subagents-arena') initArenaView();
    else if (view === 'settings') loadSettingsView();
    
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) saveBtn.style.display = view === 'plugins' ? 'block' : 'none';
}

function showNotification(msg) {
    const notif = document.getElementById('notification');
    notif.innerText = msg;
    notif.classList.add('show');
    setTimeout(() => { notif.classList.remove('show'); }, 3000);
}

// System Metrics Polling
async function fetchMetrics() {
    try {
        const res = await fetch('/api/metrics');
        const data = await res.json();
        document.getElementById('cpu-metric').innerText = `${data.cpu}%`;
        document.getElementById('ram-metric').innerText = `${data.memUsagePct}% (${data.freeMemGb}GB free)`;
    } catch(e) {}
}
setInterval(fetchMetrics, 2000);
fetchMetrics();

// Analytics
async function fetchAnalytics() {
    try {
        const res = await fetch('/api/analytics');
        const data = await res.json();
        const container = document.getElementById('analytics-container');
        container.innerHTML = `
            <div class="card" style="flex-direction:column; align-items:flex-start; background:rgba(0, 240, 255, 0.05)">
                <div class="usage-label">TOTAL PLUGINS INSTALLED</div>
                <div style="font-size:36px; font-weight:bold; color:var(--theme-primary);">${data.totalPlugins}</div>
                <div class="list-item-desc">${data.activePlugins} Currently Active</div>
            </div>
            <div class="card" style="flex-direction:column; align-items:flex-start; background:rgba(217, 70, 239, 0.05)">
                <div class="usage-label">TOTAL SKILLS AVAILABLE</div>
                <div style="font-size:36px; font-weight:bold; color:#d946ef;">${data.totalSkills}</div>
                <div class="list-item-desc">Ready for Agents</div>
            </div>
            <div class="card" style="flex-direction:column; align-items:flex-start; background:rgba(16, 185, 129, 0.05)">
                <div class="usage-label">SCHEDULED BACKGROUND TASKS</div>
                <div style="font-size:36px; font-weight:bold; color:#10b981;">${data.scheduledTasks}</div>
                <div class="list-item-desc">Running in Node Loop</div>
            </div>
        `;
    } catch(e) { console.error(e); }
}

// Git Integration
async function runGit(command) {
    const repoPath = document.getElementById('git-path').value;
    const message = document.getElementById('git-msg').value;
    const term = document.getElementById('git-terminal');
    
    term.innerHTML += `<div class="log-line">> Executing git ${command}...</div>`;
    term.scrollTop = term.scrollHeight;

    try {
        const res = await fetch('/api/git', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, repoPath, message })
        });
        const data = await res.json();
        
        const outputLine = document.createElement('div');
        outputLine.className = data.success ? 'log-line info' : 'log-line error';
        outputLine.innerText = data.output || data.error || 'Command completed with no output.';
        term.appendChild(outputLine);
        term.scrollTop = term.scrollHeight;
        
        if (command === 'commit') {
            document.getElementById('git-msg').value = '';
            showNotification('COMMIT CREATED');
        } else if (command === 'push') {
            showNotification('PUSH SUCCESSFUL');
        }
    } catch(e) {
        term.innerHTML += `<div class="log-line error">Failed to execute command: ${e.message}</div>`;
    }
}

// Tasks Integration
async function fetchTasks() {
    try {
        const res = await fetch('/api/tasks');
        const data = await res.json();
        const container = document.getElementById('tasks-container');
        container.innerHTML = '';
        if (data.length === 0) {
            container.innerHTML = `<div style="color:#64748b; font-size:12px;">No tasks scheduled.</div>`;
        }
        data.forEach(item => {
            const div = document.createElement('div');
            div.className = 'list-item';
            div.innerHTML = `
                <div>
                    <div class="list-item-title">${item.name}</div>
                    <div class="list-item-desc">${item.command}</div>
                    <div style="font-size:10px; color:var(--theme-primary); margin-top:4px;">&#8635; ${item.schedule}</div>
                </div>
                <button class="btn btn-danger" onclick="deleteTask('${item.id}')">Delete</button>
            `;
            container.appendChild(div);
        });
    } catch (e) { console.error(e); }
}

async function createTask() {
    const name = document.getElementById('task-name').value;
    const command = document.getElementById('task-cmd').value;
    const schedule = document.getElementById('task-schedule').value;
    
    if(!name || !command) return alert("Name and Command required!");
    
    try {
        await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, command, schedule })
        });
        document.getElementById('task-name').value = '';
        document.getElementById('task-cmd').value = '';
        document.getElementById('task-schedule').value = '';
        showNotification('TASK CREATED');
        fetchTasks();
    } catch(e) { alert("Failed to create task"); }
}

async function deleteTask(id) {
    try {
        await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
        showNotification('TASK DELETED');
        fetchTasks();
    } catch(e) { alert("Failed to delete task"); }
}

// --------------------------------------------------------
// PLUGINS (Existing Code)
// --------------------------------------------------------
let allPlugins = [];
async function fetchPlugins() {
    try {
        const res = await fetch('/api/plugins');
        allPlugins = await res.json();
        renderPlugins();
    } catch (err) { console.error('Fetch failed', err); }
}

function renderPlugins() {
    const container = document.getElementById('plugin-container');
    container.innerHTML = '';
    allPlugins.sort((a, b) => a.name.localeCompare(b.name)).forEach((p) => {
        const card = document.createElement('div');
        card.className = 'card ' + (p.active ? '' : ' inactive');
        card.innerHTML = `
            <div class='card-icon-area'>
                <div class='icon-box'><svg viewBox='0 0 24 24'><rect x='3' y='4' width='18' height='16' rx='2'/><path d='M7 14l3-3 3 3 4-4'/><path d='M3 10h18'/></svg></div>
                <div class='usage-stats'><div class='usage-label'>STATUS:</div><div class='usage-val'>${p.active ? 'HEALTHY' : 'STANDBY'}</div></div>
            </div>
            <div class='card-content'>
                <div class='card-title'>${p.name}</div>
                <div class='card-status-row'>
                    <span class='status ${p.active ? "" : "inactive"}'>${p.active ? 'ACTIVE' : 'INACTIVE'}</span>
                    <span class='storage'>v1.0.0</span>
                </div>
                <div class='chart-area'>
                    <svg class='chart-svg' viewBox='0 0 100 30' preserveAspectRatio='none'>
                        <polygon class='chart-fill' points='0,30 0,20 15,10 30,20 45,15 60,25 75,10 85,15 100,5 100,30' />
                        <path class='chart-line' d='M0,20 L15,10 L30,20 L45,15 L60,25 L75,10 L85,15 L100,5' />
                    </svg>
                </div>
            </div>
            <div class='card-controls'>
                <div class='toggle-wrapper' onclick='togglePlugin("${p.name}")'>
                    <div class='toggle ${p.active ? 'active' : ''}'><span class='toggle-text-on'>ON</span></div>
                    <span class='toggle-label-off'>OFF</span>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function togglePlugin(name) {
    const plugin = allPlugins.find(p => p.name === name);
    if (plugin) { plugin.active = !plugin.active; renderPlugins(); }
}

async function saveChanges() {
    if (currentView !== 'plugins') return;
    try {
        const activePlugins = allPlugins.filter(p => p.active).map(p => p.name);
        await fetch('/api/plugins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activePlugins })
        });
        showNotification('PLUGINS SYNCED');
    } catch (err) { alert('Failed to sync config'); }
}

// --------------------------------------------------------
// SKILLS
// --------------------------------------------------------
async function fetchSkills() {
    try {
        const res = await fetch('/api/skills');
        const skills = await res.json();
        const container = document.getElementById('skills-container');
        container.innerHTML = '';
        skills.forEach((s) => {
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class='card-icon-area'><div class='icon-box'><svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></div></div>
                <div class='card-content'>
                    <div class='card-title'>${s.name}</div>
                    <div style="font-size:11px; color:#94a3b8; margin-top:4px;">${s.description}</div>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (e) { console.error(e); }
}

// --------------------------------------------------------
// LOGS
// --------------------------------------------------------
let evtSource = null;
function setupLogStream() {
    if (evtSource) return;
    evtSource = new EventSource('/api/logs');
    const container = document.getElementById('log-container');
    evtSource.onmessage = function(event) {
        const line = document.createElement('div');
        line.className = 'log-line';
        line.innerText = event.data;
        container.appendChild(line);
        container.scrollTop = container.scrollHeight;
    };
}
setupLogStream();

// --------------------------------------------------------
// MODULE: SESSION ANALYTICS
// --------------------------------------------------------
let hourlyChartInst = null;
let skillsChartInst = null;

async function fetchSessionAnalytics() {
    try {
        const res = await fetch('/api/session-analytics');
        const data = await res.json();

        // Stat Cards
        const statsEl = document.getElementById('sa-stats');
        statsEl.innerHTML = [
            { label: 'Total Sessions', value: data.totalSessions, color: 'var(--theme-primary)' },
            { label: 'Total User Messages', value: data.totalUserMessages, color: '#d946ef' }
        ].map(s => `
            <div class="card" style="flex-direction:column; align-items:flex-start; padding:20px;">
                <div style="font-size:10px; color:var(--text-muted); letter-spacing:1px;">${s.label}</div>
                <div style="font-size:42px; font-weight:bold; color:${s.color};">${s.value}</div>
            </div>`).join('');

        // Hourly Activity Bar Chart
        const hCtx = document.getElementById('hourlyChart').getContext('2d');
        if (hourlyChartInst) hourlyChartInst.destroy();
        hourlyChartInst = new Chart(hCtx, {
            type: 'bar',
            data: {
                labels: Array.from({length:24}, (_,i) => `${i}h`),
                datasets: [{ label: 'Messages', data: data.hourlyActivity,
                    backgroundColor: 'rgba(0,240,255,0.3)', borderColor: 'rgba(0,240,255,0.8)',
                    borderWidth: 1, borderRadius: 4 }]
            },
            options: { responsive: true, plugins: { legend: { display: false } },
                scales: { x: { ticks: { color: '#64748b', font:{size:9} }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } } } }
        });

        // Top Skills Doughnut Chart
        const topSkills = Object.entries(data.skillUsage).sort((a,b) => b[1]-a[1]).slice(0,6);
        const sCtx = document.getElementById('skillsChart').getContext('2d');
        if (skillsChartInst) skillsChartInst.destroy();
        if (topSkills.length > 0) {
            skillsChartInst = new Chart(sCtx, {
                type: 'doughnut',
                data: {
                    labels: topSkills.map(s => s[0].replace('SK-','')),
                    datasets: [{ data: topSkills.map(s => s[1]),
                        backgroundColor: ['#00f0ff','#d946ef','#3b82f6','#10b981','#f59e0b','#ef4444'],
                        borderWidth: 0 }]
                },
                options: { responsive: true, plugins: { legend: { position: 'bottom',
                    labels: { color: '#94a3b8', font:{size:9}, boxWidth: 10 } } } }
            });
        } else {
            document.getElementById('skillsChart').parentElement.innerHTML += '<div style="color:#64748b;font-size:12px;">No skill data yet.</div>';
        }
    } catch(e) { console.error('Session analytics error:', e); }
}

// --------------------------------------------------------
// MODULE: FILE WATCHER
// --------------------------------------------------------
let watcherSSE = null;

async function startWatcher() {
    const watchPath = document.getElementById('watch-path').value;
    const terminal  = document.getElementById('watcher-terminal');
    try {
        const res = await fetch('/api/watch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ watchPath })
        });
        const data = await res.json();
        if (!data.success) {
            terminal.innerHTML = `<div class="log-line error">[ERROR] ${data.error}</div>`;
            return;
        }
        terminal.innerHTML = `<div class="log-line info">[WATCHING] ${watchPath}</div>`;
        if (watcherSSE) watcherSSE.close();
        watcherSSE = new EventSource('/api/watch/stream');
        watcherSSE.onmessage = function(e) {
            const ev = JSON.parse(e.data);
            if (!ev.file) return;
            const line = document.createElement('div');
            line.className = `log-line ${ev.event === 'rename' ? 'error' : ''}`;
            line.innerText = `[${new Date(ev.time).toLocaleTimeString()}] ${ev.event.toUpperCase()} → ${ev.file}`;
            terminal.appendChild(line);
            terminal.scrollTop = terminal.scrollHeight;
        };
    } catch(e) { console.error(e); }
}

// --------------------------------------------------------
// MODULE: BACKUP & RESTORE
// --------------------------------------------------------
async function fetchBackups() {
    try {
        const res = await fetch('/api/backup');
        const backups = await res.json();
        const container = document.getElementById('backup-list');
        if (backups.length === 0) {
            container.innerHTML = '<div style="color:#64748b;font-size:12px;">No backups yet. Create your first one!</div>';
            return;
        }
        container.innerHTML = backups.map(b => `
            <div class="list-item">
                <div>
                    <div class="list-item-title">${b.name}</div>
                    <div class="list-item-desc">${b.date} &nbsp;|&nbsp; ${b.size}</div>
                </div>
                <button class="btn btn-danger" onclick="deleteBackup('${b.name}')">Delete</button>
            </div>`).join('');
    } catch(e) { console.error(e); }
}

async function createBackup() {
    const btn = document.getElementById('backup-btn');
    btn.innerText = 'Creating...';
    btn.disabled = true;
    try {
        const res = await fetch('/api/backup', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showNotification(`BACKUP CREATED: ${data.size}`);
            fetchBackups();
        } else {
            alert('Backup failed: ' + data.error);
        }
    } catch(e) { alert('Backup error: ' + e.message); }
    btn.innerText = 'Create Backup Now';
    btn.disabled = false;
}

async function deleteBackup(name) {
    try {
        await fetch(`/api/backup/${encodeURIComponent(name)}`, { method: 'DELETE' });
        showNotification('BACKUP DELETED');
        fetchBackups();
    } catch(e) { alert('Delete failed'); }
}

// STAGE 4: GLOBAL RULES
async function fetchRules() {
    try {
        const res = await fetch('/api/rules');
        const data = await res.json();
        const html = data.map(r => `
            <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div class="list-item-title">${r.name.replace('.disabled', '')}</div>
                    <div class="list-item-desc" style="white-space:pre-wrap; font-size:11px; max-height:40px; overflow:hidden;">${r.content.substring(0,60)}...</div>
                </div>
                <div>
                    <button class="btn ${r.active ? 'btn-success' : ''}" onclick="toggleRule('${r.name}', !${r.active}, \`${r.content.replace(/`/g, '\\`')}\`)">${r.active ? 'Active' : 'Enable'}</button>
                    <button class="btn btn-danger" onclick="deleteRule('${r.name}')">X</button>
                </div>
            </div>`).join('');
        document.getElementById('rules-list').innerHTML = html;
    } catch(e) { console.error(e); }
}
function openRuleForm() { document.getElementById('rule-form').style.display = 'block'; }
function closeRuleForm() { document.getElementById('rule-form').style.display = 'none'; }
async function saveRule() {
    const name = document.getElementById('rule-name-input').value;
    const content = document.getElementById('rule-content-input').value;
    if(!name || !content) return alert("Fill all fields");
    try {
        await fetch('/api/rules', { method: 'POST', body: JSON.stringify({ name, content, active: true }) });
        closeRuleForm(); document.getElementById('rule-name-input').value = ''; document.getElementById('rule-content-input').value = '';
        fetchRules(); showNotification('RULE SAVED');
    } catch(e) { console.error(e); }
}
async function toggleRule(name, active, content) {
    try {
        await fetch('/api/rules', { method: 'POST', body: JSON.stringify({ name, content, active }) });
        fetchRules(); showNotification('RULE UPDATED');
    } catch(e) { console.error(e); }
}
async function deleteRule(name) {
    try {
        await fetch(`/api/rules/${encodeURIComponent(name)}`, { method: 'DELETE' });
        fetchRules(); showNotification('RULE DELETED');
    } catch(e) { console.error(e); }
}

// STAGE 4: SUBAGENTS
async function fetchAgents() {
    try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        const html = data.map(a => `
            <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div class="list-item-title">${a.name}</div>
                    <div class="list-item-desc">${a.description}</div>
                </div>
                <button class="btn btn-danger" onclick="deleteAgent('${a.filename}')">Delete</button>
            </div>`).join('');
        document.getElementById('agents-list').innerHTML = html;
    } catch(e) { console.error(e); }
}
async function createAgent() {
    const name = document.getElementById('agent-name').value;
    const description = document.getElementById('agent-desc').value;
    const system_prompt = document.getElementById('agent-prompt').value;
    if(!name || !system_prompt) return alert("Fill name and prompt");
    try {
        await fetch('/api/agents', { method: 'POST', body: JSON.stringify({ name, description, system_prompt }) });
        document.getElementById('agent-name').value = ''; document.getElementById('agent-desc').value = ''; document.getElementById('agent-prompt').value = '';
        fetchAgents(); showNotification('AGENT CREATED');
    } catch(e) { console.error(e); }
}
async function deleteAgent(filename) {
    try {
        await fetch(`/api/agents/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        fetchAgents(); showNotification('AGENT DELETED');
    } catch(e) { console.error(e); }
}

// STAGE 4: ONLINE STORE
async function fetchStore() {
    try {
        const res = await fetch('/api/store/skills');
        const data = await res.json();
        const html = data.map(s => `
            <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div class="list-item-title">${s.name}</div>
                    <div class="list-item-desc">${s.desc}</div>
                </div>
                <button class="btn btn-success" onclick="installSkill('${s.id}', '${s.name}', '${s.desc}')">Install</button>
            </div>`).join('');
        document.getElementById('store-list').innerHTML = html;
    } catch(e) { console.error(e); }
}
async function installSkill(id, name, desc) {
    try {
        await fetch('/api/store/install', { method: 'POST', body: JSON.stringify({ id, name, desc }) });
        showNotification('SKILL INSTALLED SUCCESSFULLY');
    } catch(e) { console.error(e); }
}

// STAGE 4: CUSTOM MACROS
async function fetchMacros() {
    try {
        const res = await fetch('/api/macros');
        const data = await res.json();
        const html = data.map(m => `
            <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div class="list-item-title">/${m.name}</div>
                    <div class="list-item-desc" style="white-space:pre-wrap; font-size:11px;">${m.content.substring(0,50)}...</div>
                </div>
                <button class="btn btn-danger" onclick="deleteMacro('${m.filename}')">Delete</button>
            </div>`).join('');
        document.getElementById('macros-list').innerHTML = html;
    } catch(e) { console.error(e); }
}
async function createMacro() {
    const name = document.getElementById('macro-name').value;
    const content = document.getElementById('macro-content').value;
    if(!name || !content) return alert("Fill all fields");
    try {
        await fetch('/api/macros', { method: 'POST', body: JSON.stringify({ name, content }) });
        document.getElementById('macro-name').value = ''; document.getElementById('macro-content').value = '';
        fetchMacros(); showNotification('MACRO CREATED');
    } catch(e) { console.error(e); }
}
async function deleteMacro(filename) {
    try {
        await fetch(`/api/macros/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        fetchMacros(); showNotification('MACRO DELETED');
    } catch(e) { console.error(e); }
}

// STAGE 4: MEMORY INJECTOR
async function fetchMemory() {
    try {
        const res = await fetch('/api/memory');
        const data = await res.json();
        document.getElementById('memory-content').value = data.content || '';
    } catch(e) { console.error(e); }
}
async function saveMemory() {
    const content = document.getElementById('memory-content').value;
    try {
        await fetch('/api/memory', { method: 'POST', body: JSON.stringify({ content }) });
        showNotification('MEMORY INJECTED');
        document.getElementById('memory-status').innerText = "Memory actively synced to Antigravity.";
    } catch(e) { console.error(e); }
}

async function fetchTokenBudget() {
    try {
        const res = await fetch('/api/bridge/tokens');
        if (!res.ok) return;
        const data = await res.json();
        const total = data.totalTokens;
        const metric = document.getElementById('token-metric');
        metric.innerText = `${total} / 2000`;
        if (total > 2000) {
            metric.style.color = '#ff4444'; // Red if over budget
        } else if (total > 1600) {
            metric.style.color = '#ffcc00'; // Yellow if warning
        } else {
            metric.style.color = 'var(--primary-color)'; // Normal
        }
    } catch(e) { console.error(e); }
}

// --- SYSTEM CONTROLS FRONTEND HANDLERS ---
async function initSystemControlsView() {
    try {
        const res = await fetch('/api/system/volume');
        if (res.ok) {
            const data = await res.json();
            const vol = data.volume;
            document.getElementById('volume-range').value = vol;
            document.getElementById('volume-label').innerText = `${vol}%`;
        }
    } catch (e) {
        console.error('Error fetching volume:', e);
    }
}

function updateVolumeLabel(val) {
    document.getElementById('volume-label').innerText = `${val}%`;
}

async function applyVolume(val) {
    try {
        await fetch('/api/system/volume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ volume: parseInt(val) })
        });
        showNotification(`VOLUME SET TO ${val}%`);
    } catch (e) {
        console.error('Error applying volume:', e);
    }
}

function setVolumeLevel(val) {
    document.getElementById('volume-range').value = val;
    updateVolumeLabel(val);
    applyVolume(val);
}

async function applyMedia(action) {
    try {
        await fetch('/api/system/media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        showNotification(`MEDIA ${action.toUpperCase()}`);
    } catch (e) {
        console.error('Error applying media control:', e);
    }
}

async function runOrganizer() {
    const dirPath = document.getElementById('organize-path').value;
    const resultDiv = document.getElementById('organize-result');
    resultDiv.style.color = 'var(--primary-color)';
    resultDiv.innerText = 'ORGANIZING FILES...';
    
    try {
        const res = await fetch('/api/system/organize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ directory_path: dirPath })
        });
        const data = await res.json();
        if (data.success) {
            const count = data.result.totalMoved;
            resultDiv.style.color = '#39ff14'; // Bright green
            resultDiv.innerText = `ORGANIZED SUCCESS: Sorted ${count} file(s).`;
            showNotification('DIRECTORY ORGANIZED');
        } else {
            resultDiv.style.color = '#ff4444';
            resultDiv.innerText = `ERROR: ${data.error}`;
        }
    } catch (e) {
        resultDiv.style.color = '#ff4444';
        resultDiv.innerText = `ERROR: ${e.message}`;
    }
}

async function runScraper() {
    const url = document.getElementById('scrape-url').value;
    const container = document.getElementById('scrape-container').value;
    const output = document.getElementById('scrape-output').value;
    const fieldsText = document.getElementById('scrape-fields').value;
    const username = document.getElementById('scrape-username').value;
    const password = document.getElementById('scrape-password').value;
    const resultDiv = document.getElementById('scrape-result');
    
    resultDiv.style.color = 'var(--primary-color)';
    resultDiv.innerText = 'SCRAPING PAGE...';
    
    let fields;
    try {
        fields = JSON.parse(fieldsText);
    } catch (err) {
        resultDiv.style.color = '#ff4444';
        resultDiv.innerText = 'ERROR: Fields mapping is not valid JSON';
        return;
    }

    try {
        const res = await fetch('/api/system/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                container_selector: container,
                fields,
                output_file_path: output,
                username,
                password
            })
        });
        const data = await res.json();
        if (data.success) {
            resultDiv.style.color = '#39ff14';
            resultDiv.innerText = `SCRAPE SUCCESS: Extracted ${data.result.count} item(s).`;
            showNotification('PAGE SCRAPED');
        } else {
            resultDiv.style.color = '#ff4444';
            resultDiv.innerText = `ERROR: ${data.error}`;
        }
    } catch (e) {
        resultDiv.style.color = '#ff4444';
        resultDiv.innerText = `ERROR: ${e.message}`;
    }
}

// ============================================================
// AGENT ARENA — Multi-Agent Debate System
// ============================================================

let arenaPollingInterval = null;
let arenaLastTranscriptLength = 0;
let arenaIsRunning = false;

function initArenaView() {
    // Initialize mermaid once
    if (window.mermaid) {
        mermaid.initialize({
            startOnLoad: false,
            theme: 'dark',
            themeVariables: {
                background: '#0a0a1a',
                primaryColor: '#a855f7',
                primaryTextColor: '#e2e8f0',
                lineColor: '#00f0ff',
                secondaryColor: '#1e1e3a',
                tertiaryColor: '#0a0a1a'
            }
        });
    }
    // Fetch current arena status and render
    pollArenaStatus();
}

async function startDebate() {
    const topic = document.getElementById('arena-topic').value.trim();
    const rounds = document.getElementById('arena-rounds').value;
    if (!topic) { showNotification('ERROR: ENTER A DEBATE TOPIC'); return; }

    const startBtn = document.getElementById('arena-start-btn');
    const stepBtn = document.getElementById('arena-step-btn');
    startBtn.disabled = true;
    startBtn.innerText = '⏳ INITIALIZING...';
    stepBtn.disabled = true;
    arenaLastTranscriptLength = 0;

    try {
        const res = await fetch('/api/arena/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic, rounds: parseInt(rounds) })
        });
        const data = await res.json();
        if (data.success) {
            showNotification('DEBATE INITIALIZED');
            arenaIsRunning = true;
            startBtn.innerText = '🔄 RESTART';
            startBtn.disabled = false;
            stepBtn.disabled = false;
            // Start polling for updates
            clearInterval(arenaPollingInterval);
            arenaPollingInterval = setInterval(pollArenaStatus, 3000);
            await pollArenaStatus();
        } else {
            showNotification('ERROR: ' + (data.error || 'Failed to start'));
            startBtn.disabled = false;
            startBtn.innerText = '🚀 START DEBATE';
        }
    } catch (e) {
        showNotification('ERROR: ' + e.message);
        startBtn.disabled = false;
        startBtn.innerText = '🚀 START DEBATE';
    }
}

async function stepDebate() {
    const stepBtn = document.getElementById('arena-step-btn');
    stepBtn.disabled = true;
    stepBtn.innerText = '⏳ AI THINKING...';

    try {
        const res = await fetch('/api/arena/step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        });
        const data = await res.json();
        if (data.success) {
            await pollArenaStatus();
            if (data.phase === 'finished') {
                stepBtn.innerText = '✅ DEBATE COMPLETE';
                clearInterval(arenaPollingInterval);
            } else {
                stepBtn.disabled = false;
                stepBtn.innerText = '⏭ NEXT TURN';
            }
        } else {
            showNotification('STEP ERROR: ' + (data.error || 'Unknown'));
            stepBtn.disabled = false;
            stepBtn.innerText = '⏭ NEXT TURN';
        }
    } catch (e) {
        showNotification('ERROR: ' + e.message);
        stepBtn.disabled = false;
        stepBtn.innerText = '⏭ NEXT TURN';
    }
}

async function interveneDebate() {
    const comment = document.getElementById('arena-intervention').value.trim();
    if (!comment) { showNotification('ERROR: ENTER YOUR DIRECTIVE'); return; }

    try {
        const res = await fetch('/api/arena/intervene', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comment })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('arena-intervention').value = '';
            showNotification('DIRECTIVE INJECTED');
            await pollArenaStatus();
        } else {
            showNotification('INTERVENE ERROR: ' + (data.error || 'Unknown'));
        }
    } catch (e) {
        showNotification('ERROR: ' + e.message);
    }
}

async function pollArenaStatus() {
    try {
        const res = await fetch('/api/arena/status');
        if (!res.ok) return;
        const data = await res.json();
        renderArenaStatus(data);
    } catch (e) {
        console.error('Arena poll error:', e);
    }
}

function renderArenaStatus(data) {
    // Status badge
    const badge = document.getElementById('arena-status-badge');
    const phaseColors = {
        idle: '#666',
        generating_personas: '#facc15',
        brainstorming: '#39ff14',
        challenging: '#ff007f',
        reconciling: '#00f0ff',
        finished: '#a855f7'
    };
    const phaseIcons = {
        idle: '⚫',
        generating_personas: '⏳',
        brainstorming: '💡',
        challenging: '⚔️',
        reconciling: '🤝',
        finished: '🏆'
    };
    if (badge) {
        badge.style.color = phaseColors[data.phase] || '#fff';
        badge.innerText = `STATUS: ${(phaseIcons[data.phase] || '') + ' ' + data.phase.toUpperCase().replace(/_/g,' ')}  |  ROUND ${data.currentRound}/${data.rounds}`;
    }

    // Speaker status
    const speakerDiv = document.getElementById('arena-speaker-status');
    if (speakerDiv && data.experts && data.experts.length > 0) {
        const idx = data.currentSpeakerIndex % data.experts.length;
        if (data.phase !== 'idle' && data.phase !== 'finished' && data.phase !== 'generating_personas') {
            const next = data.experts[idx];
            speakerDiv.innerHTML = `NEXT: <span style="color:${next.color}; font-weight:bold;">${next.name}</span>`;
        } else {
            speakerDiv.innerText = '';
        }
    }

    // Experts panel
    const expertsDiv = document.getElementById('arena-experts');
    if (expertsDiv && data.experts && data.experts.length > 0) {
        expertsDiv.innerHTML = data.experts.map((exp, i) => {
            const isNext = i === (data.currentSpeakerIndex % data.experts.length) &&
                data.phase !== 'idle' && data.phase !== 'finished';
            return `<div style="display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:8px; background:${isNext ? 'rgba(255,255,255,0.05)' : 'transparent'}; border:1px solid ${isNext ? exp.color : 'transparent'};">
                <div style="width:10px; height:10px; border-radius:50%; background:${exp.color}; flex-shrink:0; ${isNext ? 'box-shadow:0 0 8px ' + exp.color : ''}"></div>
                <div>
                    <div style="font-size:12px; font-weight:bold; color:${exp.color};">${exp.name} ${isNext ? '▶' : ''}</div>
                    <div style="font-size:10px; color:var(--text-muted);">${exp.role}</div>
                </div>
            </div>`;
        }).join('');
    }

    // Transcript
    const transcriptDiv = document.getElementById('arena-transcript');
    if (transcriptDiv && data.transcript) {
        const newEntries = data.transcript.slice(arenaLastTranscriptLength);
        newEntries.forEach(entry => {
            const el = document.createElement('div');
            el.style.cssText = `margin-bottom:12px; border-left:3px solid ${entry.color}; padding-left:10px;`;
            el.innerHTML = `
                <div style="font-size:10px; color:${entry.color}; font-weight:bold; letter-spacing:1px; margin-bottom:4px;">
                    ${entry.speaker} &nbsp;·&nbsp; <span style="opacity:0.7; font-weight:normal;">${entry.role}</span>
                </div>
                <div style="color:#e2e8f0; line-height:1.6; white-space:pre-wrap; font-family:monospace; font-size:11px;">${escapeHtml(entry.text)}</div>
            `;
            transcriptDiv.appendChild(el);
        });
        arenaLastTranscriptLength = data.transcript.length;
        transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
    }

    // Mermaid diagram
    if (data.mermaidDiagram && data.mermaidDiagram.trim()) {
        renderMermaidDiagram(data.mermaidDiagram);
    }

    // Sync button states if we re-enter the view
    const startBtn = document.getElementById('arena-start-btn');
    const stepBtn = document.getElementById('arena-step-btn');
    if (startBtn) startBtn.innerText = data.phase !== 'idle' ? '🔄 RESTART' : '🚀 START DEBATE';
    if (stepBtn) {
        if (data.phase === 'idle') {
            stepBtn.disabled = true;
            stepBtn.innerText = '⏭ NEXT TURN';
        } else if (data.phase === 'finished') {
            stepBtn.disabled = true;
            stepBtn.innerText = '✅ DEBATE COMPLETE';
        } else {
            stepBtn.disabled = false;
            stepBtn.innerText = '⏭ NEXT TURN';
        }
    }
}

let lastRenderedDiagram = '';
async function renderMermaidDiagram(diagramCode) {
    if (diagramCode === lastRenderedDiagram) return;
    lastRenderedDiagram = diagramCode;
    const container = document.getElementById('arena-diagram-container');
    if (!container || !window.mermaid) return;

    try {
        // Generate unique ID to avoid cache issues
        const id = 'mermaid-' + Date.now();
        const { svg } = await mermaid.render(id, diagramCode);
        container.innerHTML = svg;
        // Make SVG responsive
        const svgEl = container.querySelector('svg');
        if (svgEl) {
            svgEl.style.width = '100%';
            svgEl.style.height = 'auto';
            svgEl.style.maxHeight = '400px';
        }
    } catch (e) {
        container.innerHTML = `<div style="color:#ff4444; font-size:11px; font-family:monospace;">Diagram error: ${escapeHtml(e.message)}</div>`;
        console.error('Mermaid render error:', e);
    }
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Settings: Load and Save API Key
async function loadSettingsView() {
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            const config = await res.json();
            const input = document.getElementById('settings-api-key');
            if (input && config.geminiApiKey) {
                // Show masked key
                input.placeholder = 'API Key saved (hidden)';
            }
        }
    } catch (e) { console.error('Settings load error:', e); }
}

async function saveApiKey() {
    const apiKey = document.getElementById('settings-api-key').value.trim();
    const statusEl = document.getElementById('api-key-status');
    if (!apiKey) {
        statusEl.style.color = '#ff4444';
        statusEl.innerText = 'ERROR: Key cannot be empty';
        return;
    }
    try {
        const res = await fetch('/api/settings/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey })
        });
        const data = await res.json();
        if (data.success) {
            statusEl.style.color = '#39ff14';
            statusEl.innerText = '✓ KEY SAVED SECURELY';
            document.getElementById('settings-api-key').value = '';
            document.getElementById('settings-api-key').placeholder = 'API Key saved (hidden)';
            showNotification('API KEY SAVED');
            setTimeout(() => { statusEl.innerText = ''; }, 4000);
        } else {
            statusEl.style.color = '#ff4444';
            statusEl.innerText = 'ERROR: ' + (data.error || 'Failed');
        }
    } catch (e) {
        statusEl.style.color = '#ff4444';
        statusEl.innerText = 'ERROR: ' + e.message;
    }
}
