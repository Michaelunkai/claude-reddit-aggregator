require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const PostsDatabase = require('./db');

// Configuration
const PORT = process.env.PORT || 3000;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 300000; // 5 minutes default
const LOG_PATH = process.env.LOG_PATH || path.join(__dirname, 'logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_PATH)) {
    fs.mkdirSync(LOG_PATH, { recursive: true });
}

// Logging utility
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level,
        message,
        ...(data && { data })
    };

    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`;
    console.log(logLine);

    // Append to log file
    const logFile = path.join(LOG_PATH, 'server.log');
    fs.appendFileSync(logFile, logLine + '\n');

    return logEntry;
}

// Initialize database
const db = new PostsDatabase();

// OAuth token cache
let tokenCache = {
    token: null,
    expiresAt: 0
};

// Get Reddit OAuth token
async function getRedditToken() {
    if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
        return tokenCache.token;
    }

    const clientId = process.env.REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;

    if (!clientId || !clientSecret || clientId === 'your_client_id_here') {
        log('warn', 'Reddit API credentials not configured - using demo mode');
        return null;
    }

    try {
        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const response = await axios.post(
            'https://www.reddit.com/api/v1/access_token',
            'grant_type=client_credentials',
            {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': process.env.REDDIT_USER_AGENT || 'ClaudeRedditAggregator/1.0.0'
                },
                timeout: 10000
            }
        );

        tokenCache.token = response.data.access_token;
        tokenCache.expiresAt = Date.now() + (response.data.expires_in * 1000) - 60000; // Refresh 1 min early

        log('info', 'Reddit OAuth token obtained');
        return tokenCache.token;
    } catch (error) {
        log('error', 'Failed to get Reddit OAuth token', { error: error.message });
        return null;
    }
}

// All topic keywords for filtering generic subreddits
const TOPIC_KEYWORDS = [
    'claude', 'claude code', 'anthropic', 'ai coding', 'ai assistant',
    'openclaw', 'openclaw.ai', 'clawhub',
    'moltbot', 'moltbook',
    'clawdbot', 'clawd bot', 'clawd',
    'ai agent', 'mcp server', 'mcp protocol',
];

// Subreddits where ALL posts are included (no keyword filter)
const DEDICATED_SUBS = new Set(['claude', 'claudeai', 'claudedev', 'anthropicai', 'claudecode']);

// ── Hacker News ─────────────────────────────────────────────────────────────
async function fetchHackerNews() {
    const queries = [
        'claude anthropic', 'claude code', 'openclaw', 'moltbot', 'clawdbot',
        'anthropic AI', 'claude AI assistant', 'clawhub', 'anthropic model',
    ];
    const results = [];
    const seen = new Set();
    for (const q of queries) {
        try {
            const resp = await axios.get(
                `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=20&numericFilters=points>1`,
                { timeout: 10000 }
            );
            for (const hit of (resp.data.hits || [])) {
                if (!hit.objectID || seen.has(hit.objectID)) continue;
                seen.add(hit.objectID);
                results.push({
                    reddit_id: `hn_${hit.objectID}`,
                    title: hit.title || '(no title)',
                    content: (hit.story_text || '').replace(/<[^>]+>/g, '').substring(0, 600),
                    author: hit.author || 'unknown',
                    subreddit: 'HackerNews',
                    upvotes: hit.points || 0,
                    num_comments: hit.num_comments || 0,
                    created_at: new Date(hit.created_at).toISOString(),
                    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
                    source: 'hackernews',
                });
            }
            await new Promise(r => setTimeout(r, 300));
        } catch (e) { log('warn', `HN failed: ${q}`, { error: e.message }); }
    }
    log('info', `HN: fetched ${results.length} stories`);
    return results;
}

// ── GitHub ───────────────────────────────────────────────────────────────────
async function fetchGitHub() {
    // Search both repos AND issues/discussions for more coverage
    const repoQueries = ['openclaw', 'clawdbot', 'moltbot', 'claude-code anthropic', 'clawhub skills', 'anthropic claude sdk'];
    const results = [];
    const seen = new Set();
    const headers = {
        'User-Agent': 'ClaudeAggregator/2.0',
        'Accept': 'application/vnd.github.v3+json',
    };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;

    for (const q of repoQueries) {
        try {
            const resp = await axios.get(
                `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=10`,
                { headers, timeout: 10000 }
            );
            for (const repo of (resp.data.items || [])) {
                if (seen.has(`repo_${repo.id}`)) continue;
                seen.add(`repo_${repo.id}`);
                results.push({
                    reddit_id: `gh_${repo.id}`,
                    title: `${repo.full_name} — ${(repo.description || 'No description').substring(0, 100)}`,
                    content: (repo.description || '') + (repo.topics?.length ? '\nTopics: ' + repo.topics.join(', ') : '') + `\nStars: ${repo.stargazers_count} | Language: ${repo.language || 'N/A'}`,
                    author: repo.owner.login,
                    subreddit: 'GitHub',
                    upvotes: repo.stargazers_count,
                    num_comments: repo.open_issues_count,
                    created_at: repo.updated_at,
                    url: repo.html_url,
                    source: 'github',
                });
            }
            await new Promise(r => setTimeout(r, 400));
        } catch (e) { log('warn', `GitHub repos failed: ${q}`, { error: e.message }); }
    }
    log('info', `GitHub: fetched ${results.length} repos`);
    return results;
}

// ── Dev.to ───────────────────────────────────────────────────────────────────
async function fetchDevTo() {
    // Fetch by tag — all of these are directly relevant, no extra filtering needed
    const tagFetches = [
        { tag: 'claude',       relevant: true },
        { tag: 'anthropic',    relevant: true },
        { tag: 'claudeai',     relevant: true },
        { tag: 'claudecode',   relevant: true },
        { tag: 'aitools',      relevant: false }, // filter
        { tag: 'llm',          relevant: false }, // filter
        { tag: 'aiagents',     relevant: false }, // filter
        { tag: 'mcp',          relevant: false }, // filter
    ];
    const results = [];
    const seen = new Set();
    for (const { tag, relevant } of tagFetches) {
        try {
            const resp = await axios.get(
                `https://dev.to/api/articles?tag=${tag}&per_page=20&top=30`,
                { timeout: 10000, headers: { 'User-Agent': 'ClaudeAggregator/2.0', 'api-key': process.env.DEVTO_API_KEY || '' } }
            );
            for (const art of (resp.data || [])) {
                if (seen.has(art.id)) continue;
                if (!relevant) {
                    const text = ((art.title || '') + ' ' + (art.description || '')).toLowerCase();
                    if (!TOPIC_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) continue;
                }
                seen.add(art.id);
                results.push({
                    reddit_id: `devto_${art.id}`,
                    title: art.title,
                    content: art.description || '',
                    author: art.user?.username || 'unknown',
                    subreddit: 'DevTo',
                    upvotes: (art.positive_reactions_count || 0) + (art.public_reactions_count || 0),
                    num_comments: art.comments_count || 0,
                    created_at: art.published_at || new Date().toISOString(),
                    url: art.url,
                    source: 'devto',
                });
            }
            await new Promise(r => setTimeout(r, 300));
        } catch (e) { log('warn', `Dev.to failed: ${tag}`, { error: e.message }); }
    }
    log('info', `Dev.to: fetched ${results.length} articles`);
    return results;
}

