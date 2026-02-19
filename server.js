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

// Rotating User-Agents to avoid Reddit rate limiting
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];
let uaIndex = 0;
function getUA() { return USER_AGENTS[uaIndex++ % USER_AGENTS.length]; }

// Reddit hosts in preference order (old.reddit.com = no redirect, same JSON API)
const REDDIT_HOSTS = ['old.reddit.com', 'www.reddit.com', 'reddit.com'];

// Reddit request helper — tries multiple hostnames + retry/backoff
async function redditGet(url, retries = 2) {
    // Try each host variant
    for (const host of REDDIT_HOSTS) {
        const targetUrl = url.replace(/^https?:\/\/[^/]+/, `https://${host}`);
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const resp = await axios.get(targetUrl, {
                    timeout: 15000,
                    maxRedirects: 5,
                    headers: {
                        'User-Agent': getUA(),
                        'Accept': 'application/json',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Cache-Control': 'no-cache',
                    },
                });
                return resp.data;
            } catch (err) {
                // DNS failure = try next host immediately
                if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') break;
                if (attempt === retries) break;
                await new Promise(r => setTimeout(r, attempt * 1500));
            }
        }
    }
    throw new Error(`All Reddit hosts failed for: ${url.substring(0, 80)}`);
}

// STRICT 7-day window for all sources
const DAYS_WINDOW = 7;
const MS_WINDOW = DAYS_WINDOW * 24 * 60 * 60 * 1000;

// STRICT topic keywords — must match at least one to be included
// These are specific enough that a match = relevance
const TOPIC_KEYWORDS = [
    // Claude / Anthropic (primary targets)
    'claude', 'anthropic', 'claude code', 'claude-code', 'claudeai',
    'sonnet 3.5', 'sonnet 4', 'opus 4', 'haiku 3', 'claude 3', 'claude 4',
    // OpenClaw ecosystem
    'openclaw', 'clawhub', 'moltbot', 'moltbook', 'clawdbot',
    // AI coding tools (specific names only)
    'cursor ai', 'windsurf ai', 'codeium', 'github copilot',
    'aider', 'continue.dev', 'cody ai',
    // MCP specifically
    'mcp server', 'model context protocol', 'mcp protocol',
];

// Subreddits dedicated to Claude/Anthropic — still filter by recency but include all relevant posts
const DEDICATED_SUBS = new Set([
    'claudeai', 'claude', 'claudedev', 'anthropicai', 'claudecode',
]);

// ── Hacker News ─────────────────────────────────────────────────────────────
async function fetchHackerNews() {
    const queries = [
        'claude anthropic', 'claude code', 'anthropic',
        'openclaw', 'moltbot', 'clawdbot', 'clawhub',
        'anthropic sonnet', 'anthropic opus',
        'MCP model context protocol', 'ai coding assistant',
    ];
    const results = [];
    const seen = new Set();
    // STRICT 7-day window
    const cutoffSec = Math.floor((Date.now() - MS_WINDOW) / 1000);
    for (const q of queries) {
        try {
            const resp = await axios.get(
                `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=20&numericFilters=created_at_i>${cutoffSec}`,
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
    // Focus on repos updated in last 7 days with relevant topics
    const cutoffDate = new Date(Date.now() - MS_WINDOW).toISOString().split('T')[0];
    const repoQueries = [
        `openclaw pushed:>${cutoffDate}`,
        `claude-code pushed:>${cutoffDate}`,
        `mcp-server pushed:>${cutoffDate}`,
        `anthropic pushed:>${cutoffDate}`,
        `ai-coding-assistant pushed:>${cutoffDate}`,
    ];
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
                `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=15`,
                { headers, timeout: 10000 }
            );
            for (const repo of (resp.data.items || [])) {
                if (seen.has(`repo_${repo.id}`)) continue;
                // Skip if not updated within window
                const updatedAt = new Date(repo.pushed_at || repo.updated_at);
                if (updatedAt < new Date(Date.now() - MS_WINDOW)) continue;
                
                seen.add(`repo_${repo.id}`);
                results.push({
                    reddit_id: `gh_${repo.id}`,
                    title: `${repo.full_name} — ${(repo.description || 'No description').substring(0, 100)}`,
                    content: (repo.description || '') + (repo.topics?.length ? '\nTopics: ' + repo.topics.join(', ') : '') + `\nStars: ${repo.stargazers_count} | Language: ${repo.language || 'N/A'}`,
                    author: repo.owner.login,
                    subreddit: 'GitHub',
                    upvotes: repo.stargazers_count,
                    num_comments: repo.open_issues_count,
                    created_at: repo.pushed_at || repo.updated_at, // Use actual push date
                    url: repo.html_url,
                    source: 'github',
                });
            }
            await new Promise(r => setTimeout(r, 500));
        } catch (e) { log('warn', `GitHub repos failed: ${q}`, { error: e.message }); }
    }
    log('info', `GitHub: fetched ${results.length} repos (7-day window)`);
    return results;
}

