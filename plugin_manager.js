require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile } = require('child_process');
const readline = require('readline');
const archiver = require('archiver');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');

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

// ── Security Helpers ──────────────────────────────────────────
function safeJoin(base, userPath) {
    const resolved = path.resolve(base, userPath);
    if (resolved.toLowerCase().startsWith(base.toLowerCase())) return resolved;
    throw new Error('Path traversal blocked');
}

function safeFilename(userFilename) {
    const base = path.basename(userFilename);
    if (base !== userFilename) throw new Error('Path traversal blocked in filename');
    return base;
}

function sendJson(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function sendError(res, message, status = 500) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
    console.error(`[ERROR] ${status} — ${message}`);
}

function isPrivateIP(hostname) {
    const parts = hostname.split('.').map(Number);
    if (parts.length !== 4) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (hostname === 'localhost') return true;
    if (hostname.startsWith('::1')) return true;
    return false;
}

function validateInt(val, min, max) {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < min || n > max) throw new Error(`Value must be integer ${min}-${max}`);
    return n;
}

function escapeShellArg(arg) {
    return `"${String(arg).replace(/[\\"]/g, '')}"`;
}

const AUDIT_LOG = path.join(DATA_DIR, 'audit.json');
function auditAction(action, details, req) {
    try {
        const log = fs.existsSync(AUDIT_LOG) ? JSON.parse(fs.readFileSync(AUDIT_LOG, 'utf8')) : [];
        log.push({ action, details, ip: req.socket.remoteAddress, time: new Date().toISOString() });
        fs.writeFileSync(AUDIT_LOG, JSON.stringify(log, null, 2));
    } catch (e) { console.error('Audit write failed:', e.message); }
}

// ── Rate Limiter ──────────────────────────────────────────────
const rateLimitMap = new Map();
function checkRateLimit(ip, maxRequests = 60, windowMs = 60000) {
    const now = Date.now();
    if (!rateLimitMap.has(ip)) { rateLimitMap.set(ip, []); }
    const timestamps = rateLimitMap.get(ip).filter(t => now - t < windowMs);
    timestamps.push(now);
    rateLimitMap.set(ip, timestamps);
    if (timestamps.length > maxRequests) throw new Error('Rate limit exceeded');
    return true;
}

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

// ── Antigravity Skill Model ─────────────────────────────────
const GLOBAL_SKILLS_DIR = path.join(CONFIG_DIR, 'skills');

function parseSkillFrontmatter(content) {
    const result = { name: '', description: '' };
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return result;
    for (const line of match[1].split('\n')) {
        const nameMatch = line.match(/^name\s*:\s*(.+)/);
        if (nameMatch) result.name = nameMatch[1].trim();
        const descMatch = line.match(/^description\s*:\s*(.+)/);
        if (descMatch) result.description = descMatch[1].trim();
    }
    return result;
}

function tokenEstimate(text) {
    return Math.ceil((text || '').length / 4);
}