// ── Anthropic Blog RSS ───────────────────────────────────────────────────────
async function fetchAnthropicBlog() {
    // Try multiple URLs in case one changes
    const feedUrls = [
        'https://www.anthropic.com/rss.xml',
        'https://www.anthropic.com/news/rss.xml',
    ];
    for (const feedUrl of feedUrls) {
        try {
            const resp = await axios.get(feedUrl, {
                timeout: 10000,
                headers: { 'User-Agent': 'ClaudeAggregator/2.0', 'Accept': 'application/rss+xml, application/xml, text/xml' },
            });
            const xml = resp.data;
            const items = (xml.match(/<item>([\s\S]*?)<\/item>/g) || []).slice(0, 20);
            if (items.length === 0) continue;
            const posts = items.map((item, idx) => {
                const getField = (re1, re2) => (item.match(re1) || item.match(re2) || [])[1] || '';
                const title = getField(/<title><!\[CDATA\[(.*?)\]\]>/, /<title>(.*?)<\/title>/) || 'Anthropic Update';
                const link  = getField(/<link>(.*?)<\/link>/, /<guid>(.*?)<\/guid>/) || 'https://www.anthropic.com/news';
                const desc  = getField(/<description><!\[CDATA\[(.*?)\]\]>/, /<description>(.*?)<\/description>/).replace(/<[^>]+>/g, '').substring(0, 600);
                const pub   = getField(/<pubDate>(.*?)<\/pubDate>/, /<dc:date>(.*?)<\/dc:date>/);
                return {
                    reddit_id: `anthropic_blog_${idx}`,
                    title,
                    content: desc,
                    author: 'Anthropic',
                    subreddit: 'AnthropicBlog',
                    upvotes: 9999,
                    num_comments: 0,
                    created_at: pub ? new Date(pub).toISOString() : new Date().toISOString(),
                    url: link.trim(),
                    source: 'anthropic',
                };
            });
            log('info', `Anthropic blog: fetched ${posts.length} posts from ${feedUrl}`);
            return posts;
        } catch (e) { log('warn', `Anthropic blog failed: ${feedUrl}`, { error: e.message }); }
    }
    // Fallback: scrape news page titles if RSS is down
    try {
        const resp = await axios.get('https://www.anthropic.com/news', { timeout: 10000, headers: { 'User-Agent': 'ClaudeAggregator/2.0' } });
        const titles = [...(resp.data.matchAll(/<h[23][^>]*>(.*?)<\/h[23]>/gs) || [])].slice(0, 10).map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
        log('info', `Anthropic blog fallback: scraped ${titles.length} titles`);
        return titles.map((title, idx) => ({
            reddit_id: `anthropic_news_${idx}`,
            title,
            content: 'Visit anthropic.com/news for the full article.',
            author: 'Anthropic',
            subreddit: 'AnthropicBlog',
            upvotes: 9990 - idx,
            num_comments: 0,
            created_at: new Date().toISOString(),
            url: 'https://www.anthropic.com/news',
            source: 'anthropic',
        }));
    } catch (e2) { log('warn', 'Anthropic fallback also failed', { error: e2.message }); return []; }
}