// ── Dev.to ───────────────────────────────────────────────────────────────────
async function fetchDevTo() {
    // Only relevant tags, filter by 7-day window
    const tags = ['claude', 'anthropic', 'claudeai', 'claudecode', 'mcp', 'aiagents', 'aicoding'];
    const results = [];
    const seen = new Set();
    const cutoff = Date.now() - MS_WINDOW;
    
    for (const tag of tags) {
        try {
            // Use top=7 for last 7 days
            const resp = await axios.get(
                `https://dev.to/api/articles?tag=${tag}&per_page=25&top=7`,
                { timeout: 10000, headers: { 'User-Agent': 'ClaudeAggregator/2.0' } }
            );
            for (const art of (resp.data || [])) {
                if (seen.has(art.id)) continue;
                
                // Check date
                const pubDate = new Date(art.published_at || 0);
                if (pubDate.getTime() < cutoff) continue;
                
                // Must match keywords
                const text = ((art.title || '') + ' ' + (art.description || '')).toLowerCase();
                if (!TOPIC_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) continue;
                
                seen.add(art.id);
                results.push({
                    reddit_id: `devto_${art.id}`,
                    title: art.title,
                    content: art.description || '',
                    author: art.user?.username || 'unknown',
                    subreddit: 'DevTo',
                    upvotes: (art.positive_reactions_count || 0) + (art.public_reactions_count || 0),
                    num_comments: art.comments_count || 0,
                    created_at: art.published_at,
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

// ── Anthropic Blog (scraper — no RSS available) ──────────────────────────────
async function fetchAnthropicBlog() {
    try {
        const resp = await axios.get('https://www.anthropic.com/news', {
            timeout: 12000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        });
        const html = resp.data;

        // Extract article slugs (unique, skip bare /news)
        const slugMatches = [...new Set(
            [...html.matchAll(/href="(\/news\/[^"#?]+)"/g)].map(m => m[1])
        )].filter(s => s.length > 8 && s !== '/news').slice(0, 25);

        if (slugMatches.length === 0) {
            log('warn', 'Anthropic scraper: no slugs found');
            return [];
        }

        // Fetch top 8 article pages in parallel to get real human dates ("Feb 17, 2026")
        const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
        const fetchedDates = {};
        await Promise.all(
            slugMatches.slice(0, 8).map(async (slug) => {
                try {
                    const ar = await axios.get('https://www.anthropic.com' + slug, {
                        timeout: 8000,
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                    });
                    // Pattern: "Feb 17, 2026" or "February 17, 2026"
                    const m = ar.data.match(/([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),\s+(\d{4})/);
                    if (m) {
                        const monthNum = MONTHS[m[1].substring(0, 3)];
                        if (monthNum !== undefined) {
                            const d = new Date(parseInt(m[3]), monthNum, parseInt(m[2]));
                            fetchedDates[slug] = d.toISOString();
                        }
                    }
                } catch (_) {}
            })
        );

        // Only include articles with REAL dates that are within 7-day window
        const cutoff = Date.now() - MS_WINDOW;
        const posts = [];
        
        for (const slug of slugMatches) {
            const realDate = fetchedDates[slug];
            if (!realDate) continue; // Skip if we couldn't get real date
            
            const dateMs = new Date(realDate).getTime();
            if (dateMs < cutoff) continue; // Skip if older than 7 days
            
            const title = slug.replace('/news/', '').replace(/-/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());
            
            posts.push({
                reddit_id: 'anthropic_' + slug.replace('/news/', '').replace(/[^a-z0-9]/gi, '_'),
                title,
                content: 'Official Anthropic announcement. Visit anthropic.com/news for full details.',
                author: 'Anthropic',
                subreddit: 'AnthropicBlog',
                upvotes: 1000,
                num_comments: 0,
                created_at: realDate,
                url: 'https://www.anthropic.com' + slug,
                source: 'anthropic',
            });
        }

        log('info', `Anthropic blog: ${posts.length} articles within 7-day window`);
        return posts;
    } catch (e) {
        log('warn', 'Anthropic blog scrape failed', { error: e.message });
        return [];
    }
}

// ── Curated resources removed — only real-time posts from actual sources ──
function getCuratedResources() {
    // No static curated content — everything must be recent and real
    return [];
}

// Convert a Reddit post object to our standard format
function normalizeRedditPost(post) {
    return {
        reddit_id: post.id || post.name,
        title: post.title,
        content: (post.selftext || '').substring(0, 1000),
        author: post.author || 'unknown',
        subreddit: post.subreddit || post.subreddit_name_prefixed?.replace('r/', '') || 'reddit',
        upvotes: post.score || post.ups || 0,
        num_comments: post.num_comments || 0,
        created_at: new Date((post.created_utc || post.created || Date.now() / 1000) * 1000).toISOString(),
        url: post.permalink ? `https://reddit.com${post.permalink}` : (post.url || ''),
        source: 'reddit',
    };
}

// Strategy 1: Multireddit — fetch multiple subs in one request (no auth needed)
async function fetchMultiSub(subs) {
    const combined = subs.join('+');
    const url = `https://old.reddit.com/r/${combined}/new.json?limit=100&raw_json=1`;
    try {
        const data = await redditGet(url);
        const posts = (data?.data?.children || []).map(c => c.data);
        log('info', `Multireddit [${subs.slice(0,3).join(',')}...]: ${posts.length} posts`);
        return posts;
    } catch (e) {
        log('warn', `Multireddit failed [${subs[0]}...]`, { error: e.message });
        return [];
    }
}

// Strategy 2: Reddit global search by keyword (no auth, searches all of Reddit)
async function fetchRedditSearch(query, timeFilter = 'week') {
    const url = `https://old.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&t=${timeFilter}&limit=25&raw_json=1`;
    try {
        const data = await redditGet(url);
        const posts = (data?.data?.children || []).map(c => c.data);
        log('info', `Reddit search "${query}": ${posts.length} posts`);
        return posts;
    } catch (e) {
        log('warn', `Reddit search failed "${query}"`, { error: e.message });
        return [];
    }
}

// Strategy 3: PullPush.io (free Pushshift-compatible API, no auth needed)
async function fetchPullPush(query) {
    try {
        const url = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(query)}&size=25&sort=desc&sort_type=created_utc`;
        const resp = await axios.get(url, { timeout: 12000, headers: { 'User-Agent': getUA(), 'Accept': 'application/json' } });
        const posts = (resp.data?.data || []);
        if (!posts.length) return [];
        log('info', `PullPush "${query}": ${posts.length} posts`);
        return posts.map(p => ({
            reddit_id: p.id,
            title: p.title || '(no title)',
            content: (p.selftext || '').substring(0, 1000),
            author: p.author || 'unknown',
            subreddit: p.subreddit || 'reddit',
            upvotes: p.score || 0,
            num_comments: p.num_comments || 0,
            created_at: new Date((p.created_utc || Date.now() / 1000) * 1000).toISOString(),
            url: p.permalink ? `https://reddit.com${p.permalink}` : `https://reddit.com/r/${p.subreddit}/comments/${p.id}`,
            source: 'reddit',
        }));
    } catch (e) {
        log('warn', `PullPush failed "${query}"`, { error: e.message });
        return [];
    }
}

// Main Reddit fetch — no credentials needed, uses multiple strategies
// STRICT 7-day window, keyword filtering on everything
async function fetchAllRedditPosts() {
    const results = [];
    const seen = new Set();
    const cutoff7d = Date.now() - MS_WINDOW;

    function addPosts(rawPosts, isDedicated = false) {
        if (!Array.isArray(rawPosts)) return;
        for (const post of rawPosts) {
            try {
                if (!post || (!post.id && !post.name)) continue;
                const id = post.id || post.name;
                if (seen.has(id)) continue;

                // STRICT 7-day check for ALL posts
                const postTime = (post.created_utc || post.created || 0) * 1000;
                if (postTime < cutoff7d) continue;

                // Keyword filter — even dedicated subs get filtered (just less strict)
                const text = ((post.title || '') + ' ' + (post.selftext || '')).toLowerCase();
                if (!isDedicated && !TOPIC_KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) continue;

                seen.add(id);
                results.push(normalizeRedditPost(post));
            } catch (e) { /* skip bad post */ }
        }
    }

    // ── Strategy A: Claude/Anthropic dedicated subs ──
    try {
        const dedicatedSubs = ['ClaudeAI', 'claude', 'claudedev', 'AnthropicAI', 'ClaudeCode'];
        for (const sub of dedicatedSubs) {
            try {
                const posts = await fetchMultiSub([sub]);
                addPosts(posts, true); // dedicated = less strict keyword filter
            } catch (e) { log('warn', `Strategy A failed: r/${sub}`, { error: e.message }); }
            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (e) { log('warn', 'Strategy A failed entirely', { error: e.message }); }

    // ── Strategy B: AI coding/tools subs with strict keyword filter ──
    try {
        const topicSubs = ['vibecoding', 'cursor', 'mcp'];
        for (const sub of topicSubs) {
            try {
                const posts = await fetchMultiSub([sub]);
                addPosts(posts, false); // strict keyword filter
            } catch (e) { log('warn', `Strategy B failed: r/${sub}`, { error: e.message }); }
            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (e) { log('warn', 'Strategy B failed entirely', { error: e.message }); }

    // ── Strategy C: Reddit global keyword search (last 7 days) ──
    try {
        const searchQueries = [
            '"claude code"',      // exact phrase
            '"openclaw"',
            '"anthropic" claude',
            '"mcp server"',
            'claude sonnet opus',
        ];

        for (const q of searchQueries) {
            try {
                const posts = await fetchRedditSearch(q, 'week');
                addPosts(posts, false);
            } catch (e) { log('warn', `Strategy C search failed: "${q}"`, { error: e.message }); }
            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (e) { log('warn', 'Strategy C failed entirely', { error: e.message }); }

    // ── Strategy D: PullPush.io (7-day cutoff applied in addPosts) ──
    try {
        const pullpushQueries = ['claude anthropic', 'openclaw', 'claude code'];
        for (const q of pullpushQueries) {
            try {
                const posts = await fetchPullPush(q);
                // PullPush returns normalized posts, need to filter by date
                for (const p of posts) {
                    if (!p || seen.has(p.reddit_id)) continue;
                    const postTime = new Date(p.created_at).getTime();
                    if (postTime < cutoff7d) continue;
                    seen.add(p.reddit_id);
                    results.push(p);
                }
            } catch (e) { log('warn', `Strategy D PullPush failed: "${q}"`, { error: e.message }); }
            await new Promise(r => setTimeout(r, 800));
        }
    } catch (e) { log('warn', 'Strategy D failed entirely', { error: e.message }); }

    log('info', `Reddit total: ${results.length} unique posts from all strategies`);
    return results;
}

// Track whether a fetch is already running (prevent concurrent fetches)
let fetchInProgress = false;

// Fetch posts from all sources (Reddit + HN + GitHub + Dev.to + Anthropic Blog + curated)
async function fetchAllPosts() {
    if (fetchInProgress) {
        log('info', 'Fetch already in progress, skipping');
        return db.getPosts({ page: 1, limit: 500, daysBack: 90 }).posts || [];
    }
    fetchInProgress = true;
    try {

    log('info', 'Starting multi-source fetch (no-auth Reddit strategies)');
    lastFetchStatus.inProgress = true;
    lastFetchStatus.lastAttempt = new Date().toISOString();

    // Run all sources in parallel — each wrapped so one failure doesn't kill others
    const [hn, gh, devto, blog, curated, reddit] = await Promise.all([
        fetchHackerNews().catch(e => { log('error', 'HN fetch failed', { error: e.message }); return []; }),
        fetchGitHub().catch(e => { log('error', 'GitHub fetch failed', { error: e.message }); return []; }),
        fetchDevTo().catch(e => { log('error', 'DevTo fetch failed', { error: e.message }); return []; }),
        fetchAnthropicBlog().catch(e => { log('error', 'Anthropic fetch failed', { error: e.message }); return []; }),
        Promise.resolve(getCuratedResources()),
        fetchAllRedditPosts().catch(e => { log('error', 'Reddit fetch failed', { error: e.message }); return []; }),
    ]);

    lastFetchStatus.sourceCounts = { reddit: reddit.length, hn: hn.length, gh: gh.length, devto: devto.length, anthropic: blog.length };
    
    const allPosts = [...curated, ...blog, ...hn, ...gh, ...devto, ...reddit];

    // Deduplicate by reddit_id
    const seen = new Set();
    const uniquePosts = allPosts.filter(p => { if (seen.has(p.reddit_id)) return false; seen.add(p.reddit_id); return true; });

    if (uniquePosts.length > 0) {
        db.upsertPosts(uniquePosts);
        log('info', `Saved ${uniquePosts.length} unique posts`, {
            reddit: reddit.length, hn: hn.length,
            github: gh.length, devto: devto.length,
            anthropic: blog.length, curated: curated.length,
        });
    }

    lastFetchStatus.lastSuccess = new Date().toISOString();
    lastFetchStatus.lastError = null;
    return uniquePosts;
    } catch(err) {
        log('error', 'fetchAllPosts error', { error: err.message });
        lastFetchStatus.lastError = err.message;
        return [];
    } finally {
        fetchInProgress = false;
        lastFetchStatus.inProgress = false;
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
            source = '',  // NEW: filter by source (reddit, github, hackernews, etc.)
            sortBy = 'created_at',
            sortOrder = 'desc',
            page = 1,
            limit = 20,
            minUpvotes = 0
        } = req.query;

        const result = db.getPosts({
            search,
            subreddit,
            source,  // NEW: pass source filter to db
            sortBy,
            sortOrder: sortOrder.toLowerCase(),
            page: parseInt(page),
            limit: Math.min(parseInt(limit), 100),
            minUpvotes: parseInt(minUpvotes),
            daysBack: 7  // STRICT 7-day window
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

// Track fetch status
let lastFetchStatus = {
    inProgress: false,
    lastAttempt: null,
    lastSuccess: null,
    lastError: null,
    sourceCounts: {},
};

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        fetchInProgress: lastFetchStatus.inProgress,
        lastFetchSuccess: lastFetchStatus.lastSuccess,
    });
});

// Debug endpoint to see fetch status
app.get('/api/debug/fetch-status', (req, res) => {
    res.json({
        success: true,
        fetchStatus: lastFetchStatus,
        dbPostCount: db.posts?.length || 0,
        timestamp: new Date().toISOString()
    });
});

// Debug endpoint to test Reddit strategies live
app.get('/api/debug/reddit', async (req, res) => {
    try {
        log('info', 'Debug: Testing Reddit strategies');
        const results = {
            multireddit: 0,
            search: 0,
            pullpush: 0,
            errors: [],
        };

        // Test A: Multireddit
        try {
            const posts = await fetchMultiSub(['ClaudeAI', 'claude', 'claudedev']);
            results.multireddit = posts.length;
            log('info', `Debug multireddit: ${posts.length} posts`);
        } catch (e) {
            results.errors.push(`Multireddit: ${e.message}`);
            log('error', 'Debug multireddit failed', { error: e.message });
        }

        // Test B: Search
        try {
            const posts = await fetchRedditSearch('claude anthropic', 'week');
            results.search = posts.length;
            log('info', `Debug search: ${posts.length} posts`);
        } catch (e) {
            results.errors.push(`Search: ${e.message}`);
            log('error', 'Debug search failed', { error: e.message });
        }

        // Test C: PullPush
        try {
            const posts = await fetchPullPush('claude anthropic');
            results.pullpush = posts.length;
            log('info', `Debug pullpush: ${posts.length} posts`);
        } catch (e) {
            results.errors.push(`PullPush: ${e.message}`);
            log('error', 'Debug pullpush failed', { error: e.message });
        }

        res.json({
            success: true,
            results,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        log('error', 'Debug endpoint error', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Serve static files for non-API routes
app.use(express.static(path.join(__dirname, 'public')));

// Serve React app for all other routes (catch-all for SPA — must be LAST)
// Express v5 requires named parameter syntax for wildcards
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
