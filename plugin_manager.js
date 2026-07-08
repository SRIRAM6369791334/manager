const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const readline = require('readline');
const archiver = require('archiver');
const axios = require('axios');
const cheerio = require('cheerio');

const PLUGINS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'config', 'plugins');
const CONFIG_DIR  = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'config');
const BRAIN_DIR   = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'antigravity', 'brain');
const BACKUP_DIR  = path.join(__dirname, 'data', 'backups');
const PUBLIC_DIR  = path.join(__dirname, 'public');
const DATA_DIR    = path.join(__dirname, 'data');
const RULES_DIR   = path.join(CONFIG_DIR, 'rules');
const AGENTS_DIR  = path.join(PLUGINS_DIR, 'custom-agents-plugin', 'agents');
const MACROS_DIR  = path.join(PLUGINS_DIR, 'macro-plugin', 'skills');
const STORE_DIR   = path.join(PLUGINS_DIR, 'community-plugin', 'skills');
const PORT = 4000;

// Ensure dirs exist
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(RULES_DIR)) fs.mkdirSync(RULES_DIR, { recursive: true });
if (!fs.existsSync(AGENTS_DIR)) fs.mkdirSync(AGENTS_DIR, { recursive: true });
if (!fs.existsSync(MACROS_DIR)) fs.mkdirSync(MACROS_DIR, { recursive: true });
if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });

const BRIDGE_DIR = path.join(PLUGINS_DIR, 'bridge-plugin');
const BRIDGE_SKILLS_DIR = path.join(BRIDGE_DIR, 'skills', 'SK-bridge-injector');
if (!fs.existsSync(BRIDGE_SKILLS_DIR)) fs.mkdirSync(BRIDGE_SKILLS_DIR, { recursive: true });

function syncBridgePlugin() {
    let totalTokens = 0;
    let skillContent = "---\nname: bridge-injector\ndescription: Auto-generated skill that injects dashboard config into Antigravity context.\n---\n\n# Dashboard Injected Context\n\n";
    
    // 1. Inject Project Memory
    const memoryPath = path.join(RULES_DIR, 'project_memory.md');
    if (fs.existsSync(memoryPath)) {
        const mem = fs.readFileSync(memoryPath, 'utf8');
        skillContent += "## Global Project Memory\n" + mem + "\n\n";
        totalTokens += Math.ceil(mem.length / 4);
    }

    // 2. Inject Global Rules
    if (fs.existsSync(RULES_DIR)) {
        skillContent += "## Global Rules\nThe following strict rules MUST be followed:\n";
        const rules = fs.readdirSync(RULES_DIR).filter(f => f.endsWith('.md') && f !== 'project_memory.md');
        for (const rule of rules) {
            const ruleContent = fs.readFileSync(path.join(RULES_DIR, rule), 'utf8');
            skillContent += `### Rule: ${rule}\n${ruleContent}\n\n`;
            totalTokens += Math.ceil(ruleContent.length / 4);
        }
    }

    // 3. Inject Macros Summary
    if (fs.existsSync(MACROS_DIR)) {
        skillContent += "## Custom Macros\nThe user has the following macros available:\n";
        const macros = fs.readdirSync(MACROS_DIR).filter(f => f.endsWith('.md'));
        for (const macro of macros) {
            const mPath = path.join(MACROS_DIR, macro);
            const mContent = fs.readFileSync(mPath, 'utf8');
            skillContent += `- Macro file: ${macro}\n`;
            totalTokens += Math.ceil(mContent.length / 4);
        }
    }

    // Write plugin.json
    fs.writeFileSync(path.join(BRIDGE_DIR, 'plugin.json'), JSON.stringify({
        name: "bridge-plugin",
        version: "1.0.0",
        description: "Dashboard connection bridge"
    }, null, 2));

    // Write SKILL.md
    fs.writeFileSync(path.join(BRIDGE_SKILLS_DIR, 'SKILL.md'), skillContent);
    return totalTokens;
}

// Initial Sync
syncBridgePlugin();


// Active file watchers map
const activeWatchers = new Map();
let watchClients = [];

function getPlugins() {
    if (!fs.existsSync(PLUGINS_DIR)) return [];
    const plugins = [];
    const dirs = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
        if (dir.isDirectory()) {
            const activePath = path.join(PLUGINS_DIR, dir.name, 'plugin.json');
            plugins.push({ name: dir.name, active: fs.existsSync(activePath) });
        }
    }
    return plugins;
}