// ── Curated official resource cards ─────────────────────────────────────────
function getCuratedResources() {
    const now = new Date().toISOString();
    return [
        { reddit_id: 'oc_site',      title: '[OpenClaw] Official Website – openclaw.ai',           content: 'OpenClaw is a personal AI assistant platform running Claude at home. Supports Telegram, WhatsApp, Discord. Skill system, marathon mode, local extensions.',            author: 'openclaw',   subreddit: 'OpenClaw',    upvotes: 9999, num_comments: 0, created_at: now, url: 'https://openclaw.ai',                                     source: 'openclaw'  },
        { reddit_id: 'oc_docs',      title: '[OpenClaw] Documentation & Guides',                    content: 'Complete OpenClaw docs: setup, skills, config, marathon mode, Android control, Telegram/WhatsApp integration.',                                                      author: 'openclaw',   subreddit: 'OpenClaw',    upvotes: 9998, num_comments: 0, created_at: now, url: 'https://docs.openclaw.ai',                                source: 'openclaw'  },
        { reddit_id: 'oc_clawhub',   title: '[ClawHub] OpenClaw Skills Marketplace – clawhub.ai',  content: 'Browse hundreds of OpenClaw skills: research, debugging, stock prices, news, and more.',                                                                              author: 'openclaw',   subreddit: 'ClawHub',     upvotes: 9997, num_comments: 0, created_at: now, url: 'https://clawhub.ai',                                      source: 'openclaw'  },
        { reddit_id: 'oc_discord',   title: '[OpenClaw] Community Discord Server',                  content: 'Join the OpenClaw Discord: help, skills, features, connect with other users.',                                                                                       author: 'openclaw',   subreddit: 'OpenClaw',    upvotes: 9996, num_comments: 0, created_at: now, url: 'https://discord.com/invite/clawd',                          source: 'openclaw'  },
        { reddit_id: 'moltbot_site', title: '[MoltBot] Official MoltBook – AI Discord Bot',         content: 'MoltBot is an AI-powered Discord bot built on Claude. Create and deploy custom bots in your server via moltbook.com.',                                               author: 'moltbot',    subreddit: 'MoltBot',     upvotes: 9995, num_comments: 0, created_at: now, url: 'https://moltbook.com',                                     source: 'moltbot'   },
        { reddit_id: 'clawd_site',   title: '[ClawdBot] Claude-powered Telegram & WhatsApp Bot',    content: 'ClawdBot delivers Claude AI directly in Telegram and WhatsApp with full skill support and real-time notifications.',                                                  author: 'openclaw',   subreddit: 'ClawdBot',    upvotes: 9994, num_comments: 0, created_at: now, url: 'https://openclaw.ai',                                     source: 'clawdbot'  },
        { reddit_id: 'cc_docs',      title: '[Claude Code] Official Claude Code Documentation',     content: "Anthropic's official CLI for Claude. Install, CLAUDE.md optimisation, tool use, memory, best practices.",                                                            author: 'anthropic',  subreddit: 'ClaudeCode',  upvotes: 9993, num_comments: 0, created_at: now, url: 'https://docs.anthropic.com/en/docs/claude-code',           source: 'anthropic' },
        { reddit_id: 'api_docs',     title: '[Anthropic] Claude API Documentation',                 content: 'All Claude models, messages API, tool use, vision, streaming, system prompts, rate limits, Python/TypeScript SDKs.',                                                 author: 'anthropic',  subreddit: 'AnthropicBlog', upvotes: 9992, num_comments: 0, created_at: now, url: 'https://docs.anthropic.com',                            source: 'anthropic' },
    ];
}

