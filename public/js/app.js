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
    else if (view === 'mcp') fetchMCPHealth();
    else if (view === 'artifacts') fetchArtifacts();
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
            container.innerHTML = '<div style="color:#64748b; font-size:12px;">No tasks scheduled.</div>';
        }
        data.forEach(item => {
            const div = document.createElement('div');
            div.className = 'list-item';
            const title = document.createElement('div');
            title.className = 'list-item-title';
            title.textContent = item.name;
            const desc = document.createElement('div');
            desc.className = 'list-item-desc';
            desc.textContent = item.command;
            const sched = document.createElement('div');
            sched.style.cssText = 'font-size:10px; color:var(--theme-primary); margin-top:4px;';
            sched.textContent = '\u21B5 ' + item.schedule;
            const left = document.createElement('div');
            left.appendChild(title);
            left.appendChild(desc);
            left.appendChild(sched);
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger';
            delBtn.textContent = 'Delete';
            delBtn.onclick = () => deleteTask(item.id);
            div.appendChild(left);
            div.appendChild(delBtn);
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

async function fetchTaskHistory() {
    try {
        const res = await fetch('/api/task-history');
        const data = await res.json();
        const container = document.getElementById('task-history-container');
        if (!container) return;
        container.innerHTML = '';
        if (data.length === 0) {
            container.innerHTML = '<div style="color:#64748b; font-size:12px;">No task history yet.</div>'; return;
        }
        data.slice(0, 50).forEach(h => {
            const d = document.createElement('div');
            d.className = 'list-item';
            d.style.cssText = 'flex-direction:column; align-items:flex-start;';
            const header = document.createElement('div');
            header.style.cssText = 'display:flex; justify-content:space-between; width:100%;';
            const title = document.createElement('div');
            title.className = 'list-item-title';
            title.textContent = h.taskName;
            const status = document.createElement('span');
            status.style.color = h.exitCode === 0 ? '#39ff14' : '#ff4444';
            status.textContent = h.exitCode === 0 ? 'SUCCESS' : 'FAILED';
            header.appendChild(title);
            header.appendChild(status);
            const meta = document.createElement('div');
            meta.className = 'list-item-desc';
            meta.textContent = new Date(h.timestamp).toLocaleString() + ' | ' + h.command;
            d.appendChild(header);
            d.appendChild(meta);
            if (h.stderr) {
                const err = document.createElement('div');
                err.style.cssText = 'color:#ff4444; font-size:11px; font-family:monospace; margin-top:4px;';
                err.textContent = h.stderr.slice(0, 200);
                d.appendChild(err);
            }
            container.appendChild(d);
        });
    } catch(e) { console.error(e); }
}

async function fetchAuditLog() {
    try {
        const res = await fetch('/api/audit');
        const data = await res.json();
        const container = document.getElementById('audit-log-container');
        if (!container) return;
        container.innerHTML = '';
        if (data.length === 0) {
            container.innerHTML = '<div style="color:#64748b; font-size:12px;">No audit entries yet.</div>'; return;
        }
        data.slice(0, 100).forEach(entry => {
            const d = document.createElement('div');
            d.className = 'list-item';
            d.style.cssText = 'flex-direction:column; align-items:flex-start;';
            const text = document.createElement('div');
            text.style.cssText = 'font-size:12px; color:#e2e8f0; font-family:monospace;';
            text.textContent = new Date(entry.time).toLocaleString() + ' [' + entry.action + '] ' + JSON.stringify(entry.details);
            d.appendChild(text);
            container.appendChild(d);
        });
    } catch(e) { console.error(e); }
}

async function deleteTask(id) {
    if (!confirm('Delete this task?')) return;
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
        container.innerHTML = '';
        if (backups.length === 0) {
            container.innerHTML = '<div style="color:#64748b;font-size:12px;">No backups yet. Create your first one!</div>';
            return;
        }
        backups.forEach(b => {
            const item = document.createElement('div');
            item.className = 'list-item';
            const left = document.createElement('div');
            const title = document.createElement('div');
            title.className = 'list-item-title';
            title.textContent = b.name;
            const desc = document.createElement('div');
            desc.className = 'list-item-desc';
            desc.textContent = b.date + ' | ' + b.size;
            left.appendChild(title);
            left.appendChild(desc);
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger';
            delBtn.textContent = 'Delete';
            delBtn.onclick = () => deleteBackup(b.name);
            item.appendChild(left);
            item.appendChild(delBtn);
            container.appendChild(item);
        });
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
    if (!confirm('Delete backup: ' + name + '?')) return;
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
        const container = document.getElementById('rules-list');
        container.innerHTML = '';
        data.forEach(r => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
            const left = document.createElement('div');
            const title = document.createElement('div');
            title.className = 'list-item-title';
            title.textContent = r.name.replace('.disabled', '');
            const desc = document.createElement('div');
            desc.className = 'list-item-desc';
            desc.style.cssText = 'white-space:pre-wrap; font-size:11px; max-height:40px; overflow:hidden;';
            desc.textContent = r.content.substring(0, 60) + '...';
            left.appendChild(title);
            left.appendChild(desc);
            const right = document.createElement('div');
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'btn' + (r.active ? ' btn-success' : '');
            toggleBtn.textContent = r.active ? 'Active' : 'Enable';
            toggleBtn.onclick = () => toggleRule(r.name, !r.active, r.content);
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger';
            delBtn.textContent = 'X';
            delBtn.onclick = () => deleteRule(r.name);
            right.appendChild(toggleBtn);
            right.appendChild(delBtn);
            item.appendChild(left);
            item.appendChild(right);
            container.appendChild(item);
        });
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
    if (!confirm('Toggle rule: ' + name + '?')) return;
    try {
        await fetch('/api/rules', { method: 'POST', body: JSON.stringify({ name, content, active }) });
        fetchRules(); showNotification('RULE UPDATED');
    } catch(e) { console.error(e); }
}
async function deleteRule(name) {
    if (!confirm('Delete rule: ' + name + '?')) return;
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
        const container = document.getElementById('agents-list');
        container.innerHTML = '';
        data.forEach(a => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
            const left = document.createElement('div');
            const title = document.createElement('div');
            title.className = 'list-item-title';
            title.textContent = a.name;
            const desc = document.createElement('div');
            desc.className = 'list-item-desc';
            desc.textContent = a.description || '';
            left.appendChild(title);
            left.appendChild(desc);
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger';
            delBtn.textContent = 'Delete';
            delBtn.onclick = () => deleteAgent(a.filename);
            item.appendChild(left);
            item.appendChild(delBtn);
            container.appendChild(item);
        });
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
    if (!confirm('Delete agent: ' + filename + '?')) return;
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
        const container = document.getElementById('store-list');
        container.innerHTML = '';
        data.forEach(s => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
            const left = document.createElement('div');
            const title = document.createElement('div');
            title.className = 'list-item-title';
            title.textContent = s.name;
            const desc = document.createElement('div');
            desc.className = 'list-item-desc';
            desc.textContent = s.desc;
            left.appendChild(title);
            left.appendChild(desc);
            const installBtn = document.createElement('button');
            installBtn.className = 'btn btn-success';
            installBtn.textContent = 'Install';
            installBtn.onclick = () => installSkill(s.id, s.name, s.desc);
            item.appendChild(left);
            item.appendChild(installBtn);
            container.appendChild(item);
        });
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
        const container = document.getElementById('macros-list');
        container.innerHTML = '';
        data.forEach(m => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
            const left = document.createElement('div');
            const title = document.createElement('div');
            title.className = 'list-item-title';
            title.textContent = '/' + m.name;
            const desc = document.createElement('div');
            desc.className = 'list-item-desc';
            desc.style.cssText = 'white-space:pre-wrap; font-size:11px;';
            desc.textContent = m.content.substring(0, 50) + '...';
            left.appendChild(title);
            left.appendChild(desc);
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger';
            delBtn.textContent = 'Delete';
            delBtn.onclick = () => deleteMacro(m.filename);
            item.appendChild(left);
            item.appendChild(delBtn);
            container.appendChild(item);
        });
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
    if (!confirm('Delete macro: ' + filename + '?')) return;
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