function getProjectRoot() {
    let dir = process.cwd();
    for (let i = 0; i < 5; i++) {
        if (fs.existsSync(path.join(dir, '.agents'))) return dir;
        if (fs.existsSync(path.join(dir, '.agent'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

const WORKSPACE_SKILLS_DIRS = ['.agents', '.agent'].map(suffix => path.join(suffix, 'skills'));

function readSkillsFromDir(baseDir, scope) {
    const skills = [];
    if (!fs.existsSync(baseDir)) return skills;
    try {
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const entry of entries) {
            let skillPath, name, content;
            if (entry.isDirectory()) {
                // Subdirectory format: <skill-name>/SKILL.md
                skillPath = path.join(baseDir, entry.name, 'SKILL.md');
                if (!fs.existsSync(skillPath)) continue;
                name = entry.name;
            } else if (entry.name.endsWith('.md') && entry.isFile()) {
                // Flat file format: <skill-name>.md
                skillPath = path.join(baseDir, entry.name);
                name = entry.name.replace(/\.md$/, '');
            } else continue;
            content = fs.readFileSync(skillPath, 'utf8');
            const front = parseSkillFrontmatter(content);
            skills.push({
                name: front.name || name,
                description: front.description || '(no description)',
                scope,
                filename: path.basename(skillPath),
                filePath: skillPath,
                tokenEstimate: tokenEstimate(content),
                contentLength: content.length,
                skillDir: entry.isDirectory() ? path.join(baseDir, entry.name) : null
            });
        }
    } catch (e) { console.error(`Error reading skills from ${baseDir}:`, e.message); }
    return skills;
}

function getSkillsEnhanced() {
    const byName = new Map();
    // 1. Load Global skills
    const globalSkills = readSkillsFromDir(GLOBAL_SKILLS_DIR, 'global');
    for (const s of globalSkills) {
        s.effective = true;
        byName.set(s.name, s);
    }
    // 2. Load Workspace skills (override Global)
    const projectRoot = getProjectRoot();
    if (projectRoot) {
        for (const relDir of WORKSPACE_SKILLS_DIRS) {
            const wsDir = path.join(projectRoot, relDir);
            const wsSkills = readSkillsFromDir(wsDir, 'workspace');
            for (const s of wsSkills) {
                if (byName.has(s.name)) {
                    const existing = byName.get(s.name);
                    existing.effective = false;
                    existing.overriddenBy = 'workspace';
                    s.overrides = existing.name;
                    s.effective = true;
                } else {
                    s.effective = true;
                }
                byName.set(s.name, s);
            }
        }
    }
    return Array.from(byName.values());
}

// Also load plugins-based skills (legacy) for backward compat
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
                            const fullPath = skill.isDirectory() ? path.join(skillsDir, skill.name, 'SKILL.md') : path.join(skillsDir, skill.name);
                            let description = `Module from ${plugin.name}`;
                            let content = '';
                            if (fs.existsSync(fullPath)) {
                                content = fs.readFileSync(fullPath, 'utf8');
                                const front = parseSkillFrontmatter(content);
                                if (front.description) description = front.description;
                                if (front.name) name = front.name;
                            }
                            skills.push({ name, description, scope: 'plugin', tokenEstimate: tokenEstimate(content), contentLength: content.length });
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
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        
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
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
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

        // CSRF check for state-changing methods
        if (['POST', 'DELETE', 'PUT'].includes(req.method)) {
            const origin = req.headers.origin || '';
            const referer = req.headers.referer || '';
            if (origin && !origin.startsWith('http://localhost')) {
                sendJson(res, { error: 'Forbidden' }, 403);
                return;
            }
        }

        // Rate limiting
        try {
            const isLogin = (req.method === 'POST' && req.url === '/api/login');
            checkRateLimit(req.socket.remoteAddress, isLogin ? 5 : 60, 60000);
        } catch (e) {
            sendJson(res, { error: 'Rate limit exceeded. Try again later.' }, 429);
            return;
        }

        if (req.method === 'POST' && req.url === '/api/login') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data.password === PASSWORD) {
                        sendJson(res, { success: true, token: AUTH_TOKEN });
                    } else {
                        sendJson(res, { success: false, error: 'Invalid password' }, 401);
                    }
                } catch(e) {
                    sendError(res, 'Login parse error');
                }
            });
            return;
        }

        // Auth check — ALL routes including SSE require auth
        const authHeader = req.headers.authorization;
        if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
            sendJson(res, { error: 'Unauthorized' }, 401);
            return;
        }

        if (req.method === 'GET') {
            if (req.url === '/api/plugins') {
                sendJson(res, getPlugins());
            } else if (req.url === '/api/skills') {
                sendJson(res, getSkills());
            } else if (req.url === '/api/prompts') {
                sendJson(res, readJsonFile('prompts.json').prompts || []);
            } else if (req.url === '/api/tasks') {
                sendJson(res, readJsonFile('tasks.json').tasks || []);
            } else if (req.url === '/api/knowledge') {
                sendJson(res, readJsonFile('knowledge.json').knowledge || []);
            } else if (req.url === '/api/metrics') {
                const freeMem = os.freemem();
                const totalMem = os.totalmem();
                const usedMem = totalMem - freeMem;
                // Real CPU measurement: sample over 100ms
                const cpuStart = os.cpus().map(c => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
                setTimeout(() => {
                    const cpuEnd = os.cpus().map((c, i) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
                    const loads = cpuEnd.map((e, i) => {
                        const totalDiff = e.total - cpuStart[i].total;
                        const idleDiff = e.idle - cpuStart[i].idle;
                        return totalDiff > 0 ? ((totalDiff - idleDiff) / totalDiff) * 100 : 0;
                    });
                    const cpuLoad = loads.reduce((a, b) => a + b, 0) / loads.length;
                    sendJson(res, {
                        cpu: parseFloat(cpuLoad.toFixed(1)),
                        memUsagePct: parseFloat(((usedMem / totalMem) * 100).toFixed(1)),
                        freeMemGb: parseFloat((freeMem / 1024 / 1024 / 1024).toFixed(2)),
                        totalMemGb: parseFloat((totalMem / 1024 / 1024 / 1024).toFixed(2))
                    });
                }, 100);
            } else if (req.url === '/api/analytics') {
                sendJson(res, {
                    totalPlugins: getPlugins().length,
                    activePlugins: getPlugins().filter(p => p.active).length,
                    totalSkills: getSkills().length,
                    scheduledTasks: (readJsonFile('tasks.json').tasks || []).length
                });
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
                sendJson(res, stats);
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
                    sendJson(res, files);
                } catch(e) { sendError(res, e.message); }
            } else if (req.url === '/api/rules') {
                try {
                    const files = fs.readdirSync(RULES_DIR).filter(f => f.endsWith('.md') || f.endsWith('.disabled')).map(f => ({
                        name: f,
                        content: fs.readFileSync(path.join(RULES_DIR, f), 'utf8'),
                        active: !f.endsWith('.disabled')
                    }));
                    sendJson(res, files);
                } catch(e) { sendError(res, e.message); }
            } else if (req.url === '/api/agents') {
                try {
                    const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.json')).map(f => {
                        const content = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, f), 'utf8'));
                        return { filename: f, ...content };
                    });
                    sendJson(res, files);
                } catch(e) { sendError(res, e.message); }
            } else if (req.url.startsWith('/api/store/skills')) {
                const config = getConfig();
                const registryUrl = config.skillRegistryUrl || '';
                const fallback = [
                    { name: "SEO Master", desc: "Optimizes any web page for search engines.", id: "seo-master" },
                    { name: "Security Auditor", desc: "Checks code for OWASP vulnerabilities.", id: "security-auditor" },
                    { name: "Code Reviewer", desc: "Strictly reviews pull requests and code diffs.", id: "code-reviewer" },
                    { name: "Python Expert", desc: "Specializes in Python, Django, and Fast API.", id: "python-expert" },
                    { name: "UI/UX Designer", desc: "Improves aesthetics and accessibility.", id: "ui-designer" }
                ];
                if (!registryUrl) { sendJson(res, fallback); return; }
                const parsedUrl = new URL(req.url, 'http://localhost');
                const search = parsedUrl.searchParams.get('q') || '';
                axios.get(registryUrl, { timeout: 8000 }).then(response => {
                    let items = Array.isArray(response.data) ? response.data : fallback;
                    if (search) {
                        const q = search.toLowerCase();
                        items = items.filter(i => (i.name || '').toLowerCase().includes(q) || (i.desc || '').toLowerCase().includes(q));
                    }
                    sendJson(res, items);
                }).catch(() => { sendJson(res, fallback); });
            } else if (req.url === '/api/macros') {
                try {
                    const files = fs.readdirSync(MACROS_DIR).filter(f => f.startsWith('SK-macro-') && f.endsWith('.md')).map(f => ({
                        name: f.replace('SK-macro-', '').replace('.md', ''),
                        filename: f,
                        content: fs.readFileSync(path.join(MACROS_DIR, f), 'utf8')
                    }));
                    sendJson(res, files);
                } catch(e) { sendError(res, e.message); }
            } else if (req.url === '/api/memory') {
                const memPath = path.join(RULES_DIR, 'project_memory.md');
                const content = fs.existsSync(memPath) ? fs.readFileSync(memPath, 'utf8') : '';
                sendJson(res, { content });
            } else if (req.url === '/api/system/volume') {
                const scriptPath = path.resolve(CONFIG_DIR, '..', 'antigravity', 'scratch', 'system-controller-mcp', 'get-volume.ps1');
                if (!scriptPath.startsWith(CONFIG_DIR)) { sendError(res, 'Invalid script path'); return; }
                execFile('powershell', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], (err, stdout) => {
                    if (err) { sendError(res, 'Volume fetch failed'); return; }
                    sendJson(res, { volume: parseInt(stdout.trim()) || 0 });
                });
            } else if (req.url === '/api/arena/status') {
                sendJson(res, {
                    topic: arena.topic,
                    rounds: arena.rounds,
                    currentRound: arena.currentRound,
                    phase: arena.phase,
                    experts: arena.experts,
                    transcript: arena.transcript,
                    currentSpeakerIndex: arena.currentSpeakerIndex,
                    mermaidDiagram: arena.mermaidDiagram
                });
            } else if (req.url === '/api/config') {
                const config = getConfig();
                if (config.geminiApiKey) {
                    config.geminiApiKey = config.geminiApiKey.slice(0, 4) + '...' + config.geminiApiKey.slice(-4);
                }
                sendJson(res, config);
            } else if (req.url === '/api/bridge/tokens') {
                sendJson(res, { totalTokens: syncBridgePlugin() });
            } else if (req.url === '/api/audit') {
                try {
                    const log = fs.existsSync(AUDIT_LOG) ? JSON.parse(fs.readFileSync(AUDIT_LOG, 'utf8')) : [];
                    sendJson(res, log.slice(-100).reverse());
                } catch(e) { sendJson(res, []); }
            } else if (req.url === '/api/task-history') {
                sendJson(res, getTaskHistory().slice(-100).reverse());
            } else if (req.url === '/api/skills/enhanced') {
                try { sendJson(res, getSkillsEnhanced()); } catch(e) { sendError(res, e.message); }
            } else if (req.url === '/api/skills/lint') {
                try {
                    const skills = getSkillsEnhanced();
                    const genericWords = ['helps', 'useful', 'tool', 'module', 'nice', 'good', 'simple'];
                    const results = skills.map(s => {
                        const warnings = [];
                        if (!s.description || s.description.length < 10) warnings.push('Description too short (<10 chars) for reliable semantic matching');
                        if (s.description === '(no description)') warnings.push('Missing description — add a YAML description field to SKILL.md');
                        const lower = (s.description || '').toLowerCase();
                        for (const w of genericWords) { if (lower.includes(w)) { warnings.push(`Contains generic word "${w}" — be more specific`); break; } }
                        if (!/^(reviews?|generates?|analyzes?|manages?|checks?|optimizes?|audits?|creates?|designs?|monitors?|validates?|formats?|extracts?|transforms?|summarizes?)/i.test(lower)) warnings.push('Missing action verb — start description with "Reviews", "Generates", etc.');
                        return { skill: s.name, scope: s.scope, description: s.description, warnings };
                    });
                    sendJson(res, results);
                } catch(e) { sendError(res, e.message); }
            } else if (req.url === '/api/skills/conflicts') {
                try {
                    const skills = getSkillsEnhanced();
                    const conflicts = [];
                    for (let i = 0; i < skills.length; i++) {
                        for (let j = i + 1; j < skills.length; j++) {
                            const a = (skills[i].description || '').toLowerCase().split(/\s+/);
                            const b = (skills[j].description || '').toLowerCase().split(/\s+/);
                            const setA = new Set(a); const setB = new Set(b);
                            const intersection = new Set([...setA].filter(x => setB.has(x)));
                            const union = new Set([...setA, ...setB]);
                            const jaccard = union.size > 0 ? intersection.size / union.size : 0;
                            if (jaccard > 0.6) {
                                conflicts.push({ a: skills[i].name, b: skills[j].name, similarity: Math.round(jaccard * 100), aScope: skills[i].scope, bScope: skills[j].scope });
                            }
                            const normA = skills[i].name.toLowerCase().replace(/[^a-z0-9]/g, '');
                            const normB = skills[j].name.toLowerCase().replace(/[^a-z0-9]/g, '');
                            if (normA === normB && skills[i].scope !== skills[j].scope) {
                                conflicts.push({ a: skills[i].name, b: skills[j].name, similarity: 100, type: 'scope_duplicate', aScope: skills[i].scope, bScope: skills[j].scope, winner: 'workspace' });
                            }
                        }
                    }
                    sendJson(res, conflicts);
                } catch(e) { sendError(res, e.message); }
            } else if (req.url === '/api/mcp/health') {
                try {
                    const config = getConfig();
                    const servers = config.mcpServers || [];
                    const results = servers.map(s => ({ name: s.name, url: s.url, status: 'unknown', lastCheck: null }));
                    // Sequential health checks with 5s timeout each
                    const checkOne = (idx) => {
                        if (idx >= results.length) { sendJson(res, results); return; }
                        const r = results[idx];
                        const controller = new AbortController();
                        const timer = setTimeout(() => controller.abort(), 5000);
                        axios.get(r.url + '/health', { signal: controller.signal, timeout: 5000 }).then(() => {
                            r.status = 'connected'; r.lastCheck = new Date().toISOString();
                        }).catch(() => { r.status = 'unreachable'; r.lastCheck = new Date().toISOString(); })
                        .finally(() => { clearTimeout(timer); checkOne(idx + 1); });
                    };
                    checkOne(0);
                } catch(e) { sendError(res, e.message); }
            } else if (req.url === '/api/skills/mcp-mapping') {
                try {
                    const skills = getSkillsEnhanced();
                    const config = getConfig();
                    const mcpNames = (config.mcpServers || []).map(s => s.name.toLowerCase());
                    const mapping = skills.map(s => {
                        let content = '';
                        if (s.filePath && fs.existsSync(s.filePath)) content = fs.readFileSync(s.filePath, 'utf8');
                        const referencedTools = mcpNames.filter(m => content.toLowerCase().includes(m));
                        return { skill: s.name, scope: s.scope, mcpTools: referencedTools };
                    });
                    sendJson(res, mapping);
                } catch(e) { sendError(res, e.message); }
            } else if (req.url === '/api/artifacts') {
                try {
                    const projectRoot = getProjectRoot();
                    if (!projectRoot) { sendJson(res, { error: 'No workspace found' }); return; }
                    const artifactsDir = path.join(projectRoot, '.agents', 'artifacts');
                    if (!fs.existsSync(artifactsDir)) { sendJson(res, []); return; }
                    const categories = ['tasks', 'plans', 'screenshots', 'recordings'];
                    const result = [];
                    for (const cat of categories) {
                        const catDir = path.join(artifactsDir, cat);
                        if (!fs.existsSync(catDir)) continue;
                        const files = fs.readdirSync(catDir, { withFileTypes: true });
                        for (const f of files) {
                            if (!f.isFile()) continue;
                            const fp = path.join(catDir, f.name);
                            const stat = fs.statSync(fp);
                            result.push({ category: cat, name: f.name, size: stat.size, modified: stat.mtime.toISOString(), path: fp });
                        }
                    }
                    sendJson(res, result);
                } catch(e) { sendError(res, e.message); }
            } else if (req.url === '/api/skills/heatmap') {
                try {
                    const usageFile = path.join(DATA_DIR, 'skill_usage.json');
                    const usage = fs.existsSync(usageFile) ? JSON.parse(fs.readFileSync(usageFile, 'utf8')) : {};
                    sendJson(res, usage);
                } catch(e) { sendJson(res, {}); }
            } else if (req.url === '/api/rules/skill-enforcement') {
                try {
                    const skills = getSkillsEnhanced();
                    const skillNames = new Set(skills.filter(s => s.effective).map(s => s.name.toLowerCase()));
                    const rules = fs.readdirSync(RULES_DIR).filter(f => f.endsWith('.md') && f !== 'project_memory.md');
                    const results = rules.map(r => {
                        const content = fs.readFileSync(path.join(RULES_DIR, r), 'utf8');
                        const mentioned = [];
                        for (const s of skillNames) { if (content.toLowerCase().includes(s)) mentioned.push(s); }
                        return { rule: r, requiredSkills: mentioned, allInstalled: mentioned.every(s => skillNames.has(s)), totalRequired: mentioned.length };
                    });
                    sendJson(res, results);
                } catch(e) { sendError(res, e.message); }
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
                        auditAction('plugins_sync', { activeCount: (data.activePlugins || []).length }, req);
                        sendJson(res, { success: true });
                    } else if (req.url === '/api/tasks') {
                        const tasksData = readJsonFile('tasks.json');
                        if (!tasksData.tasks) tasksData.tasks = [];
                        data.id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
                        tasksData.tasks.push(data);
                        writeJsonFile('tasks.json', tasksData);
                        reloadTaskScheduler();
                        sendJson(res, { success: true, task: data });
                    } else if (req.url === '/api/git') {
                        const { command, repoPath, message } = data;
                        const allowedCommands = ['status', 'commit', 'push'];
                        if (!allowedCommands.includes(command)) {
                            sendJson(res, { success: false, error: 'Invalid git command' }, 400);
                            return;
                        }
                        const execPath = path.resolve((repoPath && repoPath.trim()) ? repoPath.trim() : (process.env.USERPROFILE || process.env.HOME));
                        const userPrefix = (process.env.USERPROFILE || process.env.HOME || '').toLowerCase();
                        if (!execPath.toLowerCase().startsWith(userPrefix)) {
                            sendJson(res, { success: false, error: 'Repository path must be under your user profile' }, 403);
                            return;
                        }
                        if (!fs.existsSync(execPath)) {
                            sendJson(res, { success: false, output: '', error: 'Path not found' }, 400);
                            return;
                        }
                        auditAction('git_' + command, { repoPath: execPath }, req);
                        if (command === 'status') {
                            execFile('git', ['-C', execPath, 'status'], (error, stdout, stderr) => {
                                sendJson(res, { success: !error, output: stdout + (stderr ? '\n[STDERR] ' + stderr : ''), error: error ? error.message : null });
                            });
                        } else if (command === 'commit') {
                            const commitMsg = (message || 'Update from Antigravity').slice(0, 200).replace(/[<>|]/g, '');
                            execFile('git', ['-C', execPath, 'add', '.'], (err1) => {
                                if (err1) { sendJson(res, { success: false, error: err1.message }); return; }
                                execFile('git', ['-C', execPath, 'commit', '-m', commitMsg], (err2, stdout2) => {
                                    sendJson(res, { success: !err2, output: stdout2 || 'Nothing to commit.', error: err2 ? err2.message : null });
                                });
                            });
                        } else if (command === 'push') {
                            execFile('git', ['-C', execPath, 'push'], (error, stdout, stderr) => {
                                sendJson(res, { success: !error, output: stdout + (stderr ? '\n[STDERR] ' + stderr : ''), error: error ? error.message : null });
                            });
                        }
                    } else if (req.url === '/api/watch') {
                        const { watchPath } = data;
                        if (activeWatchers.has('main')) { activeWatchers.get('main').close(); }
                        const resolvedPath = path.resolve(watchPath || '');
                        const userPrefix = (process.env.USERPROFILE || process.env.HOME || '').toLowerCase();
                        if (!resolvedPath.toLowerCase().startsWith(userPrefix)) {
                            sendJson(res, { error: 'Watch path must be under your user profile' }, 403);
                            return;
                        }
                        if (!fs.existsSync(resolvedPath)) {
                            sendJson(res, { error: 'Path not found' }, 400);
                            return;
                        }
                        const watcher = fs.watch(resolvedPath, { recursive: true }, (eventType, filename) => {
                            if (!filename) return;
                            const msg = JSON.stringify({ event: eventType, file: filename, time: new Date().toISOString() });
                            watchClients.forEach(c => { try { c.write(`data: ${msg}\n\n`); } catch(e) {} });
                        });
                        activeWatchers.set('main', watcher);
                        sendJson(res, { success: true, watching: resolvedPath });
                    } else if (req.url === '/api/backup') {
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                        const outFile = path.join(BACKUP_DIR, `config-backup-${timestamp}.zip`);
                        const output = fs.createWriteStream(outFile);
                        const archive = archiver('zip', { zlib: { level: 9 } });
                        archive.pipe(output);
                        archive.directory(CONFIG_DIR, 'config');
                        archive.finalize();
                        output.on('close', () => {
                            auditAction('backup_create', { file: path.basename(outFile) }, req);
                            sendJson(res, { success: true, file: path.basename(outFile), size: (archive.pointer() / 1024 / 1024).toFixed(2) + ' MB' });
                        });
                        archive.on('error', e => { sendError(res, e.message); });
                    } else if (req.url === '/api/rules') {
                        let { filename, content } = data;
                        if (!filename || content === undefined) { sendJson(res, { error: 'Missing filename or content' }, 400); return; }
                        filename = safeFilename(filename);
                        if (!filename.endsWith('.md')) filename += '.md';
                        fs.writeFileSync(safeJoin(RULES_DIR, filename), content);
                        syncBridgePlugin();
                        auditAction('rule_save', { filename }, req);
                        sendJson(res, { success: true });
                    } else if (req.url === '/api/agents') {
                        let { name, role, systemPrompt, color } = data;
                        if (!name) { sendJson(res, { error: 'Missing name' }, 400); return; }
                        name = safeFilename(name);
                        const filename = `${name}.json`;
                        fs.writeFileSync(safeJoin(AGENTS_DIR, filename), JSON.stringify({ name, role, systemPrompt, color }, null, 2));
                        syncBridgePlugin();
                        auditAction('agent_save', { name }, req);
                        sendJson(res, { success: true });
                    } else if (req.url === '/api/store/install') {
                        let { id, name, desc } = data;
                        if (!id || !/^[a-z0-9-]+$/.test(id)) { sendJson(res, { error: 'Invalid skill ID' }, 400); return; }
                        const filename = `SK-${id}.md`;
                        const content = `---\nname: ${String(name).replace(/[<>]/g, '')}\ndescription: ${String(desc).replace(/[<>]/g, '')}\n---\n# System Prompt\nYou are ${String(name).replace(/[<>]/g, '')}. ${String(desc).replace(/[<>]/g, '')}`;
                        fs.writeFileSync(safeJoin(STORE_DIR, filename), content);
                        auditAction('store_install', { id, name }, req);
                        sendJson(res, { success: true });
                    } else if (req.url === '/api/macros') {
                        let { name, content } = data;
                        if (!name) { sendJson(res, { error: 'Missing name' }, 400); return; }
                        name = safeFilename(name);
                        const filename = `SK-macro-${name}.md`;
                        const macroContent = `---\nname: macro-${name}\ndescription: Auto-generated macro for ${name}\n---\n\n${content || ''}`;
                        fs.writeFileSync(safeJoin(MACROS_DIR, filename), macroContent);
                        syncBridgePlugin();
                        auditAction('macro_save', { name }, req);
                        sendJson(res, { success: true });
                    } else if (req.url === '/api/memory') {
                        const { content } = data;
                        fs.writeFileSync(safeJoin(RULES_DIR, 'project_memory.md'), content || '');
                        syncBridgePlugin();
                        auditAction('memory_save', {}, req);
                        sendJson(res, { success: true });
                    } else if (req.url === '/api/system/volume') {
                        const { volume } = data;
                        try {
                            const vol = validateInt(volume, 0, 100);
                            const scriptPath = path.resolve(CONFIG_DIR, '..', 'antigravity', 'scratch', 'system-controller-mcp', 'set-volume.ps1');
                            if (!scriptPath.startsWith(CONFIG_DIR)) { sendJson(res, { error: 'Invalid script path' }, 500); return; }
                            execFile('powershell', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-volume', String(vol)], (err) => {
                                if (err) { sendError(res, 'Volume set failed'); return; }
                                auditAction('volume_set', { volume: vol }, req);
                                sendJson(res, { success: true });
                            });
                        } catch (e) { sendJson(res, { error: e.message }, 400); }
                    } else if (req.url === '/api/system/media') {
                        const { action } = data;
                        const validActions = { next: 176, previous: 177, play_pause: 179 };
                        const charCode = validActions[action];
                        if (charCode === undefined) { sendJson(res, { error: 'Invalid media action' }, 400); return; }
                        execFile('powershell', ['-Command', `(New-Object -ComObject WScript.Shell).SendKeys([char]${charCode})`], (err) => {
                            if (err) { sendError(res, 'Media control failed'); return; }
                            sendJson(res, { success: true });
                        });
                    } else if (req.url === '/api/system/organize') {
                        const { directory_path } = data;
                        const userDir = path.resolve(directory_path || '');
                        const allowedPrefix = (process.env.USERPROFILE || process.env.HOME || '').toLowerCase();
                        if (!userDir.toLowerCase().startsWith(allowedPrefix)) {
                            sendJson(res, { error: 'Directory not allowed. Must be under your user profile.' }, 403);
                            return;
                        }
                        if (!fs.existsSync(userDir)) { sendJson(res, { error: 'Directory not found' }, 400); return; }
                        organizeDirectoryHelper(userDir).then(result => {
                            auditAction('organize', { directory_path }, req);
                            sendJson(res, { success: true, result });
                        }).catch(err => {
                            sendError(res, err.message);
                        });
                    } else if (req.url === '/api/system/scrape') {
                        const { url, container_selector, fields, output_file_path, username, password } = data;
                        if (!url || !container_selector || !fields || !output_file_path) {
                            sendJson(res, { error: 'Missing required fields' }, 400); return;
                        }
                        try {
                            const parsed = new URL(url);
                            if (parsed.protocol !== 'https:') { sendJson(res, { error: 'Only HTTPS URLs allowed' }, 400); return; }
                            if (isPrivateIP(parsed.hostname)) { sendJson(res, { error: 'Cannot scrape private/internal URLs' }, 403); return; }
                            const outputDir = path.dirname(path.resolve(output_file_path));
                            const allowedPrefix = (process.env.USERPROFILE || process.env.HOME || '').toLowerCase();
                            if (!outputDir.toLowerCase().startsWith(allowedPrefix)) {
                                sendJson(res, { error: 'Output path must be under your user profile' }, 403);
                                return;
                            }
                        } catch (e) { sendJson(res, { error: 'Invalid URL' }, 400); return; }
                        scrapeWebpageHelper(url, container_selector, fields, output_file_path, username, password).then(result => {
                            auditAction('scrape', { url, count: result.count }, req);
                            sendJson(res, { success: true, result });
                        }).catch(err => {
                            sendError(res, err.message);
                        });
                    } else if (req.url === '/api/arena/start') {
                        const { topic, rounds } = data;
                        const config = getConfig();
                        const apiKey = config.geminiApiKey || '';
                        arena.start(topic, rounds, apiKey).then(() => {
                            sendJson(res, { success: true, phase: arena.phase });
                        }).catch(err => {
                            sendError(res, err.message);
                        });
                    } else if (req.url === '/api/arena/step') {
                        arena.step().then(() => {
                            sendJson(res, { success: true, phase: arena.phase });
                        }).catch(err => {
                            sendError(res, err.message);
                        });
                    } else if (req.url === '/api/arena/intervene') {
                        const { comment } = data;
                        arena.intervene(comment).then(() => {
                            sendJson(res, { success: true });
                        }).catch(err => {
                            sendError(res, err.message);
                        });
                    } else if (req.url === '/api/settings/config') {
                        const { apiKey, mcpServers, skillRegistryUrl } = data;
                        const existingConfig = getConfig();
                        if (apiKey !== undefined) existingConfig.geminiApiKey = apiKey || '';
                        if (mcpServers !== undefined) existingConfig.mcpServers = mcpServers;
                        if (skillRegistryUrl !== undefined) existingConfig.skillRegistryUrl = skillRegistryUrl;
                        saveConfig(existingConfig);
                        auditAction('settings_update', { keyUpdated: !!apiKey, mcpUpdated: !!mcpServers, registryUpdated: !!skillRegistryUrl }, req);
                        sendJson(res, { success: true });
                    } else if (req.url === '/api/skills/match') {
                        const { query } = data;
                        if (!query) { sendJson(res, { error: 'Missing query' }, 400); return; }
                        const skills = getSkillsEnhanced().filter(s => s.effective);
                        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
                        const results = skills.map(s => {
                            const descWords = (s.description || '').toLowerCase().split(/\s+/);
                            const nameWords = s.name.toLowerCase().split(/[-_\s]+/);
                            const allWords = [...new Set([...descWords, ...nameWords])].filter(w => w.length > 2);
                            const matches = queryWords.filter(q => allWords.some(a => a.includes(q) || q.includes(a)));
                            const score = queryWords.length > 0 ? Math.round((matches.length / queryWords.length) * 100) : 0;
                            return { skill: s.name, scope: s.scope, description: s.description, score };
                        });
                        results.sort((a, b) => b.score - a.score);
                        sendJson(res, results);
                    } else if (req.url.startsWith('/api/skills/') && req.url.endsWith('/sandbox')) {
                        const name = decodeURIComponent(req.url.split('/')[3]);
                        const { flag } = data;
                        const allowedFlags = ['--help', '--version', '--list'];
                        if (!allowedFlags.includes(flag)) { sendJson(res, { error: 'Flag not allowed. Use --help, --version, or --list' }, 400); return; }
                        const skills = getSkillsEnhanced();
                        const skill = skills.find(s => s.name === name);
                        if (!skill || !skill.skillDir) { sendJson(res, { error: 'Skill not found or has no script directory' }, 404); return; }
                        const scriptDir = path.join(skill.skillDir, 'scripts');
                        if (!fs.existsSync(scriptDir)) { sendJson(res, { error: 'No scripts directory for this skill' }, 404); return; }
                        const scripts = fs.readdirSync(scriptDir).filter(f => f.endsWith('.js') || f.endsWith('.py') || f.endsWith('.sh'));
                        if (scripts.length === 0) { sendJson(res, { error: 'No executable scripts found' }, 404); return; }
                        const scriptPath = path.join(scriptDir, scripts[0]);
                        const ext = path.extname(scriptPath);
                        const interpreter = ext === '.py' ? 'python' : ext === '.sh' ? 'bash' : 'node';
                        const { execFile } = require('child_process');
                        execFile(interpreter, [scriptPath, flag], { timeout: 5000 }, (err, stdout) => {
                            if (err && err.killed) { sendJson(res, { output: '[TIMEOUT] Script timed out after 5s' }); return; }
                            sendJson(res, { output: (stdout || 'No output') });
                        });
                    } else if (req.url === '/api/skills/tick') {
                        const { name } = data;
                        if (!name) { sendJson(res, { error: 'Missing skill name' }, 400); return; }
                        const usageFile = path.join(DATA_DIR, 'skill_usage.json');
                        let usage = {};
                        try { if (fs.existsSync(usageFile)) usage = JSON.parse(fs.readFileSync(usageFile, 'utf8')); } catch(e) {}
                        if (!usage[name]) usage[name] = { count: 0, firstTriggered: new Date().toISOString() };
                        usage[name].count++;
                        usage[name].lastTriggered = new Date().toISOString();
                        fs.writeFileSync(usageFile, JSON.stringify(usage, null, 2));
                        sendJson(res, { success: true });
                    } else {
                        res.writeHead(404); res.end();
                    }
                } catch (err) {
                    sendError(res, err.message);
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
                reloadTaskScheduler();
                auditAction('task_delete', { taskId }, req);
                sendJson(res, { success: true });
            } else if (req.url.startsWith('/api/backup/')) {
                const filename = safeFilename(decodeURIComponent(req.url.split('/api/backup/')[1]));
                const filePath = safeJoin(BACKUP_DIR, filename);
                try {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    auditAction('backup_delete', { filename }, req);
                    sendJson(res, { success: true });
                } catch(e) { sendError(res, e.message); }
            } else if (req.url.startsWith('/api/rules/')) {
                const filename = safeFilename(decodeURIComponent(req.url.split('/api/rules/')[1]));
                const filePath = safeJoin(RULES_DIR, filename);
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); syncBridgePlugin(); auditAction('rule_delete', { filename }, req); sendJson(res, { success: true }); } catch(e) { sendError(res, e.message); }
            } else if (req.url.startsWith('/api/agents/')) {
                const filename = safeFilename(decodeURIComponent(req.url.split('/api/agents/')[1]));
                const filePath = safeJoin(AGENTS_DIR, filename);
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); syncBridgePlugin(); auditAction('agent_delete', { filename }, req); sendJson(res, { success: true }); } catch(e) { sendError(res, e.message); }
            } else if (req.url.startsWith('/api/macros/')) {
                const filename = safeFilename(decodeURIComponent(req.url.split('/api/macros/')[1]));
                const filePath = safeJoin(MACROS_DIR, filename);
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); syncBridgePlugin(); auditAction('macro_delete', { filename }, req); sendJson(res, { success: true }); } catch(e) { sendError(res, e.message); }
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