// Fetch posts from a subreddit with retry logic
async function fetchSubredditPosts(subreddit, token, retries = 3) {
    const startTime = Date.now();
    const keywords = TOPIC_KEYWORDS;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const headers = {
                'User-Agent': process.env.REDDIT_USER_AGENT || 'ClaudeRedditAggregator/1.0.0'
            };

            let url;
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
                url = `https://oauth.reddit.com/r/${subreddit}/new?limit=100`;
            } else {
                // Use public API if no token
                url = `https://www.reddit.com/r/${subreddit}/new.json?limit=100`;
            }

            const response = await axios.get(url, {
                headers,
                timeout: 10000
            });

            const data = token ? response.data : response.data;
            const posts = data.data.children.map(child => child.data);

            // Filter posts from last 30 days containing Claude-related keywords
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            const filteredPosts = posts.filter(post => {
                const postTime = post.created_utc * 1000;
                if (postTime < thirtyDaysAgo) return false;

                const titleLower = post.title.toLowerCase();
                const bodyLower = (post.selftext || '').toLowerCase();
                const hasKeyword = keywords.some(kw =>
                    titleLower.includes(kw.toLowerCase()) ||
                    bodyLower.includes(kw.toLowerCase())
                );

                // For dedicated subreddits, include all posts
                if (DEDICATED_SUBS.has(subreddit.toLowerCase())) {
                    return true;
                }

                return hasKeyword;
            });

            const duration = Date.now() - startTime;
            log('info', `Fetched posts from r/${subreddit}`, {
                total: posts.length,
                filtered: filteredPosts.length,
                duration: `${duration}ms`
            });

            return filteredPosts.map(post => ({
                reddit_id: post.id,
                title: post.title,
                content: post.selftext ? post.selftext.substring(0, 1000) : '',
                author: post.author,
                subreddit: post.subreddit,
                upvotes: post.score,
                num_comments: post.num_comments,
                created_at: new Date(post.created_utc * 1000).toISOString(),
                url: `https://reddit.com${post.permalink}`,
                source: 'reddit',
            }));

        } catch (error) {
            const delay = Math.pow(3, attempt) * 1000; // Exponential backoff: 3s, 9s, 27s
            log('warn', `Attempt ${attempt}/${retries} failed for r/${subreddit}`, {
                error: error.message,
                retryIn: `${delay / 1000}s`
            });

            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                log('error', `All retries failed for r/${subreddit}`, { error: error.message });
                return [];
            }
        }
    }
    return [];
}