// ── Antigravity Features ─────────────────────────────────────

async function fetchSkills() {
    try {
        const res = await fetch('/api/skills/enhanced');
        const skills = await res.json();
        const container = document.getElementById('skills-container');
        container.innerHTML = '';
        skills.forEach(s => {
            const card = document.createElement('div');
            card.className = 'card';
            const scopeColor = s.scope === 'workspace' ? '#facc15' : '#00f0ff';
            const overrideBadge = s.overriddenBy ? '<span style="color:#ff4444;font-size:9px;">(OVERRIDDEN)</span>' : (s.overrides ? '<span style="color:#39ff14;font-size:9px;">(ACTIVE)</span>' : '');
            card.innerHTML = `
                <div class='card-icon-area'><div class='icon-box'><svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></div></div>
                <div class='card-content'>
                    <div class='card-title'>${escapeHtml(s.name)} ${overrideBadge}</div>
                    <div style="font-size:11px; color:#94a3b8; margin-top:4px;">${escapeHtml(s.description)}</div>
                    <div style="font-size:10px; margin-top:6px; display:flex; gap:10px;">
                        <span style="color:${scopeColor};">⬤ ${s.scope.toUpperCase()}</span>
                        <span style="color:var(--text-muted);">📄 ${s.tokenEstimate} tokens</span>
                        ${s.effective === false ? '<span style="color:#ff4444;">✕ INACTIVE</span>' : '<span style="color:#39ff14;">✓ ACTIVE</span>'}
                    </div>
                </div>`;
            container.appendChild(card);
        });
        // Load heatmap
        fetchSkillHeatmap();
    } catch (e) { console.error(e); }
}