// ── Real Task Scheduler ──────────────────────────────────────
const TASK_HISTORY_FILE = path.join(DATA_DIR, 'task_history.json');
function getTaskHistory() {
    try { return fs.existsSync(TASK_HISTORY_FILE) ? JSON.parse(fs.readFileSync(TASK_HISTORY_FILE, 'utf8')) : []; }
    catch (e) { return []; }
}
function appendTaskHistory(entry) {
    try {
        const history = getTaskHistory();
        history.push(entry);
        if (history.length > 1000) history.splice(0, history.length - 1000);
        fs.writeFileSync(TASK_HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (e) { console.error('[Scheduler] History write failed:', e.message); }
}

// Human-readable schedule to cron converter
function scheduleToCron(schedule) {
    const s = String(schedule).toLowerCase().trim();
    if (/^\d/.test(s) && s.includes(' ')) return s; // already cron
    if (s.includes('every') && s.includes('minute')) return '*/1 * * * *';
    if (s.includes('every') && s.includes('hour')) {
        const match = s.match(/(\d+)\s*hour/);
        return match ? `0 */${match[1]} * * *` : '0 * * * *';
    }
    if (s.includes('daily') || s.includes('every day')) return '0 0 * * *';
    if (s.includes('weekly') || s.includes('every week')) return '0 0 * * 0';
    if (s.includes('hourly')) return '0 * * * *';
    if (s.includes('30 min')) return '*/30 * * * *';
    if (s.includes('15 min')) return '*/15 * * * *';
    if (s.includes('5 min')) return '*/5 * * * *';
    // Default: every 5 minutes as fallback for unrecognized
    return '*/5 * * * *';
}

// A map of active cron jobs keyed by task ID
const activeTaskJobs = new Map();

function scheduleTask(task) {
    if (activeTaskJobs.has(task.id)) {
        activeTaskJobs.get(task.id).stop();
    }
    if (task.enabled === false) return;
    const cronExpr = scheduleToCron(task.schedule || '');
    if (!cron.validate(cronExpr)) {
        console.error(`[Scheduler] Invalid cron for task "${task.name}": ${cronExpr}`);
        return;
    }
    const job = cron.schedule(cronExpr, () => {
        console.log(`[Scheduler] Running task: ${task.name} (${task.command})`);
        execFile(process.platform === 'win32' ? 'cmd.exe' : 'sh', 
            [process.platform === 'win32' ? '/c' : '-c', task.command],
            { timeout: 30000, maxBuffer: 1024 * 1024 },
            (error, stdout, stderr) => {
                appendTaskHistory({
                    taskId: task.id,
                    taskName: task.name,
                    command: task.command,
                    timestamp: new Date().toISOString(),
                    exitCode: error ? error.code : 0,
                    stdout: (stdout || '').slice(0, 2000),
                    stderr: (stderr || '').slice(0, 2000),
                    error: error ? error.message : null
                });
                if (error) {
                    console.error(`[Scheduler] Task "${task.name}" failed:`, error.message);
                }
            });
    }, { scheduled: true });
    activeTaskJobs.set(task.id, job);
}

function reloadTaskScheduler() {
    // Stop all existing jobs
    for (const [id, job] of activeTaskJobs) {
        job.stop();
    }
    activeTaskJobs.clear();
    // Reload tasks from file
    const tasksData = readJsonFile('tasks.json');
    if (tasksData.tasks) {
        tasksData.tasks.forEach(t => scheduleTask(t));
    }
    console.log(`[Scheduler] Loaded ${activeTaskJobs.size} active task(s)`);
}

// Initial load and re-scan on a timer as a backup
reloadTaskScheduler();
setInterval(reloadTaskScheduler, 60000);

// GET endpoint for task history
// (added inside the request handler above at the /api/audit check)
// We'll mount it below since we can't easily edit inside the handler

const originalCronSetup = null; // not needed

server.listen(PORT, () => {
    console.log("Antigravity Central UI running at http://localhost:" + PORT);
});