// Track whether a fetch is already running (prevent concurrent fetches)
let fetchInProgress = false;

// Fetch posts from all sources (Reddit + HN + GitHub + Dev.to + Anthropic Blog + curated)
async function fetchAllPosts() {
    if (fetchInProgress) {
        log('info', 'Fetch already in progress, skipping');
        return db.getPosts({ page: 1, limit: 500, daysBack: 30 }).posts || [];
    }
    fetchInProgress = true;
    try {

    const subreddits = [
        // Claude / Anthropic dedicated — all posts included
        'ClaudeAI', 'claude', 'claudedev', 'AnthropicAI', 'ClaudeCode',
        // AI coding tools
        'AICoding', 'vibecoding', 'cursor_ai', 'AIdev', 'ArtificialIntelligence',
        'GPT4', 'Bing', 'perplexity_ai', 'aipromptprogramming',
        // AI agents / MCP
        'AIAgents', 'PromptEngineering', 'LangChain', 'AutoGPT',
        // General AI
        'OpenAI', 'MachineLearning', 'LocalLLaMA', 'artificial', 'singularity',
        'ChatGPT', 'Bard', 'learnmachinelearning', 'deeplearning',
        // Tech / Dev
        'programming', 'webdev', 'learnprogramming', 'compsci', 'technology',
        // Discord / bots
        'discordapp', 'Discord_Bots',
    ];
    const token = await getRedditToken();

    log('info', 'Starting multi-source fetch', { subreddits: subreddits.length });

    // Staggered Reddit fetches (800ms apart) run in parallel with other sources
    const redditPromises = subreddits.map((sub, i) =>
        new Promise(resolve => setTimeout(async () => resolve(await fetchSubredditPosts(sub, token)), i * 800))
    );

    const [hn, gh, devto, blog, curated, ...redditResults] = await Promise.all([
        fetchHackerNews(),
        fetchGitHub(),
        fetchDevTo(),
        fetchAnthropicBlog(),
        Promise.resolve(getCuratedResources()),
        ...redditPromises,
    ]);

    const allPosts = [...curated, ...blog, ...hn, ...gh, ...devto, ...redditResults.flat()];

    // Deduplicate by reddit_id
    const seen = new Set();
    const uniquePosts = allPosts.filter(p => { if (seen.has(p.reddit_id)) return false; seen.add(p.reddit_id); return true; });

    if (uniquePosts.length > 0) {
        db.upsertPosts(uniquePosts);
        log('info', `Saved ${uniquePosts.length} unique posts`, {
            reddit: redditResults.flat().length, hn: hn.length,
            github: gh.length, devto: devto.length,
            anthropic: blog.length, curated: curated.length,
        });
    }

    return uniquePosts;
    } catch(err) {
        log('error', 'fetchAllPosts error', { error: err.message });
        return [];
    } finally {
        fetchInProgress = false;
    }
}

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Socket.IO setup
const io = new Server(server, {
    cors: {
        origin: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'],
        methods: ['GET', 'POST']
    }
});

// Middleware
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        log('info', `${req.method} ${req.url}`, {
            status: res.statusCode,
            duration: `${Date.now() - start}ms`
        });
    });
    next();
});

// Posts cache
let postsCache = {
    data: null,
    timestamp: 0,
    ttl: 5 * 60 * 1000 // 5 minutes
};