function updatePlugins(activeNames) {
    const dirs = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
        if (dir.isDirectory()) {
            const pluginName = dir.name;
            const activePath = path.join(PLUGINS_DIR, pluginName, 'plugin.json');
            const inactivePath = path.join(PLUGINS_DIR, pluginName, 'plugin.json.disabled');
            const shouldBeActive = activeNames.includes(pluginName);
            
            if (shouldBeActive) {
                if (!fs.existsSync(activePath)) {
                    if (fs.existsSync(inactivePath)) fs.renameSync(inactivePath, activePath);
                    else {
                        fs.writeFileSync(activePath, JSON.stringify({
                            name: pluginName, version: "1.0.0", description: "Auto-generated config"
                        }, null, 2));
                    }
                }
            } else {
                if (fs.existsSync(activePath)) fs.renameSync(activePath, inactivePath);
            }
        }
    }
}

function getSkills() {
    if (!fs.existsSync(PLUGINS_DIR)) return [];
    const skills = [];
    try {
        const plugins = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
        for (const plugin of plugins) {
            if (plugin.isDirectory()) {
                const activePath = path.join(PLUGINS_DIR, plugin.name, 'plugin.json');
                if (!fs.existsSync(activePath)) continue;

                const skillsDir = path.join(PLUGINS_DIR, plugin.name, 'skills');
                if (fs.existsSync(skillsDir)) {
                    const skillFiles = fs.readdirSync(skillsDir, { withFileTypes: true });
                    for (const skill of skillFiles) {
                        if (skill.isDirectory() || skill.name.endsWith('.md')) {
                            let name = skill.name;
                            if (name.endsWith('.md')) name = name.replace('.md', '');
                            skills.push({ name: name, description: `Module from ${plugin.name}` });
                        }
                    }
                }
            }
        }
    } catch (e) { console.error("Error reading skills:", e); }
    return skills;
}

function readJsonFile(filename) {
    try {
        const filePath = path.join(DATA_DIR, filename);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch(e) { console.error(e); }
    return {};
}

function writeJsonFile(filename, data) {
    fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

function getConfig() {
    return readJsonFile('config.json');
}

function saveConfig(config) {
    writeJsonFile('config.json', config);
}

async function organizeDirectoryHelper(dirPath) {
    const files = fs.readdirSync(dirPath);
    const categories = {
        Images: [".jpg", ".jpeg", ".png", ".gif", ".svg", ".bmp", ".webp"],
        Documents: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".rtf"],
        Audio: [".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a"],
        Video: [".mp4", ".mkv", ".avi", ".mov", ".flv", ".wmv"],
        Archives: [".zip", ".rar", ".7z", ".tar", ".gz"],
        Applications: [".exe", ".msi", ".bat", ".cmd"],
        Code: [".js", ".py", ".html", ".css", ".json", ".ts", ".cpp", ".java", ".sh"]
    };

    const getCategory = (ext) => {
        ext = ext.toLowerCase();
        for (const [category, extensions] of Object.entries(categories)) {
            if (extensions.includes(ext)) return category;
        }
        return "Others";
    };

    const summary = {};
    let totalMoved = 0;

    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const fileStat = fs.statSync(fullPath);
        
        if (fileStat.isFile()) {
            const ext = path.extname(file);
            const category = getCategory(ext);
            const targetDir = path.join(dirPath, category);
            
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            
            const destPath = path.join(targetDir, file);
            let finalDestPath = destPath;
            let counter = 1;
            const baseName = path.basename(file, ext);
            while (fs.existsSync(finalDestPath)) {
                finalDestPath = path.join(targetDir, `${baseName}_(${counter})${ext}`);
                counter++;
            }
            
            fs.renameSync(fullPath, finalDestPath);
            summary[category] = (summary[category] || 0) + 1;
            totalMoved++;
        }
    }

    return { totalMoved, summary };
}

