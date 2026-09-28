/**
 * Interface Freeze Detection and Performance Monitoring
 * 
 * Tracks various metrics to help identify causes of interface freezing:
 * - Main thread responsiveness
 * - Memory usage patterns
 * - WebSocket connection health
 * - Reactive state update frequency
 * - Long-running operations
 */
import { logger } from '$lib/utils/logger';

interface PerformanceMetrics {
    timestamp: number;
    memoryUsage: number;
    heapUsed: number;
    wsConnected: boolean;
    wsMessageCount: number;
    reactiveUpdateCount: number;
    longTaskCount: number;
    frameDrops: number;
    lastActivity: number;
}

interface FreezeEvent {
    timestamp: number;
    duration: number;
    metrics: PerformanceMetrics;
    stackTrace?: string;
    type: 'suspected' | 'confirmed';
}

class FreezeDetector {
    private isRunning = false;
    private checkInterval = 1000; // Check every second
    private freezeThreshold = 3000; // 3 seconds without response = freeze
    private lastHeartbeat = 0;
    private heartbeatInterval: number | null = null;
    private checkTimer: number | null = null;
    
    // Metrics tracking
    private metrics: PerformanceMetrics[] = [];
    private maxMetricsHistory = 50; // Keep recent data only (memory safety)
    private freezeEvents: FreezeEvent[] = [];
    private wsMessageCount = 0;
    private reactiveUpdateCount = 0;
    private longTaskCount = 0;
    private frameDrops = 0;
    
    // Performance observer for long tasks
    private longTaskObserver: PerformanceObserver | null = null;
    
    constructor() {
        this.setupLongTaskObserver();
        this.setupFrameDropDetection();
    }
    
    private setupLongTaskObserver() {
        if (typeof PerformanceObserver !== 'undefined') {
            try {
                this.longTaskObserver = new PerformanceObserver((list) => {
                    const entries = list.getEntries();
                    entries.forEach((entry) => {
                        if (entry.duration > 50) { // Tasks over 50ms
                            this.longTaskCount++;
                            logger.warn(`Long task detected: ${entry.duration.toFixed(2)}ms`, { component: 'FreezeDetector', entry });
                        }
                    });
                });
                this.longTaskObserver.observe({ entryTypes: ['longtask'] });
            } catch (error) {
                logger.warn('Long task observer not supported:', { component: 'freeze-detector', error });
            }
        }
    }
    
    private setupFrameDropDetection() {
        let lastFrameTime = performance.now();
        let frameCount = 0;
        
        const checkFrameRate = () => {
            const now = performance.now();
            const delta = now - lastFrameTime;
            
            if (delta > 32) { // Missed 60fps frame (16.67ms * 2)
                this.frameDrops++;
            }
            
            frameCount++;
            lastFrameTime = now;
            
            if (this.isRunning) {
                requestAnimationFrame(checkFrameRate);
            }
        };
        
        if (this.isRunning) {
            requestAnimationFrame(checkFrameRate);
        }
    }
    
    public start() {
        if (this.isRunning || typeof window === 'undefined') return;
        
        logger.debug('🔍 Starting freeze detection monitoring...', { component: 'freeze-detector' });
        this.isRunning = true;
        this.lastHeartbeat = Date.now();
        
        // Start heartbeat
        this.heartbeatInterval = window.setInterval(() => {
            this.lastHeartbeat = Date.now();
        }, 100); // Update every 100ms
        
        // Start freeze checking
        this.checkTimer = window.setInterval(() => {
            this.checkForFreeze();
            this.collectMetrics();
        }, this.checkInterval);
        
        // Setup frame rate monitoring
        this.setupFrameDropDetection();
    }
    
    public stop() {
        if (!this.isRunning) return;
        
        logger.debug('🛑 Stopping freeze detection monitoring...', { component: 'freeze-detector' });
        this.isRunning = false;
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
        
        if (this.longTaskObserver) {
            this.longTaskObserver.disconnect();
        }
    }
    