async function fetchSkillLint() {
    try {
        const res = await fetch('/api/skills/lint');
        const data = await res.json();
        const container = document.getElementById('skill-lint-results');
        container.innerHTML = '<h4 style="font-weight:300; margin-bottom:10px;">🔍 Description Lint Results</h4>';
        const flagged = data.filter(d => d.warnings.length > 0);
        if (flagged.length === 0) { container.innerHTML += '<div style="color:#39ff14; font-size:12px;">All descriptions look good!</div>'; return; }
        flagged.forEach(f => {
            const d = document.createElement('div');
            d.className = 'list-item';
            d.style.cssText = 'flex-direction:column; align-items:flex-start;';
            d.innerHTML = `<div style="font-weight:bold;">${escapeHtml(f.skill)} <span style="color:${f.scope === 'workspace' ? '#facc15' : '#00f0ff'};font-size:10px;">[${f.scope.toUpperCase()}]</span></div>
                <div style="font-size:11px; color:#94a3b8;">${escapeHtml(f.description)}</div>
                <div style="font-size:11px; color:#ff4444; margin-top:4px;">${f.warnings.map(w => '⚠ ' + escapeHtml(w)).join('<br>')}</div>`;
            container.appendChild(d);
        });
    } catch(e) { console.error(e); }
}

async function fetchSkillConflicts() {
    try {
        const res = await fetch('/api/skills/conflicts');
        const data = await res.json();
        const container = document.getElementById('skill-conflicts-results');
        container.innerHTML = '<h4 style="font-weight:300; margin-bottom:10px;">⚡ Skill Conflicts</h4>';
        if (data.length === 0) { container.innerHTML += '<div style="color:#39ff14; font-size:12px;">No conflicts detected.</div>'; return; }
        data.forEach(c => {
            const d = document.createElement('div');
            d.className = 'list-item';
            d.style.cssText = 'flex-direction:column; align-items:flex-start;';
            const isDup = c.type === 'scope_duplicate';
            d.innerHTML = `<div style="font-weight:bold;">${escapeHtml(c.a)} ↔ ${escapeHtml(c.b)}</div>
                <div style="font-size:11px; color:#94a3b8;">${isDup ? 'Same name in different scope — ' + escapeHtml(c.winner) + ' wins' : c.similarity + '% description overlap'}</div>
                <div style="font-size:10px; color:var(--text-muted);">${c.aScope} vs ${c.bScope}</div>`;
            container.appendChild(d);
        });
    } catch(e) { console.error(e); }
}