async function scrapeWebpageHelper(url, containerSelector, fields, outputPath, username, password) {
    const ext = path.extname(outputPath).toLowerCase();
    if (ext !== '.csv' && ext !== '.json') {
        throw new Error('Output file path must end in .csv or .json');
    }

    const axiosConfig = {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9"
        },
        timeout: 15000
    };

    if (username && password) {
        axiosConfig.auth = {
            username: username,
            password: password
        };
    }

    const response = await axios.get(url, axiosConfig);
    
    const html = response.data;
    const $ = cheerio.load(html);
    const items = [];

    $(containerSelector).each((index, element) => {
        const item = {};
        let hasData = false;

        for (const [fieldName, selector] of Object.entries(fields)) {
            let value = "";
            if (selector.includes("@")) {
                const [sel, attr] = selector.split("@");
                value = $(element).find(sel).attr(attr) || "";
            } else {
                value = $(element).find(selector).text().trim();
            }

            if (value) hasData = true;
            item[fieldName] = value;
        }

        if (hasData) items.push(item);
    });

    if (items.length === 0) {
        throw new Error("No matching elements found");
    }

    const parentDir = path.dirname(outputPath);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    if (ext === '.json') {
        fs.writeFileSync(outputPath, JSON.stringify(items, null, 2), 'utf8');
    } else {
        const headers = Object.keys(fields);
        const escapeCSVValue = (val) => {
            if (val === null || val === undefined) return "";
            const str = String(val).replace(/"/g, '""');
            return `"${str}"`;
        };

        const csvLines = [headers.map(escapeCSVValue).join(",")];
        for (const item of items) {
            csvLines.push(headers.map(h => escapeCSVValue(item[h])).join(","));
        }

        const BOM = "\ufeff";
        fs.writeFileSync(outputPath, BOM + csvLines.join("\n"), 'utf8');
    }

    return { count: items.length };
}
class DebateOrchestrator {
    constructor() {
        this.reset();
    }

    reset() {
        this.topic = "";
        this.rounds = 3;
        this.currentRound = 0;
        this.phase = "idle"; // idle, generating_personas, brainstorming, challenging, reconciling, finished
        this.experts = []; // { name, role, systemPrompt, color }
        this.transcript = []; // { speaker, role, text, color }
        this.currentSpeakerIndex = 0;
        this.mermaidDiagram = "";
        this.apiKey = "";
    }

    async callGemini(systemInstruction, prompt, isJson = false) {
        const key = this.apiKey || process.env.GEMINI_API_KEY;
        if (!key) {
            throw new Error("Gemini API Key is missing. Please configure it in Settings.");
        }

        const model = "gemini-2.5-flash";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        
        const body = {
            contents: [
                {
                    parts: [
                        {
                            text: systemInstruction ? `${systemInstruction}\n\nUser Request: ${prompt}` : prompt
                        }
                    ]
                }
            ]
        };

        if (isJson) {
            body.generationConfig = {
                responseMimeType: "application/json"
            };
        }

        const response = await axios.post(url, body, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 25000
        });

