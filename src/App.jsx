import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';

// UI ENHANCEMENT: Animated number counter hook for stat cards
function useAnimatedNumber(target, duration = 600) {
    const [value, setValue] = useState(0);
    const prevTarget = useRef(0);

    useEffect(() => {
        const start = prevTarget.current;
        const diff = target - start;
        if (diff === 0) return;
        const startTime = performance.now();

        function tick(now) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            setValue(Math.round(start + diff * eased));
            if (progress < 1) {
                requestAnimationFrame(tick);
            } else {
                prevTarget.current = target;
            }
        }
        requestAnimationFrame(tick);
    }, [target, duration]);

    return value;
}

// UI ENHANCEMENT: Scroll progress hook
function useScrollProgress() {
    const [progress, setProgress] = useState(0);
    const [showBackToTop, setShowBackToTop] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            const scrollTop = window.scrollY;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            setProgress(docHeight > 0 ? (scrollTop / docHeight) * 100 : 0);
            setShowBackToTop(scrollTop > 400);
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return { progress, showBackToTop };
}

// Debounce hook
function useDebounce(value, delay) {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

// Countdown timer hook
function useCountdown(targetTime, onComplete) {
    const [timeLeft, setTimeLeft] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            const diff = Math.max(0, targetTime - now);
            setTimeLeft(diff);
            if (diff === 0 && onComplete) {
                onComplete();
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [targetTime, onComplete]);

    const minutes = Math.floor(timeLeft / 60000);
    const seconds = Math.floor((timeLeft % 60000) / 1000);
    return { minutes, seconds, timeLeft };
}

// Source metadata
// UI ENHANCEMENT: Added accentClass for card top-border color coding
const SOURCE_META = {
    reddit:     { icon: '🔴', name: 'Reddit',         color: 'from-orange-500 to-red-500',     accentClass: 'post-card-accent-reddit' },
    hackernews: { icon: '🟠', name: 'Hacker News',    color: 'from-amber-500 to-orange-600',   accentClass: 'post-card-accent-hackernews' },
    github:     { icon: '⚫', name: 'GitHub',         color: 'from-gray-500 to-slate-700',     accentClass: 'post-card-accent-github' },
    devto:      { icon: '🟣', name: 'Dev.to',         color: 'from-purple-500 to-violet-700',  accentClass: 'post-card-accent-devto' },
    anthropic:  { icon: '🔵', name: 'Anthropic',      color: 'from-blue-500 to-cyan-600',      accentClass: 'post-card-accent-anthropic' },
    openclaw:   { icon: '🦅', name: 'OpenClaw',       color: 'from-emerald-500 to-teal-600',   accentClass: 'post-card-accent-openclaw' },
    moltbot:    { icon: '🤖', name: 'MoltBot',        color: 'from-fuchsia-500 to-pink-600',   accentClass: 'post-card-accent-moltbot' },
    clawdbot:   { icon: '📱', name: 'ClawdBot',       color: 'from-sky-500 to-indigo-600',     accentClass: 'post-card-accent-clawdbot' },
};
function getSourceMeta(post) { return SOURCE_META[post.source] || SOURCE_META.reddit; }

function SourceBadge({ post }) {
    const m = getSourceMeta(post);
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-black/20 text-white/80 border border-white/10">
            {m.icon} {m.name}
        </span>
    );
}

// UI ENHANCEMENT: Improved skeleton cards with shimmer animation
function PostSkeleton() {
    return (
        <div className="glass-card rounded-2xl overflow-hidden">
            {/* Skeleton accent bar */}
            <div className="h-0.5 skeleton w-full"></div>
            <div className="p-5">
                <div className="flex items-center gap-2 mb-4">
                    <div className="h-6 skeleton rounded-full w-20"></div>
                    <div className="h-5 skeleton rounded-full w-16"></div>
                </div>
                <div className="h-5 skeleton rounded-lg w-[85%] mb-2.5"></div>
                <div className="h-5 skeleton rounded-lg w-[65%] mb-4"></div>
                <div className="h-4 skeleton rounded-lg w-full mb-2"></div>
                <div className="h-4 skeleton rounded-lg w-[90%] mb-2"></div>
                <div className="h-4 skeleton rounded-lg w-[70%] mb-5"></div>
                <div className="flex justify-between items-center">
                    <div className="flex gap-3">
                        <div className="h-4 skeleton rounded-full w-14"></div>
                        <div className="h-4 skeleton rounded-full w-12"></div>
                    </div>
                    <div className="h-4 skeleton rounded-full w-28"></div>
                </div>
            </div>
        </div>
    );
}

// Trending badge component
function TrendingBadge({ rank }) {
    const colors = {
        1: 'from-yellow-400 to-orange-500',
        2: 'from-gray-300 to-gray-400',
        3: 'from-amber-600 to-amber-700'
    };
    return (
        <div className={`absolute -top-2 -left-2 w-8 h-8 rounded-full bg-gradient-to-br ${colors[rank] || 'from-purple-500 to-pink-500'} flex items-center justify-center text-white text-xs font-bold shadow-lg z-10`}>
            #{rank}
        </div>
    );
}