    private checkForFreeze() {
        const now = Date.now();
        const timeSinceHeartbeat = now - this.lastHeartbeat;
        
        if (timeSinceHeartbeat > this.freezeThreshold) {
            const freezeEvent: FreezeEvent = {
                timestamp: now,
                duration: timeSinceHeartbeat,
                metrics: this.getCurrentMetrics(),
                type: 'confirmed',
                stackTrace: new Error().stack
            };
            
            this.freezeEvents.push(freezeEvent);
            logger.error(`🚨 INTERFACE FREEZE DETECTED! Duration: ${timeSinceHeartbeat}ms`, { component: 'freeze-detector', freezeEvent });
            
            // Reset heartbeat
            this.lastHeartbeat = now;
        }
    }
    
    private getCurrentMetrics(): PerformanceMetrics {
        const memory = typeof performance !== 'undefined' ? (performance as any).memory : null;
        
        return {
            timestamp: Date.now(),
            memoryUsage: memory ? memory.usedJSHeapSize : 0,
            heapUsed: memory ? memory.totalJSHeapSize : 0,
            wsConnected: this.getWebSocketStatus(),
            wsMessageCount: this.wsMessageCount,
            reactiveUpdateCount: this.reactiveUpdateCount,
            longTaskCount: this.longTaskCount,
            frameDrops: this.frameDrops,
            lastActivity: this.lastHeartbeat
        };
    }
    
    private collectMetrics() {
        const metrics = this.getCurrentMetrics();

        // Circular buffer: remove oldest before adding new (prevents unbounded growth)
        if (this.metrics.length >= this.maxMetricsHistory) {
            this.metrics.shift();
        }
        this.metrics.push(metrics);

        // Log suspicious patterns
        this.analyzeTrends();
    }
    
    private analyzeTrends() {
        if (this.metrics.length < 10) return;
        
        const recent = this.metrics.slice(-10);
        const memoryGrowth = recent[recent.length - 1].memoryUsage - recent[0].memoryUsage;
        const avgLongTasks = recent.reduce((sum, m) => sum + m.longTaskCount, 0) / recent.length;
        
        // Memory leak warning
        if (memoryGrowth > 10 * 1024 * 1024) { // 10MB growth in 10 seconds
            logger.warn(`Rapid memory growth detected: +${(memoryGrowth / 1024 / 1024).toFixed(2)}MB`, { component: 'FreezeDetector' });
        }
        
        // High task load warning
        if (avgLongTasks > 5) {
            logger.warn(`High long-task frequency: ${avgLongTasks.toFixed(1)} tasks/second`, { component: 'FreezeDetector' });
        }
    }
    
    private getWebSocketStatus(): boolean {
        // This will be injected by the client
        return (globalThis as any).__wsConnected || false;
    }
    
    // Public methods for external components to report activity
    public reportWebSocketMessage() {
        this.wsMessageCount++;
    }
    
    public reportReactiveUpdate() {
        this.reactiveUpdateCount++;
    }
    
    public getMetrics() {
        return {
            current: this.getCurrentMetrics(),
            history: [...this.metrics],
            freezeEvents: [...this.freezeEvents],
            isRunning: this.isRunning
        };
    }
    
    public generateReport(): string {
        const current = this.getCurrentMetrics();
        const freezeCount = this.freezeEvents.length;
        const recentFreezes = this.freezeEvents.filter(f => f.timestamp > Date.now() - 300000); // Last 5 minutes
        
        return `
=== FREEZE DETECTOR REPORT ===
Monitoring Status: ${this.isRunning ? 'ACTIVE' : 'STOPPED'}
Total Freeze Events: ${freezeCount}
Recent Freezes (5min): ${recentFreezes.length}

Current Metrics:
- Memory Usage: ${(current.memoryUsage / 1024 / 1024).toFixed(2)}MB
- WebSocket: ${current.wsConnected ? 'Connected' : 'Disconnected'}
- WS Messages: ${current.wsMessageCount}
- Reactive Updates: ${current.reactiveUpdateCount}
- Long Tasks: ${current.longTaskCount}
- Frame Drops: ${current.frameDrops}

${recentFreezes.length > 0 ? '\nRecent Freeze Events:\n' + recentFreezes.map(f => 
    `- ${new Date(f.timestamp).toLocaleTimeString()}: ${f.duration}ms freeze`
).join('\n') : ''}
        `.trim();
    }
}

// Global instance
export const freezeDetector = new FreezeDetector();

// Auto-start in development (browser only)
if (import.meta.env.DEV && typeof window !== 'undefined') {
    freezeDetector.start();
}

// Export for manual control
export default freezeDetector;