        if (response.data && response.data.candidates && response.data.candidates[0].content) {
            return response.data.candidates[0].content.parts[0].text;
        }
        throw new Error("Failed to get response from Gemini API");
    }

    async start(topic, rounds, apiKey) {
        this.reset();
        this.topic = topic;
        this.rounds = parseInt(rounds) || 3;
        this.apiKey = apiKey;
        this.phase = "generating_personas";
        this.transcript.push({
            speaker: "Moderator",
            role: "Debate Moderator",
            text: `Starting the debate on topic: "${topic}". Spawning expert personas...`,
            color: "#a855f7"
        });

        const personaPrompt = `Analyze the topic "${topic}" and generate 3 expert personas (distinct professional roles) that would hold valuable and diverse perspectives on this topic. One should be technically oriented, one financially/business oriented, and one domain/practical oriented. Return a JSON object with this exact format:
{
  "experts": [
    {
      "name": "Expert Name",
      "role": "Professional Role",
      "systemPrompt": "A detailed system prompt instructing this expert on how to behave, their area of focus, and their tone.",
      "color": "#HEX_COLOR_CODE_HEX"
    }
  ]
}`;
        try {
            const resText = await this.callGemini("", personaPrompt, true);
            const data = JSON.parse(resText);
            this.experts = data.experts;
            
            const neonColors = ["#39ff14", "#00f0ff", "#ff007f"];
            this.experts.forEach((exp, idx) => {
                exp.color = exp.color || neonColors[idx % neonColors.length];
            });

            this.phase = "brainstorming";
            this.currentRound = 1;
            this.transcript.push({
                speaker: "Moderator",
                role: "Debate Moderator",
                text: `Spawning complete! Say hello to our panel:
1. ${this.experts[0].name} (${this.experts[0].role})
2. ${this.experts[1].name} (${this.experts[1].role})
3. ${this.experts[2].name} (${this.experts[2].role})

--- ROUND 1: BRAINSTORMING PHASE ---
I invite each expert to present their initial ideas, viewpoints, and suggestions for the project. Let's start!`,
                color: "#a855f7"
            });
            this.currentSpeakerIndex = 0;
            await this.generateDiagram();
        } catch (err) {
            this.phase = "idle";
            this.transcript.push({
                speaker: "Moderator",
                role: "System Error",
                text: `Initialization failed: ${err.message}`,
                color: "#ff4444"
            });
            throw err;
        }
    }

    async step() {
        if (this.phase === "idle" || this.phase === "finished") return;

        if (this.currentSpeakerIndex >= this.experts.length) {
            this.currentSpeakerIndex = 0;
            this.currentRound++;

            if (this.currentRound > this.rounds) {
                this.phase = "finished";
                this.transcript.push({
                    speaker: "Moderator",
                    role: "Debate Moderator",
                    text: `--- FINAL PHASE: BLUEPRINT COMPILATION ---
Thank you experts. The debate is concluded. Compiling the final project blueprint and action steps...`,
                    color: "#a855f7"
                });
                await this.compileBlueprint();
                await this.generateDiagram();
                return;
            }

            if (this.currentRound === 2) {
                this.phase = "challenging";
                this.transcript.push({
                    speaker: "Moderator",
                    role: "Debate Moderator",
                    text: `--- ROUND 2: CRITIQUE & CHALLENGE PHASE ---
Let's challenge each other's ideas. Experts, please review the previous round's points and raise criticisms, identify financial risks, or technical hurdles in your peers' proposals.`,
                    color: "#a855f7"
                });
            } else if (this.currentRound === 3) {
                this.phase = "reconciling";
                this.transcript.push({
                    speaker: "Moderator",
                    role: "Debate Moderator",
                    text: `--- ROUND 3: RECONCILIATION PHASE ---
Let's find common ground. Incorporating the criticisms, please propose adjustments and compromises to reach a unified project design.`,
                    color: "#a855f7"
                });
            } else {
                this.transcript.push({
                    speaker: "Moderator",
                    role: "Debate Moderator",
                    text: `--- ROUND ${this.currentRound} ---
Let's continue the discussion.`,
                    color: "#a855f7"
                });
            }
            await this.generateDiagram();
            return;
        }

        const expert = this.experts[this.currentSpeakerIndex];
        const context = this.transcript.map(t => `${t.speaker} (${t.role}): ${t.text}`).join("\n\n");
        const prompt = `Here is the current debate transcript so far:

${context}

You are ${expert.name} playing the role of ${expert.role}.
Please speak next. 
Ensure you stick strictly to your persona: ${expert.systemPrompt}
State your ideas based on the current debate phase: ${this.phase}.
Keep your response professional, constructive, and concise (under 120 words).`;

        try {
            const reply = await this.callGemini(expert.systemPrompt, prompt);
            this.transcript.push({
                speaker: expert.name,
                role: expert.role,
                text: reply.trim(),
                color: expert.color
            });
            this.currentSpeakerIndex++;
            await this.generateDiagram();
        } catch (err) {
            this.transcript.push({
                speaker: "System",
                role: "System Error",
                text: `Failed to generate expert turn: ${err.message}`,
                color: "#ff4444"
            });
        }
    }

    async intervene(comment) {
        if (this.phase === "idle" || this.phase === "finished") return;

        this.transcript.push({
            speaker: "User (God Mode)",
            role: "Project Owner",
            text: comment.trim(),
            color: "#facc15"
        });

        const context = this.transcript.slice(-4).map(t => `${t.speaker} (${t.role}): ${t.text}`).join("\n\n");
        const prompt = `The user (Project Owner) has just intervened in the debate with the following comment:
"${comment}"

As the Moderator, briefly acknowledge their comment, highlight its impact on the discussion, and guide the experts on how to respond. Keep it under 60 words.`;

        try {
            const reply = await this.callGemini("You are a professional debate moderator steering an AI panel.", prompt);
            this.transcript.push({
                speaker: "Moderator",
                role: "Debate Moderator",
                text: reply.trim(),
                color: "#a855f7"
            });
            await this.generateDiagram();
        } catch (err) {
            console.error("Intervention moderator reply failed", err);
        }
    }

    async compileBlueprint() {
        const context = this.transcript.map(t => `${t.speaker} (${t.role}): ${t.text}`).join("\n\n");
        const prompt = `Based on the complete debate transcript below:

${context}

Compile a comprehensive final project blueprint. Include sections:
1. Executive Summary
2. Unified System Architecture & Features
3. Financial Budget Estimate & Business Model
4. High-Level Implementation Steps (Milestones)

Keep it professional, highly structured, and under 500 words.`;

        try {
            const blueprint = await this.callGemini("You are a senior business consultant compiling a project blueprint.", prompt);
            this.transcript.push({
                speaker: "Moderator",
                role: "Final Project Blueprint",
                text: blueprint.trim(),
                color: "#39ff14"
            });
        } catch (err) {
            this.transcript.push({
                speaker: "Moderator",
                role: "System Error",
                text: `Failed to compile blueprint: ${err.message}`,
                color: "#ff4444"
            });
        }
    }

    async generateDiagram() {
        const context = this.transcript.slice(-6).map(t => `${t.speaker}: ${t.text}`).join("\n");
        const prompt = `Generate a Mermaid.js flowchart (graph TD) that visually models the key ideas, agreements, and disagreements from the current state of this debate. Keep the diagram simple (max 7 nodes) and quote labels containing special characters. Return ONLY valid Mermaid code starting with "graph TD". No markdown code fences. Example format:
graph TD
  A["Start Topic"] --> B["Idea 1"]
  B --> C["Critique 1"]
  B --> D["Agreement 1"]`;

        try {
            const diagram = await this.callGemini("You are a systems engineer modeling debates into flowcharts.", prompt);
            this.mermaidDiagram = diagram.replace(/```mermaid/g, "").replace(/```/g, "").trim();
        } catch (err) {
            console.error("Diagram generation failed", err);
        }
    }
}