// API Routes
app.get('/api/posts', async (req, res) => {
    try {
        const {
            search = '',
            subreddit = '',
            sortBy = 'created_at',
            sortOrder = 'desc',
            page = 1,
            limit = 20,
            minUpvotes = 0
        } = req.query;

        const result = db.getPosts({
            search,
            subreddit,
            sortBy,
            sortOrder: sortOrder.toLowerCase(),
            page: parseInt(page),
            limit: Math.min(parseInt(limit), 100), // Max 100 per page
            minUpvotes: parseInt(minUpvotes),
            daysBack: 30
        });

        res.json({
            success: true,
            ...result,
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
        log('error', 'Error fetching posts', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to fetch posts',
            message: error.message
        });
    }
});

app.get('/api/stats', (req, res) => {
    try {
        const stats = db.getStats();
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        log('error', 'Error fetching stats', { error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to fetch stats'
        });
    }
});

app.post('/api/refresh', async (req, res) => {
    try {
        log('info', 'Manual refresh triggered');
        // Respond immediately so UI doesn't wait
        res.json({ success: true, message: 'Refresh started' });
        // Fetch in background — UI gets posts-updated event when done
        fetchAllPosts().then(posts => {
            io.emit('posts-updated', { count: posts.length, timestamp: new Date().toISOString() });
        }).catch(err => log('error', 'Background refresh error', { error: err.message }));
    } catch (error) {
        log('error', 'Error during manual refresh', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to refresh posts' });
    }
});

app.get('/api/sources', (req, res) => {
    res.json({ sources: [
        { id: 'reddit',     name: 'Reddit',         icon: '🔴' },
        { id: 'hackernews', name: 'Hacker News',    icon: '🟠' },
        { id: 'github',     name: 'GitHub',         icon: '⚫' },
        { id: 'devto',      name: 'Dev.to',         icon: '🟣' },
        { id: 'anthropic',  name: 'Anthropic Blog', icon: '🔵' },
        { id: 'openclaw',   name: 'OpenClaw',       icon: '🦅' },
        { id: 'moltbot',    name: 'MoltBot',        icon: '🤖' },
        { id: 'clawdbot',   name: 'ClawdBot',       icon: '📱' },
    ]});
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Serve React app for all other routes (Express v5 syntax)
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO connection handling
let connectedClients = 0;

io.on('connection', (socket) => {
    connectedClients++;
    log('info', 'Client connected', { clientId: socket.id, totalClients: connectedClients });

    // Send current stats on connection
    socket.emit('stats', db.getStats());

    socket.on('disconnect', () => {
        connectedClients--;
        log('info', 'Client disconnected', { clientId: socket.id, totalClients: connectedClients });
    });

    socket.on('request-refresh', async () => {
        log('info', 'Client requested refresh', { clientId: socket.id });
        const posts = await fetchAllPosts();
        io.emit('posts-updated', {
            count: posts.length,
            timestamp: new Date().toISOString()
        });
    });
});

// Periodic polling
let pollInterval;

async function startPolling() {
    log('info', `Starting polling with interval ${POLL_INTERVAL / 1000}s`);

    // Initial fetch
    await fetchAllPosts();

    // Create backup after initial fetch
    db.backup();

    // Set up interval — non-blocking background fetch
    pollInterval = setInterval(() => {
        fetchAllPosts()
            .then(posts => {
                io.emit('posts-updated', { count: posts.length, timestamp: new Date().toISOString() });
            })
            .catch(error => log('error', 'Polling error', { error: error.message }));
    }, POLL_INTERVAL);
}

// Daily backup scheduler
function scheduleDailyBackup() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    setTimeout(() => {
        db.backup();
        generateDailyReport();
        // Schedule next backup
        setInterval(() => {
            db.backup();
            generateDailyReport();
        }, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);

    log('info', `Daily backup scheduled for ${tomorrow.toISOString()}`);
}

// Generate daily report
function generateDailyReport() {
    const date = new Date().toISOString().split('T')[0];
    const stats = db.getStats();

    const report = {
        date,
        generatedAt: new Date().toISOString(),
        stats,
        connectedClients,
        uptime: process.uptime()
    };

    const reportFile = path.join(LOG_PATH, `daily-report-${date}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

    log('info', 'Daily report generated', { file: reportFile });
}

// Graceful shutdown
function gracefulShutdown() {
    log('info', 'Shutting down gracefully...');

    if (pollInterval) {
        clearInterval(pollInterval);
    }

    io.close(() => {
        log('info', 'Socket.IO connections closed');
    });

    server.close(() => {
        log('info', 'HTTP server closed');
        process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
        log('warn', 'Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
server.listen(PORT, () => {
    log('info', `Server started on http://localhost:${PORT}`);
    log('info', `Environment: ${process.env.NODE_ENV || 'development'}`);

    // Start polling and scheduling
    startPolling();
    scheduleDailyBackup();
});

module.exports = { app, server, io };
