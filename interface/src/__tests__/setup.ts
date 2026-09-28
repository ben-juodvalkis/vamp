import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock WebSocket for tests
class MockWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;

	readyState = MockWebSocket.OPEN;
	onopen: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	constructor(public url: string) {
		setTimeout(() => {
			if (this.onopen) {
				this.onopen(new Event('open'));
			}
		}, 0);
	}

	send(data: string) {
		// Mock send - can be spied on in tests
	}

	close() {
		this.readyState = MockWebSocket.CLOSED;
		if (this.onclose) {
			this.onclose(new CloseEvent('close'));
		}
	}
}

// @ts-expect-error - Mock WebSocket globally
global.WebSocket = MockWebSocket;

// Mock localStorage
const localStorageMock = {
	store: {} as Record<string, string>,
	getItem: vi.fn((key: string) => localStorageMock.store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => {
		localStorageMock.store[key] = value;
	}),
	removeItem: vi.fn((key: string) => {
		delete localStorageMock.store[key];
	}),
	clear: vi.fn(() => {
		localStorageMock.store = {};
	})
};

Object.defineProperty(global, 'localStorage', {
	value: localStorageMock
});

// Reset mocks between tests
beforeEach(() => {
	vi.clearAllMocks();
	localStorageMock.store = {};
});