const arena = new DebateOrchestrator();

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json'
};

const server = http.createServer((req, res) => {
    // API Routes
    if (req.url.startsWith('/api/')) {
        res.setHeader('Access-Control-Allow-Origin', 'http://localhost:4000');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(200); return res.end();
        }

        const AUTH_TOKEN = process.env.AUTH_TOKEN || "antigravity_secure_token";
        const PASSWORD = process.env.DASHBOARD_PASSWORD || "admin";

        if (req.method === 'POST' && req.url === '/api/login') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data.password === PASSWORD) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, token: AUTH_TOKEN }));
                    } else {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'Invalid password' }));
                    }
                } catch(e) {
                    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        const authHeader = req.headers.authorization;
        if (authHeader !== `Bearer ${AUTH_TOKEN}` && req.url !== '/api/logs' && req.url !== '/api/watch/stream') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Unauthorized' }));
        }

        if (req.method === 'GET') {
            if (req.url === '/api/plugins') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(getPlugins()));
            } else if (req.url === '/api/skills') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(getSkills()));
            } else if (req.url === '/api/prompts') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(readJsonFile('prompts.json').prompts || []));
            } else if (req.url === '/api/tasks') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(readJsonFile('tasks.json').tasks || []));
            } else if (req.url === '/api/knowledge') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(readJsonFile('knowledge.json').knowledge || []));
            } else if (req.url === '/api/metrics') {
                const freeMem = os.freemem();
                const totalMem = os.totalmem();
                const usedMem = totalMem - freeMem;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                const cpuBefore = process.cpuUsage();
                setTimeout(() => {}, 0);
                const cpus = os.cpus();
                const cpuLoad = cpus.reduce((acc, cpu) => {
                    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
                    const idle = cpu.times.idle;
                    return acc + ((total - idle) / total * 100);
                }, 0) / cpus.length;
                res.end(JSON.stringify({
                    cpu: parseFloat(cpuLoad.toFixed(1)),
                    memUsagePct: parseFloat(((usedMem / totalMem) * 100).toFixed(1)),
                    freeMemGb: parseFloat((freeMem / 1024 / 1024 / 1024).toFixed(2)),
                    totalMemGb: parseFloat((totalMem / 1024 / 1024 / 1024).toFixed(2))
                }));
            } else if (req.url === '/api/analytics') {
                const data = {
                    totalPlugins: getPlugins().length,
                    activePlugins: getPlugins().filter(p => p.active).length,
                    totalSkills: getSkills().length,
                    scheduledTasks: (readJsonFile('tasks.json').tasks || []).length
                };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(data));
            } else if (req.url === '/api/logs') {
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
                res.write(`data: [SYSTEM] Log Stream Connected at ${new Date().toLocaleTimeString()}\n\n`);
                const interval = setInterval(() => { res.write(`data: [INFO] Background check completed: ${new Date().toISOString()}\n\n`); }, 5000);
                req.on('close', () => clearInterval(interval));
            } else if (req.url === '/api/session-analytics') {
                const stats = { totalSessions: 0, totalUserMessages: 0, skillUsage: {}, toolUsage: {}, hourlyActivity: Array(24).fill(0) };
                try {
                    if (fs.existsSync(BRAIN_DIR)) {
                        const sessionDirs = fs.readdirSync(BRAIN_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
                        stats.totalSessions = sessionDirs.length;
                        for (const dir of sessionDirs) {
                            const logFile = path.join(BRAIN_DIR, dir.name, '.system_generated', 'logs', 'transcript.jsonl');
                            if (!fs.existsSync(logFile)) continue;
                            const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
                            for (const line of lines) {
                                try {
                                    const entry = JSON.parse(line);
                                    if (entry.type === 'USER_INPUT') stats.totalUserMessages++;
                                    if (entry.timestamp) {
                                        const hour = new Date(entry.timestamp).getHours();
                                        if (!isNaN(hour)) stats.hourlyActivity[hour]++;
                                    }
                                    const content = JSON.stringify(entry.content || '');
                                    const skillMatches = content.match(/SK-[a-z0-9-]+/g) || [];
                                    skillMatches.forEach(s => { stats.skillUsage[s] = (stats.skillUsage[s] || 0) + 1; });
                                    const toolMatches = content.match(/"tool_name":"([^"]+)"/g) || [];
                                    toolMatches.forEach(t => {
                                        const name = t.replace('"tool_name":"', '').replace('"', '');
                                        stats.toolUsage[name] = (stats.toolUsage[name] || 0) + 1;
                                    });
                                } catch(e) {}
                            }
                        }
                    }
                } catch(e) { console.error('Analytics error:', e); }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(stats));
            } else if (req.url === '/api/watch/stream') {
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
                res.write(`data: ${JSON.stringify({ event: 'connected', file: '', time: new Date().toISOString() })}\n\n`);
                watchClients.push(res);
                req.on('close', () => { watchClients = watchClients.filter(c => c !== res); });
            } else if (req.url === '/api/backup') {
                try {
                    const files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.zip')).map(f => {
                        const stat = fs.statSync(path.join(BACKUP_DIR, f));
                        return { name: f, size: (stat.size / 1024 / 1024).toFixed(2) + ' MB', date: stat.mtime.toLocaleDateString() };
                    }) : [];
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(files));
                } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
            } else if (req.url === '/api/rules') {
                try {
                    const files = fs.readdirSync(RULES_DIR).filter(f => f.endsWith('.md') || f.endsWith('.disabled')).map(f => ({
                        name: f,
                        content: fs.readFileSync(path.join(RULES_DIR, f), 'utf8'),
                        active: !f.endsWith('.disabled')
                    }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(files));
                } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
            } else if (req.url === '/api/agents') {
                try {
                    const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.json')).map(f => {
                        const content = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, f), 'utf8'));
                        return { filename: f, ...content };
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(files));
                } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
            } else if (req.url === '/api/store/skills') {
                const storeSkills = [
                    { name: "SEO Master", desc: "Optimizes any web page for search engines.", id: "seo-master" },
                    { name: "Security Auditor", desc: "Checks code for OWASP vulnerabilities.", id: "security-auditor" },
                    { name: "Code Reviewer", desc: "Strictly reviews pull requests and code diffs.", id: "code-reviewer" },
                    { name: "Python Expert", desc: "Specializes in Python, Django, and Fast API.", id: "python-expert" },
                    { name: "UI/UX Designer", desc: "Improves aesthetics and accessibility.", id: "ui-designer" }
                ];
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(storeSkills));
            } else if (req.url === '/api/macros') {
                try {
                    const files = fs.readdirSync(MACROS_DIR).filter(f => f.startsWith('SK-macro-') && f.endsWith('.md')).map(f => ({
                        name: f.replace('SK-macro-', '').replace('.md', ''),
                        filename: f,
                        content: fs.readFileSync(path.join(MACROS_DIR, f), 'utf8')
                    }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(files));
                } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
            } else if (req.url === '/api/memory') {
                const memPath = path.join(RULES_DIR, 'project_memory.md');
                const content = fs.existsSync(memPath) ? fs.readFileSync(memPath, 'utf8') : '';
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ content }));
            } else if (req.url === '/api/system/volume') {
                const scriptPath = path.join(CONFIG_DIR, '../antigravity/scratch/system-controller-mcp/get-volume.ps1');
                exec(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, (err, stdout, stderr) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: err.message }));
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ volume: parseInt(stdout.trim()) || 0 }));
                });
            } else if (req.url === '/api/arena/status') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    topic: arena.topic,
                    rounds: arena.rounds,
                    currentRound: arena.currentRound,
                    phase: arena.phase,
                    experts: arena.experts,
                    transcript: arena.transcript,
                    currentSpeakerIndex: arena.currentSpeakerIndex,
                    mermaidDiagram: arena.mermaidDiagram
                }));
            } else if (req.url === '/api/config') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(getConfig()));
            } else if (req.url === '/api/bridge/tokens') {
                const totalTokens = syncBridgePlugin();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ totalTokens }));
            } else {
                res.writeHead(404); res.end();
            }

        } else if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const data = body ? JSON.parse(body) : {};
                    if (req.url === '/api/plugins') {
                        updatePlugins(data.activePlugins || []);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else if (req.url === '/api/tasks') {
                        const tasksData = readJsonFile('tasks.json');
                        if (!tasksData.tasks) tasksData.tasks = [];
                        data.id = Date.now().toString();
                        tasksData.tasks.push(data);
                        writeJsonFile('tasks.json', tasksData);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, task: data }));
                    } else if (req.url === '/api/git') {
                        const { command, repoPath, message } = data;
                        const allowedCommands = ['status', 'commit', 'push'];
                        if (!allowedCommands.includes(command)) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ success: false, error: 'Invalid git command' }));
                        }
                        let gitCmd = '';
                        if (command === 'status') gitCmd = 'git status';
                        else if (command === 'commit') {
                            const safeMsg = (message || 'Update from Antigravity').replace(/[^a-zA-Z0-9 _.,!@#$%^&*()\-+=]/g, '');
                            gitCmd = `git add . && git commit -m "${safeMsg}"`;
                        }
                        else if (command === 'push') gitCmd = 'git push';
                        const execPath = (repoPath && repoPath.trim()) ? repoPath.trim() : (process.env.USERPROFILE || process.env.HOME);
                        if (!fs.existsSync(execPath)) {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ success: false, output: '', error: `Path not found: ${execPath}` }));
                        }
                        exec(gitCmd, { cwd: execPath, shell: true }, (error, stdout, stderr) => {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: !error, output: stdout + (stderr ? '\n[STDERR] ' + stderr : ''), error: error ? error.message : null }));
                        });
                    } else if (req.url === '/api/watch') {
                        const { watchPath } = data;
                        if (activeWatchers.has('main')) { activeWatchers.get('main').close(); }
                        if (!fs.existsSync(watchPath)) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ error: 'Path not found' }));
                        }
                        const watcher = fs.watch(watchPath, { recursive: true }, (eventType, filename) => {
                            if (!filename) return;
                            const msg = JSON.stringify({ event: eventType, file: filename, time: new Date().toISOString() });
                            watchClients.forEach(c => { try { c.write(`data: ${msg}\n\n`); } catch(e) {} });
                        });
                        activeWatchers.set('main', watcher);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, watching: watchPath }));
                    } else if (req.url === '/api/backup') {
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                        const outFile = path.join(BACKUP_DIR, `config-backup-${timestamp}.zip`);
                        const output = fs.createWriteStream(outFile);
                        const archive = archiver('zip', { zlib: { level: 9 } });
                        archive.pipe(output);
                        archive.directory(CONFIG_DIR, 'config');
                        archive.finalize();
                        output.on('close', () => {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, file: path.basename(outFile), size: (archive.pointer() / 1024 / 1024).toFixed(2) + ' MB' }));
                        });
                        archive.on('error', e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
                    } else if (req.url === '/api/rules') {
                        const { filename, content } = data;
                        fs.writeFileSync(path.join(RULES_DIR, filename), content);
                        syncBridgePlugin();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else if (req.url === '/api/agents') {
                        const { name, role, systemPrompt, color } = data;
                        const filename = `${name}.json`;
                        fs.writeFileSync(path.join(AGENTS_DIR, filename), JSON.stringify({ name, role, systemPrompt, color }, null, 2));
                        syncBridgePlugin();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else if (req.url === '/api/store/install') {
                        const { id, name, desc } = data;
                        const filename = `SK-${id}.md`;
                        const content = `---\nname: ${name}\ndescription: ${desc}\n---\n# System Prompt\nYou are ${name}. ${desc}`;
                        fs.writeFileSync(path.join(STORE_DIR, filename), content);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else if (req.url === '/api/macros') {
                        const { name, content } = data;
                        const filename = `SK-macro-${name}.md`;
                        const macroContent = `---\nname: macro-${name}\ndescription: Auto-generated macro for ${name}\n---\n\n${content}`;
                        fs.writeFileSync(path.join(MACROS_DIR, filename), macroContent);
                        syncBridgePlugin();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else if (req.url === '/api/memory') {
                        const { content } = data;
                        fs.writeFileSync(path.join(RULES_DIR, 'project_memory.md'), content);
                        syncBridgePlugin();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else if (req.url === '/api/system/volume') {
                        const { volume } = data;
                        const scriptPath = path.join(CONFIG_DIR, '../antigravity/scratch/system-controller-mcp/set-volume.ps1');
                        exec(`powershell -ExecutionPolicy Bypass -File "${scriptPath}" -volume ${volume}`, (err, stdout, stderr) => {
                            if (err) {
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                return res.end(JSON.stringify({ error: err.message }));
                            }
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        });
                    } else if (req.url === '/api/system/media') {
                        const { action } = data;
                        let charCode = 179;
                        if (action === 'next') charCode = 176;
                        else if (action === 'previous') charCode = 177;
                        
                        exec(`powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]${charCode})"`, (err, stdout, stderr) => {
                            if (err) {
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                return res.end(JSON.stringify({ error: err.message }));
                            }
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        });
                    } else if (req.url === '/api/system/organize') {
                        const { directory_path } = data;
                        organizeDirectoryHelper(directory_path).then(result => {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, result }));
                        }).catch(err => {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: err.message }));
                        });
                    } else if (req.url === '/api/system/scrape') {
                        const { url, container_selector, fields, output_file_path, username, password } = data;
                        scrapeWebpageHelper(url, container_selector, fields, output_file_path, username, password).then(result => {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, result }));
                        }).catch(err => {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: err.message }));
                        });
                    } else if (req.url === '/api/arena/start') {
                        const { topic, rounds } = data;
                        const config = getConfig();
                        const apiKey = config.geminiApiKey || '';
                        arena.start(topic, rounds, apiKey).then(() => {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, phase: arena.phase }));
                        }).catch(err => {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: err.message }));
                        });
                    } else if (req.url === '/api/arena/step') {
                        arena.step().then(() => {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, phase: arena.phase }));
                        }).catch(err => {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: err.message }));
                        });
                    } else if (req.url === '/api/arena/intervene') {
                        const { comment } = data;
                        arena.intervene(comment).then(() => {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        }).catch(err => {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: err.message }));
                        });
                    } else if (req.url === '/api/settings/config') {
                        const { apiKey } = data;
                        const existingConfig = getConfig();
                        existingConfig.geminiApiKey = apiKey || '';
                        saveConfig(existingConfig);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else {
                        res.writeHead(404); res.end();
                    }
                } catch (err) {
                    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
                }
            });

        } else if (req.method === 'DELETE') {
            if (req.url.startsWith('/api/tasks/')) {
                const taskId = req.url.split('/').pop();
                const tasksData = readJsonFile('tasks.json');
                if (tasksData.tasks) {
                    tasksData.tasks = tasksData.tasks.filter(t => t.id !== taskId);
                    writeJsonFile('tasks.json', tasksData);
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else if (req.url.startsWith('/api/backup/')) {
                const filename = decodeURIComponent(req.url.split('/api/backup/')[1]);
                const filePath = path.join(BACKUP_DIR, filename);
                try {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
            } else if (req.url.startsWith('/api/rules/')) {
                const filename = decodeURIComponent(req.url.split('/api/rules/')[1]);
                const filePath = path.join(RULES_DIR, filename);
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); syncBridgePlugin(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true })); } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
            } else if (req.url.startsWith('/api/agents/')) {
                const filename = decodeURIComponent(req.url.split('/api/agents/')[1]);
                const filePath = path.join(AGENTS_DIR, filename);
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); syncBridgePlugin(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true })); } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
            } else if (req.url.startsWith('/api/macros/')) {
                const filename = decodeURIComponent(req.url.split('/api/macros/')[1]);
                const filePath = path.join(MACROS_DIR, filename);
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); syncBridgePlugin(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true })); } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
            } else {
                res.writeHead(404); res.end();
            }
        }
        return;
    }


    // Static File Serving
    let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
    const extname = path.extname(filePath);
    let contentType = MIME_TYPES[extname] || 'text/plain';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                res.writeHead(404); res.end('File not found');
            } else {
                res.writeHead(500); res.end('Server Error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// Simple Task Runner (Checks every 60s)
setInterval(() => {
    const tasksData = readJsonFile('tasks.json');
    if (!tasksData.tasks) return;
    tasksData.tasks.forEach(task => {
        // Very simplistic execution just for demonstration. 
        // In reality, you'd parse cron syntax. Here we just run the command if marked 'run_now' or something similar.
        // For safety, we only run if explicitly needed, but for this demo, we'll just log it.
        console.log(`[Task Runner] Checked task: ${task.name} - ${task.command}`);
    });
}, 60000);

server.listen(PORT, () => {
    console.log("Antigravity Central UI running at http://localhost:" + PORT);
});