async function testSkillMatch() {
    const query = document.getElementById('match-query').value.trim();
    if (!query) return;
    try {
        const res = await fetch('/api/skills/match', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const data = await res.json();
        const container = document.getElementById('match-results');
        container.innerHTML = '<h4 style="font-weight:300; margin-bottom:10px;">🎯 Match Results</h4>';
        if (data.length === 0) { container.innerHTML += '<div style="color:#64748b; font-size:12px;">No skills match.</div>'; return; }
        data.slice(0, 10).forEach(m => {
            const d = document.createElement('div');
            d.className = 'list-item';
            d.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
            const scoreColor = m.score > 50 ? '#39ff14' : m.score > 20 ? '#facc15' : '#ff4444';
            d.innerHTML = `<div>
                    <div style="font-weight:bold;">${escapeHtml(m.skill)}</div>
                    <div style="font-size:11px; color:#94a3b8;">${escapeHtml(m.description)}</div>
                </div>
                <div style="font-size:20px; font-weight:bold; color:${scoreColor};">${m.score}%</div>`;
            container.appendChild(d);
        });
    } catch(e) { console.error(e); }
}

async function fetchMCPHealth() {
    try {
        const res = await fetch('/api/mcp/health');
        const data = await res.json();
        const container = document.getElementById('mcp-health-results');
        container.innerHTML = '';
        if (data.length === 0) { container.innerHTML = '<div style="color:#64748b; font-size:12px;">No MCP servers configured. Add them in Settings.</div>'; return; }
        data.forEach(s => {
            const d = document.createElement('div');
            d.className = 'list-item';
            const statusColor = s.status === 'connected' ? '#39ff14' : s.status === 'unreachable' ? '#ff4444' : '#facc15';
            d.innerHTML = `<div>
                    <div style="font-weight:bold;">${escapeHtml(s.name)}</div>
                    <div style="font-size:11px; color:#94a3b8;">${escapeHtml(s.url)}</div>
                </div>
                <div style="font-size:12px; color:${statusColor};">${s.status.toUpperCase()}</div>`;
            container.appendChild(d);
        });
    } catch(e) { console.error(e); }
}

async function fetchMCPMapping() {
    try {
        const res = await fetch('/api/skills/mcp-mapping');
        const data = await res.json();
        const container = document.getElementById('mcp-mapping-results');
        container.innerHTML = '<h4 style="font-weight:300; margin-bottom:10px;">🔗 Skill ↔ MCP Mapping</h4>';
        if (data.length === 0) { container.innerHTML += '<div style="color:#64748b; font-size:12px;">No skills reference MCP tools.</div>'; return; }
        data.forEach(m => {
            const d = document.createElement('div');
            d.className = 'list-item';
            d.style.cssText = 'flex-direction:column; align-items:flex-start;';
            d.innerHTML = `<div style="font-weight:bold;">${escapeHtml(m.skill)} <span style="color:${m.scope === 'workspace' ? '#facc15' : '#00f0ff'};font-size:10px;">[${m.scope.toUpperCase()}]</span></div>
                <div style="font-size:11px; color:#94a3b8;">${m.mcpTools.length > 0 ? '🔧 ' + m.mcpTools.map(t => escapeHtml(t)).join(', ') : '<em>No MCP tools referenced</em>'}</div>`;
            container.appendChild(d);
        });
    } catch(e) { console.error(e); }
}

async function fetchArtifacts() {
    try {
        const res = await fetch('/api/artifacts');
        const data = await res.json();
        const container = document.getElementById('artifacts-container');
        container.innerHTML = '';
        if (data.error || data.length === 0) {
            container.innerHTML = '<div style="color:#64748b; font-size:12px;">' + escapeHtml(data.error || 'No artifacts found.') + '</div>'; return;
        }
        const cats = [...new Set(data.map(a => a.category))];
        cats.forEach(cat => {
            const header = document.createElement('h4');
            header.style.cssText = 'font-weight:300; margin:15px 0 10px 0; text-transform:uppercase; font-size:11px; color:var(--text-muted);';
            header.textContent = cat;
            container.appendChild(header);
            data.filter(a => a.category === cat).forEach(a => {
                const d = document.createElement('div');
                d.className = 'list-item';
                const isImage = a.name.match(/\.(png|jpg|jpeg|gif|svg)$/i);
                d.innerHTML = `<div>
                        <div style="font-weight:bold;">${escapeHtml(a.name)}</div>
                        <div style="font-size:11px; color:#94a3b8;">${(a.size / 1024).toFixed(1)} KB · ${new Date(a.modified).toLocaleString()}</div>
                    </div>
                    ${isImage ? '<span style="color:#00f0ff;font-size:11px;">🖼 Preview</span>' : '<span style="color:#94a3b8;font-size:11px;">📄 ' + escapeHtml(a.name.split('.').pop()) + '</span>'}`;
                container.appendChild(d);
            });
        });
    } catch(e) { console.error(e); }
}

async function fetchSkillHeatmap() {
    try {
        const res = await fetch('/api/skills/heatmap');
        const data = await res.json();
        const entries = Object.entries(data).sort((a, b) => b[1].count - a[1].count);
        const container = document.getElementById('skills-container');
        if (entries.length === 0) return;
        const heatEl = document.createElement('div');
        heatEl.style.cssText = 'margin-top:20px; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); border-radius:12px; padding:20px;';
        heatEl.innerHTML = '<h4 style="font-weight:300; margin-bottom:10px;">🔥 Skill Usage Heatmap</h4>';
        entries.slice(0, 10).forEach(([name, info]) => {
            const bar = document.createElement('div');
            bar.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:6px;';
            const label = document.createElement('div');
            label.style.cssText = 'width:120px; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            label.textContent = name;
            const fill = document.createElement('div');
            const pct = Math.min(info.count / 10, 1);
            fill.style.cssText = `height:16px; background:var(--theme-primary); opacity:0.6; border-radius:4px; width:${pct * 200}px; transition:width 0.3s;`;
            const count = document.createElement('div');
            count.style.cssText = 'font-size:10px; color:var(--text-muted);';
            count.textContent = info.count + 'x';
            bar.appendChild(label);
            bar.appendChild(fill);
            bar.appendChild(count);
            heatEl.appendChild(bar);
        });
        container.parentElement.appendChild(heatEl);
    } catch(e) { /* silent */ }
}

async function saveMCPConfig() {
    const val = document.getElementById('mcp-config-editor').value.trim();
    let mcpServers;
    try { mcpServers = JSON.parse(val); } catch(e) { alert('Invalid JSON'); return; }
    try {
        await fetch('/api/settings/config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mcpServers })
        });
        showNotification('MCP CONFIG SAVED');
        fetchMCPHealth();
    } catch(e) { alert('Failed to save'); }
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