// Post card component
function PostCard({ post, isFavorite, onToggleFavorite, isSelected, onSelect, showTrending, rank }) {
    const isNew = (Date.now() - new Date(post.created_at).getTime()) < 4 * 60 * 60 * 1000;
    const isReddit = !post.source || post.source === 'reddit';

    const formatDate = (dateString, source) => {
        if (!dateString) return 'Unknown date';
        const date = new Date(dateString);
        if (isNaN(date)) return 'Unknown date';
        const now = Date.now();
        const diffMs = now - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        // Pinned official resources — show real date, not relative
        const PINNED = new Set(['openclaw','moltbot','clawdbot']);
        if (PINNED.has(source)) return date.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });

        // GitHub repos — show "Updated X ago"
        if (source === 'github') {
            if (diffDays < 1) return `Updated ${diffHours}h ago`;
            if (diffDays < 30) return `Updated ${diffDays}d ago`;
            return `Updated ${date.toLocaleDateString('en-US', { month:'short', year:'numeric' })}`;
        }

        // Everything else — real relative time
        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        if (diffDays < 30) return `${diffDays}d ago`;
        return date.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
    };

    const excerpt = post.content
        ? post.content.replace(/<[^>]+>/g, '').substring(0, 200) + (post.content.length > 200 ? '...' : '')
        : '';

    const subredditColors = {
        'ClaudeAI': 'from-purple-500 to-violet-600',
        'claude': 'from-purple-400 to-purple-600',
        'claudedev': 'from-indigo-500 to-purple-600',
        'AnthropicAI': 'from-pink-500 to-rose-600',
        'OpenAI': 'from-green-500 to-emerald-600',
        'ChatGPT': 'from-teal-500 to-cyan-600',
        'MachineLearning': 'from-blue-500 to-indigo-600',
        'LocalLLaMA': 'from-orange-500 to-amber-600',
        'artificial': 'from-cyan-500 to-blue-600',
        'singularity': 'from-fuchsia-500 to-pink-600',
        'Bard': 'from-yellow-500 to-orange-600',
        'bing': 'from-sky-500 to-blue-600',
        'perplexity_ai': 'from-violet-500 to-purple-600',
        'ClaudeCode': 'from-cyan-500 to-blue-600',
        'AICoding': 'from-blue-400 to-indigo-600',
        'vibecoding': 'from-violet-400 to-fuchsia-600',
        'cursor_ai': 'from-teal-400 to-cyan-600',
        'AIdev': 'from-sky-500 to-blue-600',
        'AIAgents': 'from-rose-500 to-red-600',
        'PromptEngineering': 'from-lime-500 to-green-600',
        'HackerNews': 'from-amber-500 to-orange-600',
        'GitHub': 'from-gray-500 to-slate-700',
        'DevTo': 'from-purple-500 to-violet-700',
        'AnthropicBlog': 'from-blue-500 to-cyan-600',
        'OpenClaw': 'from-emerald-500 to-teal-600',
        'ClawHub': 'from-teal-400 to-emerald-600',
        'MoltBot': 'from-fuchsia-500 to-pink-600',
        'ClawdBot': 'from-sky-500 to-indigo-600',
    };

    const gradientClass = subredditColors[post.subreddit] || 'from-gray-500 to-gray-600';
    const subLabel = isReddit ? `r/${post.subreddit}` : post.subreddit;

    // UI ENHANCEMENT: Determine source accent class for top colored line
    const sourceMeta = getSourceMeta(post);
    const accentClass = sourceMeta.accentClass || 'post-card-accent-reddit';

    return (
        <article
            className={`post-card glass-card rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-2xl cursor-pointer relative group ${accentClass} ${isFavorite ? 'is-favorited' : ''} ${isSelected ? 'ring-2 ring-purple-500 ring-offset-2 ring-offset-transparent' : ''}`}
            onClick={() => onSelect(post)}
            tabIndex={0}
            role="button"
            aria-label={`View post: ${post.title}`}
        >
            {showTrending && rank <= 3 && <TrendingBadge rank={rank} />}

            <div className="p-5">
                <div className="flex items-start justify-between mb-3 gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-r ${gradientClass} text-white shadow-lg`}>
                            {subLabel}
                        </span>
                        <SourceBadge post={post} />
                        {/* UI ENHANCEMENT: Animated NEW badge with shimmer effect */}
                        {isNew && <span className="new-badge-animated inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold text-green-400 border border-green-500/30">NEW</span>}
                    </div>
                    {/* UI ENHANCEMENT: Star with pop animation on click */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(post.reddit_id);
                        }}
                        className={`favorite-star p-2 rounded-full transition-all duration-200 ${isFavorite
                            ? 'is-favorited text-yellow-400 bg-yellow-400/20 hover:bg-yellow-400/30 scale-110'
                            : 'text-gray-400 hover:text-yellow-400 hover:bg-white/10'
                        }`}
                        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    >
                        <svg className="w-5 h-5 transition-transform" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                    </button>
                </div>

                {/* UI ENHANCEMENT: Better typography - heavier title, improved line height */}
                <h3 className="text-[17px] font-semibold text-white group-hover:text-purple-200 transition-colors mb-2 line-clamp-2 leading-snug tracking-[-0.01em]">
                    {post.title}
                </h3>

                {excerpt && (
                    <p className="text-gray-400 text-sm mb-4 line-clamp-3 leading-relaxed">
                        {excerpt}
                    </p>
                )}

                {/* UI ENHANCEMENT: Cleaner bottom row with consistent alignment */}
                <div className="flex items-center justify-between text-sm pt-1 border-t border-white/5">
                    <div className="flex items-center space-x-4 pt-2">
                        {post.source === 'github' ? (
                            <span className="flex items-center text-yellow-400 font-medium">
                                ⭐ {(post.upvotes || 0).toLocaleString()}
                            </span>
                        ) : (
                            <span className="flex items-center text-orange-400 font-medium">
                                <svg className="w-4 h-4 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
                                </svg>
                                {(post.upvotes || 0).toLocaleString()}
                            </span>
                        )}
                        {post.source !== 'github' && (
                            <span className="flex items-center text-blue-400">
                                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                                {post.num_comments || 0}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center space-x-2 text-xs text-gray-500 pt-2">
                        <span className="truncate max-w-[100px]">{isReddit ? `u/${post.author}` : post.author}</span>
                        <span className="text-gray-600/50">·</span>
                        <span className="text-purple-400/80">{formatDate(post.created_at, post.source)}</span>
                    </div>
                </div>
            </div>

            {/* Hover gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-purple-900/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
        </article>
    );
}

// Post Modal component
function PostModal({ post, isOpen, onClose, isFavorite, onToggleFavorite }) {
    const modalRef = useRef(null);
    const [copied, setCopied] = useState(false);
    const copyLink = () => { if (!post) return; navigator.clipboard.writeText(post.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {}); };

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            modalRef.current?.focus();
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            window.addEventListener('keydown', handleKeyDown);
        }
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen || !post) return null;

    const formatDate = (dateString) => {
        if (!dateString) return 'Unknown';
        const d = new Date(dateString);
        if (isNaN(d)) return 'Unknown';
        return d.toLocaleString('en-US', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm animate-fade-in"
                onClick={onClose}
            />

            {/* Modal */}
            <div
                ref={modalRef}
                className="relative glass-card rounded-3xl max-w-3xl w-full max-h-[85vh] overflow-hidden animate-scale-in"
                tabIndex={-1}
            >
                {/* Header gradient */}
                <div className="h-2 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500"></div>

                <div className="p-6 overflow-y-auto max-h-[calc(85vh-2rem)]">
                    {/* Close button */}
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-gray-300 hover:text-white"
                        aria-label="Close modal"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>

                    {/* Subreddit and actions */}
                    <div className="flex items-center justify-between mb-4">
                        <span className="px-4 py-1.5 rounded-full text-sm font-semibold bg-gradient-to-r from-purple-500 to-pink-500 text-white">
                            r/{post.subreddit}
                        </span>
                        <div className="flex items-center space-x-2">
                            <button
                                onClick={() => onToggleFavorite(post.reddit_id)}
                                className={`p-2 rounded-full transition-all ${isFavorite
                                    ? 'text-yellow-400 bg-yellow-400/20'
                                    : 'text-gray-400 hover:text-yellow-400 hover:bg-white/10'
                                }`}
                            >
                                <svg className="w-6 h-6" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Title */}
                    <h2 className="text-2xl font-bold text-white mb-4 leading-tight">
                        {post.title}
                    </h2>

                    {/* Meta info */}
                    <div className="flex flex-wrap items-center gap-4 mb-6 text-sm">
                        <span className="flex items-center text-orange-400 font-semibold">
                            <svg className="w-5 h-5 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
                            </svg>
                            {post.upvotes.toLocaleString()} upvotes
                        </span>
                        <span className="flex items-center text-blue-400">
                            <svg className="w-5 h-5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            {post.num_comments} comments
                        </span>
                        <span className="text-gray-400">
                            by <span className="text-purple-400">u/{post.author}</span>
                        </span>
                        <span className="text-gray-500">
                            {formatDate(post.created_at)}
                        </span>
                    </div>

                    {/* Content */}
                    {post.content && (
                        <div className="prose prose-invert max-w-none mb-6">
                            <div className="bg-white/5 rounded-xl p-4 text-gray-300 whitespace-pre-wrap leading-relaxed">
                                {post.content}
                            </div>
                        </div>
                    )}

                    {/* CTA row */}
                    <div className="flex gap-2">
                        <a href={post.url} target="_blank" rel="noopener noreferrer"
                            className={`flex-1 inline-flex items-center justify-center py-3 px-5 rounded-xl bg-gradient-to-r ${getSourceMeta(post).color} text-white font-semibold hover:opacity-90 transition-all shadow-lg gap-2 text-sm`}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            View on {getSourceMeta(post).name}
                        </a>
                        <button onClick={copyLink} className={`flex items-center gap-1.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all border ${copied ? 'bg-green-500/15 border-green-500/30 text-green-400' : 'bg-white/8 border-white/10 text-gray-400 hover:text-white hover:bg-white/12'}`}>
                            {copied
                                ? <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Copied!</>
                                : <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> Copy</>
                            }
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// UI ENHANCEMENT: Subreddit chips with scroll arrows and fade edge
function SubredditChips({ subreddits, selected, onSelect }) {
    const scrollRef = useRef(null);

    const scrollBy = (dir) => {
        if (scrollRef.current) {
            scrollRef.current.scrollBy({ left: dir * 200, behavior: 'smooth' });
        }
    };

    return (
        <div className="subreddit-scroll-container relative">
            {/* UI ENHANCEMENT: Left scroll arrow */}
            <button onClick={() => scrollBy(-1)} className="subreddit-scroll-btn subreddit-scroll-btn-left hidden md:flex" aria-label="Scroll left">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            {/* UI ENHANCEMENT: Right scroll arrow */}
            <button onClick={() => scrollBy(1)} className="subreddit-scroll-btn subreddit-scroll-btn-right hidden md:flex" aria-label="Scroll right">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>

            <div ref={scrollRef} className="flex gap-2 overflow-x-auto hide-scrollbar px-1 py-1" style={{scrollBehavior:'smooth'}}>
                <button
                    onClick={() => onSelect('')}
                    className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                        selected === ''
                            ? 'source-pill-active bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/30'
                            : 'bg-white/10 text-gray-300 hover:bg-white/20'
                    }`}
                >
                    All
                </button>
                {subreddits.map(sub => (
                    <button
                        key={sub.name}
                        onClick={() => onSelect(sub.name)}
                        className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center space-x-1.5 ${
                            selected === sub.name
                                ? 'source-pill-active bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/30'
                                : sub.count > 0
                                    ? 'bg-white/10 text-gray-300 hover:bg-white/20'
                                    : 'bg-white/5 text-gray-600 hover:bg-white/10 hover:text-gray-400'
                        }`}
                    >
                        {/* UI ENHANCEMENT: Active dot indicator */}
                        {selected === sub.name && <span className="w-1.5 h-1.5 rounded-full bg-white"></span>}
                        <span>r/{sub.name}</span>
                        {sub.count > 0 && (
                            <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
                                selected === sub.name ? 'bg-white/20 text-white' : 'bg-purple-500/25 text-purple-300'
                            }`}>{sub.count}</span>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}

// UI ENHANCEMENT: Stats card with animated counter, accent border, hover lift
function StatCard({ icon, label, value, color, trend, accentClass }) {
    // Parse numeric value for animated counting
    const numericValue = parseInt(String(value).replace(/,/g, ''), 10) || 0;
    const animatedValue = useAnimatedNumber(numericValue);

    return (
        <div className={`stat-card glass-card rounded-xl p-4 flex items-center space-x-4 ${accentClass || ''}`}>
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-lg shrink-0`}>
                {icon}
            </div>
            <div>
                <p className="text-gray-400 text-sm font-medium">{label}</p>
                <p className="stat-value text-2xl font-bold text-white">{animatedValue.toLocaleString()}</p>
                {trend && (
                    <p className={`text-xs ${trend > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {trend > 0 ? '+' : ''}{trend}% from yesterday
                    </p>
                )}
            </div>
        </div>
    );
}

// Keyboard shortcuts help
function KeyboardShortcuts({ isOpen, onClose }) {
    if (!isOpen) return null;

    const shortcuts = [
        { key: 'j / k', action: 'Navigate between posts' },
        { key: 'Enter / Space', action: 'Open selected post' },
        { key: 'f', action: 'Toggle favorite' },
        { key: 'Escape', action: 'Close modal / Clear selection' },
        { key: 'r', action: 'Refresh posts' },
        { key: '/', action: 'Focus search' },
        { key: 'd', action: 'Toggle dark mode' },
        { key: '?', action: 'Show keyboard shortcuts' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
            <div className="relative glass-card rounded-2xl p-6 max-w-md w-full animate-scale-in">
                <h3 className="text-xl font-bold text-white mb-4 flex items-center">
                    <svg className="w-6 h-6 mr-2 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                    </svg>
                    Keyboard Shortcuts
                </h3>
                <div className="space-y-3">
                    {shortcuts.map((s, i) => (
                        <div key={i} className="flex items-center justify-between">
                            <kbd className="px-3 py-1.5 rounded-lg bg-white/10 text-purple-300 font-mono text-sm">
                                {s.key}
                            </kbd>
                            <span className="text-gray-300">{s.action}</span>
                        </div>
                    ))}
                </div>
                <button
                    onClick={onClose}
                    className="mt-6 w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium hover:opacity-90 transition-opacity"
                >
                    Got it!
                </button>
            </div>
        </div>
    );
}

// OpenClaw News Banner - Always visible, shows last 24h OpenClaw news
function OpenClawNewsBanner({ posts, onSelectPost, favorites, onToggleFavorite }) {
    const [expanded, setExpanded] = useState(true);
    const [scrollIndex, setScrollIndex] = useState(0);

    if (!posts || posts.length === 0) {
        return (
            <div className="mb-6 glass-card rounded-2xl overflow-hidden border border-emerald-500/20">
                {/* UI ENHANCEMENT: Vivid diagonal gradient */}
                <div className="openclaw-header-gradient px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">🦅</span>
                        <div>
                            <h2 className="text-white font-bold text-lg">OpenClaw News Feed</h2>
                            <p className="text-emerald-100/70 text-xs">Last 48 hours — auto-refreshes every 3 minutes</p>
                        </div>
                    </div>
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/15 text-emerald-100 border border-white/20">
                        No news yet — checking sources...
                    </span>
                </div>
            </div>
        );
    }

    const visiblePosts = expanded ? posts.slice(0, 6) : posts.slice(0, 2);

    return (
        <div className="mb-6 glass-card rounded-2xl overflow-hidden border border-emerald-500/30 shadow-lg shadow-emerald-500/10">
            {/* UI ENHANCEMENT: Vivid diagonal gradient header bar */}
            <div className="openclaw-header-gradient px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="text-2xl animate-pulse">🦅</span>
                    <div>
                        <h2 className="text-white font-bold text-lg">OpenClaw News Feed</h2>
                        <p className="text-emerald-100/70 text-xs">Last 48 hours — {posts.length} items found</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* UI ENHANCEMENT: Pulsing LIVE pill */}
                    <span className="live-pill-pulse flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/15 text-emerald-100 border border-white/20">
                        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                        LIVE
                    </span>
                    {/* UI ENHANCEMENT: Animated chevron on collapse/expand */}
                    <button
                        onClick={() => setExpanded(prev => !prev)}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white hover:bg-white/20 transition-all border border-white/10"
                    >
                        <span>{expanded ? 'Collapse' : `Show all (${posts.length})`}</span>
                        <svg className={`w-3.5 h-3.5 chevron-animated ${expanded ? 'expanded' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* News items */}
            <div className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {visiblePosts.map((post, idx) => {
                        const isNew = (Date.now() - new Date(post.created_at).getTime()) < 4 * 60 * 60 * 1000;
                        const timeDiff = Date.now() - new Date(post.created_at).getTime();
                        const hours = Math.floor(timeDiff / 3600000);
                        const mins = Math.floor(timeDiff / 60000);
                        const timeStr = mins < 60 ? `${mins}m ago` : `${hours}h ago`;
                        const isFav = favorites.includes(post.reddit_id);
                        const srcMeta = SOURCE_META[post.source] || SOURCE_META.reddit;

                        return (
                            <div
                                key={post.reddit_id || idx}
                                onClick={() => onSelectPost(post)}
                                className="group relative bg-white/5 hover:bg-white/10 border border-white/8 hover:border-emerald-500/30 rounded-xl p-3.5 cursor-pointer transition-all duration-200 hover:shadow-md hover:shadow-emerald-500/5"
                            >
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">
                                            {srcMeta.icon} {srcMeta.name}
                                        </span>
                                        {isNew && (
                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-green-500/20 text-green-400 border border-green-500/30 animate-pulse">
                                                NEW
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onToggleFavorite(post.reddit_id); }}
                                        className={`shrink-0 p-1 rounded-full transition-all ${isFav ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400'}`}
                                    >
                                        <svg className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                        </svg>
                                    </button>
                                </div>
                                <h3 className="text-sm font-semibold text-white group-hover:text-emerald-300 transition-colors line-clamp-2 leading-snug mb-2">
                                    {post.title}
                                </h3>
                                <div className="flex items-center justify-between text-[11px] text-gray-400">
                                    <div className="flex items-center gap-2">
                                        <span className="text-orange-400 font-medium">▲ {post.upvotes || 0}</span>
                                        <span className="text-blue-400">💬 {post.num_comments || 0}</span>
                                    </div>
                                    <span className="text-emerald-400 font-medium">{timeStr}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {posts.length > 6 && expanded && (
                    <div className="mt-3 text-center">
                        <button
                            onClick={() => setExpanded(false)}
                            className="text-xs text-gray-500 hover:text-emerald-400 transition-colors"
                        >
                            Showing {visiblePosts.length} of {posts.length} — click collapse to minimize
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// Main App component
export default function App() {
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState('created_at');
    const [sortOrder, setSortOrder] = useState('desc');
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ total: 0, totalPages: 0 });
    const [favorites, setFavorites] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('reddit-favorites') || '[]');
        } catch {
            return [];
        }
    });
    const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
    const [connected, setConnected] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [stats, setStats] = useState(null);
    const [darkMode, setDarkMode] = useState(() => {
        try {
            const saved = localStorage.getItem('reddit-dark-mode');
            if (saved !== null) return JSON.parse(saved);
            return true; // Default to dark mode
        } catch {
            return true;
        }
    });
    const [selectedPost, setSelectedPost] = useState(null);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [selectedSubreddit, setSelectedSubreddit] = useState('');
    const [nextRefresh, setNextRefresh] = useState(Date.now() + 180000);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [view, setView] = useState('grid'); // 'grid' or 'trending'
    const [activeSource, setActiveSource] = useState('all');
    const [openClawPosts, setOpenClawPosts] = useState([]);
    // UI ENHANCEMENT: Track new posts for notification banner
    const [newPostsAvailable, setNewPostsAvailable] = useState(0);

    const searchInputRef = useRef(null);
    const postsContainerRef = useRef(null);

    // UI ENHANCEMENT: Scroll progress bar and back-to-top button
    const { progress: scrollProgress, showBackToTop } = useScrollProgress();

    // Countdown to next refresh
    const { minutes, seconds } = useCountdown(nextRefresh, () => {
        setNextRefresh(Date.now() + 180000);
    });

    // Apply dark mode class to document
    useEffect(() => {
        if (darkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        localStorage.setItem('reddit-dark-mode', JSON.stringify(darkMode));
    }, [darkMode]);

    const debouncedSearch = useDebounce(searchTerm, 300);

    // API URL
    const API_URL = window.location.hostname === 'localhost'
        ? 'http://localhost:3000'
        : '';

    // Fetch OpenClaw dedicated feed
    const fetchOpenClawFeed = useCallback(async () => {
        try {
            const response = await fetch(`${API_URL}/api/openclaw-feed`);
            if (!response.ok) return;
            const data = await response.json();
            if (data.success && data.posts) {
                setOpenClawPosts(data.posts);
            }
        } catch (err) {
            console.error('OpenClaw feed error:', err);
        }
    }, [API_URL]);

    // Socket.IO connection
    useEffect(() => {
        const socket = io(API_URL, {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 500,
            reconnectionDelayMax: 3000,
            timeout: 10000,
            transports: ['websocket', 'polling'],
        });

        socket.on('connect', () => {
            setConnected(true);
        });

        socket.on('disconnect', () => {
            setConnected(false);
        });

        socket.on('posts-updated', (data) => {
            setLastUpdated(new Date().toISOString());
            setNextRefresh(Date.now() + 180000);
            // UI ENHANCEMENT: Show new-posts banner instead of silent refresh
            setNewPostsAvailable(prev => prev + 1);
            fetchPosts(true); // silent — no spinner, keeps showing old posts
            fetchOpenClawFeed(); // also refresh OpenClaw feed
        });

        socket.on('stats', (data) => {
            setStats(data);
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    // Initial OpenClaw feed load + periodic refresh
    useEffect(() => {
        fetchOpenClawFeed();
        const interval = setInterval(fetchOpenClawFeed, 90000); // every 90s
        return () => clearInterval(interval);
    }, [fetchOpenClawFeed]);

    // Fetch posts
    const fetchPosts = useCallback(async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            setError(null);

            const params = new URLSearchParams({
                search: debouncedSearch,
                subreddit: selectedSubreddit,
                source: activeSource !== 'all' ? activeSource : '',  // Pass source filter to API
                sortBy,
                sortOrder,
                page: page.toString(),
                limit: '24'
            });

            const response = await fetch(`${API_URL}/api/posts?${params}`);
            if (!response.ok) throw new Error('Failed to fetch posts');

            const data = await response.json();
            if (data.success) {
                setPosts(data.posts);
                setPagination(data.pagination);
                setLastUpdated(data.lastUpdated);
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (err) {
            if (!silent) setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [debouncedSearch, selectedSubreddit, activeSource, sortBy, sortOrder, page, API_URL]);

    useEffect(() => {
        fetchPosts();
    }, [fetchPosts]);

    // Toggle favorite
    const toggleFavorite = useCallback((redditId) => {
        setFavorites(prev => {
            const updated = prev.includes(redditId)
                ? prev.filter(id => id !== redditId)
                : [...prev, redditId];
            localStorage.setItem('reddit-favorites', JSON.stringify(updated));
            return updated;
        });
    }, []);

    // Filtered posts
    const displayedPosts = useMemo(() => {
        let p = posts;
        if (activeSource !== 'all') p = p.filter(post => (post.source || 'reddit') === activeSource);
        if (!showFavoritesOnly) return p;
        return p.filter(post => favorites.includes(post.reddit_id));
    }, [posts, favorites, showFavoritesOnly, activeSource]);

    // Trending posts (top 5 by upvotes)
    const trendingPosts = useMemo(() => {
        return [...posts].sort((a, b) => b.upvotes - a.upvotes).slice(0, 5);
    }, [posts]);

    // Subreddit stats
    // All subreddits always shown — not dependent on current DB contents
    const ALL_SUBREDDITS = [
        // Claude / Anthropic — dedicated
        'ClaudeAI','claude','claudedev','AnthropicAI','ClaudeCode',
        // AI coding & tools
        'AICoding','vibecoding','cursor_ai','AIdev','GithubCopilot',
        'ChatGPTCoding','aipromptprogramming',
        // AI agents / automation
        'AIAgents','PromptEngineering','LangChain','AutoGPT','n8n',
        'ChatGPTAutomation',
        // AI models / general
        'OpenAI','MachineLearning','LocalLLaMA','artificial','singularity',
        'ChatGPT','Bard','perplexity_ai','GPT4','Gemini','StableDiffusion',
        'ArtificialIntelligence',
        // Learning
        'learnmachinelearning','deeplearning','learnprogramming',
        // Tech / Dev
        'programming','webdev','compsci','technology','SoftwareEngineering',
        // Discord / bots
        'discordapp','Discord_Bots',
    ];

    const subredditStats = useMemo(() => {
        const counts = {};
        // Seed all known subreddits with 0 so they always appear
        ALL_SUBREDDITS.forEach(s => { counts[s] = 0; });
        posts.forEach(post => {
            if (!post.source || post.source === 'reddit') {
                if (counts.hasOwnProperty(post.subreddit)) {
                    counts[post.subreddit]++;
                }
            }
        });
        return Object.entries(counts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => {
                // Sort: subreddits with posts first, then alphabetically
                if (b.count !== a.count) return b.count - a.count;
                return a.name.localeCompare(b.name);
            });
    }, [posts]);

    // Handle refresh
    const handleRefresh = async () => {
        try {
            const response = await fetch(`${API_URL}/api/refresh`, { method: 'POST' });
            if (response.ok) {
                fetchPosts();
                setNextRefresh(Date.now() + 180000);
            }
        } catch (err) {
            console.error('Refresh error:', err);
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Don't trigger shortcuts when typing in input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                if (e.key === 'Escape') {
                    e.target.blur();
                }
                return;
            }

            switch (e.key) {
                case 'j':
                    e.preventDefault();
                    setSelectedIndex(prev => Math.min(prev + 1, displayedPosts.length - 1));
                    break;
                case 'k':
                    e.preventDefault();
                    setSelectedIndex(prev => Math.max(prev - 1, 0));
                    break;
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    if (selectedIndex >= 0 && displayedPosts[selectedIndex]) {
                        setSelectedPost(displayedPosts[selectedIndex]);
                    }
                    break;
                case 'f':
                    e.preventDefault();
                    if (selectedIndex >= 0 && displayedPosts[selectedIndex]) {
                        toggleFavorite(displayedPosts[selectedIndex].reddit_id);
                    }
                    break;
                case 'Escape':
                    if (selectedPost) {
                        setSelectedPost(null);
                    } else {
                        setSelectedIndex(-1);
                    }
                    break;
                case 'r':
                    e.preventDefault();
                    handleRefresh();
                    break;
                case '/':
                    e.preventDefault();
                    searchInputRef.current?.focus();
                    break;
                case 'd':
                    e.preventDefault();
                    setDarkMode(prev => !prev);
                    break;
                case '?':
                    e.preventDefault();
                    setShowShortcuts(true);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [displayedPosts, selectedIndex, selectedPost, toggleFavorite]);

    // Scroll selected post into view
    useEffect(() => {
        if (selectedIndex >= 0 && postsContainerRef.current) {
            const cards = postsContainerRef.current.querySelectorAll('article');
            if (cards[selectedIndex]) {
                cards[selectedIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }, [selectedIndex]);

    return (
        <div className={`min-h-screen transition-colors duration-300 ${darkMode ? 'bg-[#0a0a0f]' : 'bg-gradient-to-br from-gray-50 via-purple-50 to-pink-50'}`}>
            {/* UI ENHANCEMENT: Scroll progress bar at top of viewport */}
            <div className="scroll-progress-bar" style={{ width: `${scrollProgress}%` }} />

            {/* UI ENHANCEMENT: Dot-grid texture overlay for dark mode depth */}
            {darkMode && <div className="fixed inset-0 bg-texture pointer-events-none z-0" />}

            {/* Animated background elements */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-float"></div>
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-pink-500/20 rounded-full blur-3xl animate-float-delayed"></div>
            </div>

            {/* UI ENHANCEMENT: Glassmorphism navbar with increased height (64px) */}
            <header className="sticky top-0 z-40 navbar-glass">
                {/* UI ENHANCEMENT: Taller navbar (min h-16) with better vertical centering */}
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-[64px] flex items-center">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 w-full py-3 lg:py-0">
                        {/* Logo and title */}
                        <div className="flex items-center space-x-4">
                            {/* UI ENHANCEMENT: Slightly larger, more prominent logo icon */}
                            <div className="w-11 h-11 bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/30 animate-glow shrink-0">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-orange-400 bg-clip-text text-transparent tracking-tight">
                                    Claude Hub 🦅
                                </h1>
                                {/* UI ENHANCEMENT: Subtitle as styled breadcrumb with dot separators */}
                                <p className="text-xs text-gray-400 navbar-subtitle">
                                    <span>Claude</span><span className="subtitle-separator"></span>
                                    <span>OpenClaw</span><span className="subtitle-separator"></span>
                                    <span>MoltBot</span><span className="subtitle-separator"></span>
                                    <span>ClawdBot</span><span className="subtitle-separator"></span>
                                    <span>Claude Code</span>
                                </p>
                            </div>
                        </div>

                        {/* Connection status and actions */}
                        <div className="flex items-center space-x-3">
                            {/* UI ENHANCEMENT: Glowing green live indicator */}
                            <div className={`flex items-center space-x-2 px-4 py-2 rounded-full text-sm font-medium glass-card ${connected ? 'border-green-500/30 live-indicator-glow' : 'border-red-500/30'}`}>
                                <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                                <span className={connected ? 'text-green-400 font-semibold' : 'text-red-400'}>
                                    {connected ? 'Live' : 'Disconnected'}
                                </span>
                                {connected && (
                                    <span className="text-gray-500 text-xs font-medium">
                                        | Next refresh: {minutes}:{seconds.toString().padStart(2, '0')}
                                    </span>
                                )}
                            </div>

                            {/* UI ENHANCEMENT: Action buttons with hover tooltip labels */}
                            <div className="icon-btn-wrapper">
                                <button
                                    onClick={handleRefresh}
                                    className="p-2.5 rounded-xl glass-card text-gray-400 hover:text-purple-400 hover:bg-white/5 transition-all hover:scale-105"
                                    title="Refresh posts (r)"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                </button>
                                <span className="icon-btn-tooltip">Refresh (r)</span>
                            </div>

                            <div className="icon-btn-wrapper">
                                <button
                                    onClick={() => setDarkMode(prev => !prev)}
                                    className="p-2.5 rounded-xl glass-card text-gray-400 hover:text-yellow-400 hover:bg-white/5 transition-all hover:scale-105"
                                    title="Toggle dark mode (d)"
                                >
                                    {darkMode ? (
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                                        </svg>
                                    ) : (
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                                        </svg>
                                    )}
                                </button>
                                <span className="icon-btn-tooltip">{darkMode ? 'Light mode' : 'Dark mode'} (d)</span>
                            </div>

                            <div className="icon-btn-wrapper">
                                <button
                                    onClick={() => setShowShortcuts(true)}
                                    className="p-2.5 rounded-xl glass-card text-gray-400 hover:text-purple-400 hover:bg-white/5 transition-all hover:scale-105"
                                    title="Keyboard shortcuts (?)"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                                    </svg>
                                </button>
                                <span className="icon-btn-tooltip">Shortcuts (?)</span>
                            </div>

                            <div className="icon-btn-wrapper">
                                <a
                                    href="https://github.com/Michaelunkai/claude-reddit-aggregator"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-2.5 rounded-xl glass-card text-gray-400 hover:text-white hover:bg-white/5 transition-all hover:scale-105 inline-flex"
                                    title="View on GitHub"
                                >
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                                    </svg>
                                </a>
                                <span className="icon-btn-tooltip">GitHub</span>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* UI ENHANCEMENT: New posts notification banner */}
            {newPostsAvailable > 0 && (
                <div className="new-posts-banner fixed top-[68px] left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white text-sm font-medium shadow-lg shadow-purple-500/30 cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => { setNewPostsAvailable(0); fetchPosts(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                    New posts available — click to refresh
                </div>
            )}

            {/* Main Content */}
            <main className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* OpenClaw News Feed — Always visible at the top */}
                <OpenClawNewsBanner
                    posts={openClawPosts}
                    onSelectPost={setSelectedPost}
                    favorites={favorites}
                    onToggleFavorite={toggleFavorite}
                />

                {/* UI ENHANCEMENT: Stats cards with unique accent borders and animated counters */}
                {stats && (
                    <div className="stat-card-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                        <StatCard
                            icon={<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>}
                            label="Total Posts"
                            value={stats.totalPosts?.toLocaleString() || '0'}
                            color="from-blue-500 to-indigo-600"
                            accentClass="stat-card-blue"
                        />
                        <StatCard
                            icon={<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                            label="Last 24 Hours"
                            value={stats.postsLast24h?.toLocaleString() || '0'}
                            color="from-amber-500 to-orange-600"
                            accentClass="stat-card-amber"
                        />
                        <StatCard
                            icon={<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
                            label="Last 7 Days"
                            value={stats.postsLastWeek?.toLocaleString() || '0'}
                            color="from-green-500 to-emerald-600"
                            accentClass="stat-card-green"
                        />
                        <StatCard
                            icon={<svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>}
                            label="Favorites"
                            value={favorites.length.toLocaleString()}
                            color="from-purple-500 to-violet-600"
                            accentClass="stat-card-purple"
                        />
                    </div>
                )}

                {/* View Toggle & Filters */}
                <div className="glass-card rounded-2xl p-5 mb-6">
                    {/* UI ENHANCEMENT: Source filter pills with inner glow on active, better dark contrast */}
                    <div className="scroll-fade-right">
                        <div className="flex gap-2 overflow-x-auto pb-2 mb-5 hide-scrollbar">
                            {[
                                { id: 'all',        label: 'All',         icon: '✦' },
                                { id: 'reddit',     label: 'Reddit',      icon: '🔴' },
                                { id: 'anthropic',  label: 'Anthropic',   icon: '🔵' },
                                { id: 'openclaw',   label: 'OpenClaw',    icon: '🦅' },
                                { id: 'moltbot',    label: 'MoltBot',     icon: '🤖' },
                                { id: 'clawdbot',   label: 'ClawdBot',    icon: '📱' },
                                { id: 'hackernews', label: 'Hacker News', icon: '🟠' },
                                { id: 'github',     label: 'GitHub',      icon: '⚫' },
                                { id: 'devto',      label: 'Dev.to',      icon: '🟣' },
                            ].map(src => (
                                <button key={src.id} onClick={() => { setActiveSource(src.id); setPage(1); }}
                                    className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 ${activeSource === src.id ? 'source-pill-active bg-gradient-to-r from-purple-500 to-pink-500 text-white' : 'source-pill-inactive bg-white/8 text-gray-400 hover:bg-white/14 hover:text-white'}`}>
                                    <span>{src.icon}</span><span>{src.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* UI ENHANCEMENT: Topic chips - smaller, more muted to visually differentiate from row 1 */}
                    <div className="flex flex-wrap gap-1.5 mb-5">
                        {[
                            { label: '🤖 Claude', q: 'claude' },
                            { label: '💻 Claude Code', q: 'claude code' },
                            { label: '🦅 OpenClaw', q: 'openclaw' },
                            { label: '🏗 Anthropic', q: 'anthropic' },
                            { label: '🔌 MCP', q: 'mcp' },
                            { label: '🤖 MoltBot', q: 'moltbot' },
                            { label: '📱 ClawdBot', q: 'clawdbot' },
                            { label: '🧰 AI Agents', q: 'agent' },
                            { label: '📢 Announcements', q: 'announcement release' },
                            { label: '💡 Tips & Tricks', q: 'tip trick workflow tutorial' },
                            { label: '⭐ New Repos', q: 'new repo' },
                            { label: '🔧 API', q: 'api' },
                        ].map(chip => (
                            <button key={chip.q} onClick={() => { setSearchTerm(chip.q); setPage(1); setActiveSource('all'); }}
                                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all duration-200 ${
                                    searchTerm === chip.q
                                        ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                                        : 'bg-white/4 border-white/6 text-gray-500 hover:text-gray-300 hover:bg-white/10 hover:border-purple-500/30'
                                }`}>
                                {chip.label}
                            </button>
                        ))}
                    </div>
                    {/* UI ENHANCEMENT: iOS-style segmented control with sliding indicator */}
                    <div className="segmented-control mb-5">
                        {/* Sliding background indicator */}
                        <div
                            className="segmented-control-slider bg-gradient-to-r from-purple-500 to-pink-500"
                            style={{
                                left: view === 'grid' ? '4px' : '50%',
                                width: 'calc(50% - 4px)',
                                ...(view === 'trending' && { background: 'linear-gradient(to right, #f97316, #ef4444)' })
                            }}
                        />
                        <button
                            onClick={() => setView('grid')}
                            className={`relative px-5 py-2.5 rounded-xl font-medium transition-colors duration-200 ${view === 'grid' ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
                        >
                            <span className="flex items-center space-x-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                                </svg>
                                <span>All Posts</span>
                            </span>
                        </button>
                        <button
                            onClick={() => setView('trending')}
                            className={`relative px-5 py-2.5 rounded-xl font-medium transition-colors duration-200 ${view === 'trending' ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
                        >
                            <span className="flex items-center space-x-2">
                                <span>🔥</span>
                                <span>Trending</span>
                            </span>
                        </button>
                    </div>

                    {/* Search and filters */}
                    <div className="flex flex-col lg:flex-row gap-4">
                        {/* UI ENHANCEMENT: Taller search bar (h-11), pill shape, glow focus ring, clear button */}
                        <div className="search-bar-enhanced flex-1 relative rounded-full bg-white/5 border border-white/10 flex items-center">
                            <svg className="absolute left-4 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search posts... (press / to focus)"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setPage(1);
                                }}
                                className="w-full h-11 pl-12 pr-10 py-0 rounded-full bg-transparent border-none text-white placeholder-gray-500 focus:outline-none focus:ring-0 transition-all"
                            />
                            {/* UI ENHANCEMENT: Clear "x" button when search has text */}
                            {searchTerm && (
                                <button
                                    onClick={() => { setSearchTerm(''); setPage(1); }}
                                    className="search-clear-btn absolute right-3 p-1 rounded-full text-gray-400 hover:text-white"
                                    aria-label="Clear search"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>

                        {/* Sort and filter controls */}
                        <div className="flex gap-2">
                            <select
                                value={sortBy}
                                onChange={(e) => {
                                    setSortBy(e.target.value);
                                    setPage(1);
                                }}
                                className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent cursor-pointer"
                            >
                                <option value="created_at" className="bg-gray-800">Newest First</option>
                                <option value="upvotes" className="bg-gray-800">Most Upvoted</option>
                                <option value="num_comments" className="bg-gray-800">Most Discussed</option>
                            </select>

                            <button
                                onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                                className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                                title={sortOrder === 'desc' ? 'Descending' : 'Ascending'}
                            >
                                <svg className={`w-5 h-5 text-gray-400 transform transition-transform ${sortOrder === 'asc' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            <button
                                onClick={() => setShowFavoritesOnly(prev => !prev)}
                                className={`px-5 py-3 rounded-xl transition-all flex items-center space-x-2 ${showFavoritesOnly
                                    ? 'bg-gradient-to-r from-yellow-500 to-orange-500 text-white shadow-lg'
                                    : 'bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10'
                                }`}
                            >
                                <svg className="w-5 h-5" fill={showFavoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                </svg>
                                <span className="hidden sm:inline">{favorites.length}</span>
                            </button>
                        </div>
                    </div>

                    {/* Subreddit filter chips */}
                    {subredditStats.length > 0 && (
                        <div className="mt-4 overflow-x-auto pb-2">
                            <SubredditChips
                                subreddits={subredditStats}
                                selected={selectedSubreddit}
                                onSelect={(sub) => {
                                    setSelectedSubreddit(sub);
                                    setPage(1);
                                }}
                            />
                        </div>
                    )}
                </div>

                {/* Error State */}
                {error && (
                    <div className="glass-card rounded-2xl p-8 mb-6 text-center border border-red-500/30">
                        <svg className="w-16 h-16 text-red-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <h3 className="text-xl font-semibold text-red-400 mb-2">Failed to load posts</h3>
                        <p className="text-gray-400 mb-6">{error}</p>
                        <button
                            onClick={fetchPosts}
                            className="px-6 py-3 bg-gradient-to-r from-red-500 to-pink-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
                        >
                            Try Again
                        </button>
                    </div>
                )}

                {/* Loading State */}
                {loading && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[...Array(6)].map((_, i) => (
                            <PostSkeleton key={i} />
                        ))}
                    </div>
                )}

                {/* Trending View */}
                {!loading && !error && view === 'trending' && (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
                            <svg className="w-8 h-8 mr-3 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                            </svg>
                            Trending Posts
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" ref={postsContainerRef}>
                            {trendingPosts.map((post, index) => (
                                <PostCard
                                    key={post.reddit_id}
                                    post={post}
                                    isFavorite={favorites.includes(post.reddit_id)}
                                    onToggleFavorite={toggleFavorite}
                                    isSelected={selectedIndex === index}
                                    onSelect={setSelectedPost}
                                    showTrending={true}
                                    rank={index + 1}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Posts Grid */}
                {!loading && !error && view === 'grid' && (
                    <>
                        {displayedPosts.length === 0 ? (
                            <div className="text-center py-20">
                                <svg className="w-20 h-20 text-gray-600 mx-auto mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                </svg>
                                <h3 className="text-xl font-medium text-gray-400 mb-2">No posts found</h3>
                                <p className="text-gray-500">
                                    {showFavoritesOnly
                                        ? "You haven't favorited any posts yet. Press 'f' on a post to add it!"
                                        : "Try adjusting your search or filters"}
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" ref={postsContainerRef}>
                                {displayedPosts.map((post, index) => (
                                    <PostCard
                                        key={post.reddit_id}
                                        post={post}
                                        isFavorite={favorites.includes(post.reddit_id)}
                                        onToggleFavorite={toggleFavorite}
                                        isSelected={selectedIndex === index}
                                        onSelect={setSelectedPost}
                                        showTrending={false}
                                        rank={index + 1}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Pagination */}
                        {pagination.totalPages > 1 && !showFavoritesOnly && (
                            <div className="flex items-center justify-center space-x-4 mt-10">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={!pagination.hasPrev}
                                    className="px-6 py-3 rounded-xl glass-card text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105"
                                >
                                    Previous
                                </button>
                                <span className="text-gray-400 px-4">
                                    Page <span className="text-white font-semibold">{page}</span> of <span className="text-white font-semibold">{pagination.totalPages}</span>
                                </span>
                                <button
                                    onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                                    disabled={!pagination.hasNext}
                                    className="px-6 py-3 rounded-xl glass-card text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105"
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </>
                )}
            </main>

            {/* Footer */}
            <footer className="glass-card-solid border-t border-white/10 py-8 mt-12">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                            </div>
                            <span className="text-gray-400 text-sm">
                                Claude Hub 🦅 — Reddit · Anthropic · OpenClaw · MoltBot · ClawdBot · HN · GitHub · Dev.to
                            </span>
                        </div>
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                            <span>Auto-refresh every 3 minutes</span>
                            <span>|</span>
                            <span>Only last 48 hours — highest relevance</span>
                            <span>|</span>
                            <span>Press <kbd className="px-2 py-0.5 rounded bg-white/10 text-purple-400">?</kbd> for shortcuts</span>
                        </div>
                    </div>
                </div>
            </footer>

            {/* Post Modal */}
            <PostModal
                post={selectedPost}
                isOpen={!!selectedPost}
                onClose={() => setSelectedPost(null)}
                isFavorite={selectedPost ? favorites.includes(selectedPost.reddit_id) : false}
                onToggleFavorite={toggleFavorite}
            />

            {/* Keyboard Shortcuts Modal */}
            <KeyboardShortcuts
                isOpen={showShortcuts}
                onClose={() => setShowShortcuts(false)}
            />

            {/* UI ENHANCEMENT: Floating back-to-top button */}
            <button
                className={`back-to-top ${showBackToTop ? 'visible' : ''}`}
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                aria-label="Back to top"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
            </button>
        </div>
    );
}
